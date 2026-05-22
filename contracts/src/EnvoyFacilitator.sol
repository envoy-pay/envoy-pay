// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @dev Minimal subset of the canonical ERC-8004 Identity Registry we depend on.
///      The full implementation lives at:
///        Celo mainnet:  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
///        Celo Sepolia:  0x8004A818BFB912233c491871b3d84c89A494BD9e
interface IERC8004Identity {
    /// Returns the address the agent has authorized as its operational signing wallet.
    /// Different from `ownerOf(agentId)` — the owner controls the NFT, the agentWallet signs payments.
    /// Returns address(0) if no wallet is set (e.g. immediately after NFT transfer).
    function getAgentWallet(uint256 agentId) external view returns (address);

    /// Returns true if `spender` is the owner of agentId, an approved operator, or the approved address.
    /// Reverts ERC721NonexistentToken if the agent does not exist.
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
}

/// @title EnvoyFacilitator
/// @notice Atomic x402 / MPP payment facilitator for ERC-8004-identified agents on Celo.
/// @dev    Design points:
///
///         1. **Zero internal balance.** Tokens move directly from the agent's wallet to the
///            merchant (and to the treasury for fees) in two `safeTransferFrom` calls within
///            the same transaction. The contract never holds funds, so blast radius is
///            capped by what an agent has explicitly approved.
///
///         2. **Canonical ERC-8004 binding.** Payments are authorized by `getAgentWallet(agentId)`
///            on the canonical Celo ERC-8004 Identity Registry — not by some address we manage.
///            Transferring the agent NFT clears `agentWallet` on the canonical contract, which
///            atomically revokes future payments from this Facilitator without us doing anything.
///
///         3. **Atomic policy enforcement.** Per-(agent, token) rolling-window limits are
///            checked, mutated, and persisted in the same transaction as the transfer. No
///            two-call race window between policy-check and settlement, unlike a separate
///            PolicyGuard + Escrow design.
///
///         4. **Smart wallet support.** Signature verification falls back to ERC-1271 if ECDSA
///            recovery does not match, so agents whose `agentWallet` is a Safe / EIP-7702 EOA
///            / paymaster-relayed account work without code changes.
///
///         5. **Lazy period rollover.** Spending windows reset on the next `pay()` after the
///            window elapses — no keeper bot, no external upkeep.
///
///         6. **No upgrades.** Immutable bytecode. If we need to change behavior, we redeploy
///            and migrate. Audit surface is exactly what is in this file.
contract EnvoyFacilitator is EIP712, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @dev EIP-712 message the agent's wallet signs to authorize a single payment.
    ///      `nonce` is opaque to the contract — pick any uint256 the agent hasn't used yet.
    ///      `challengeId` is the off-chain payment challenge (e.g. an x402 challenge id)
    ///      so the gateway can correlate the on-chain Settled event with its 402 challenge.
    struct PaymentAuth {
        uint256 agentId;
        address token;
        address merchant;
        uint256 amount;
        bytes32 challengeId;
        uint256 nonce;
        uint64 deadline;
    }

    /// @dev Per-(agent, token) spending policy. Packed into two storage slots.
    struct Limit {
        uint128 perTx;           // hard cap on a single payment amount
        uint128 perPeriod;       // hard cap on cumulative spend in current window
        uint128 spentInPeriod;   // running counter for the current window
        uint64  periodStart;     // unix timestamp when current window opened
        uint32  periodLen;       // window duration in seconds (max ~136 years)
        bool    enabled;         // explicit opt-in; defaults to false for safety
    }

    // ---------------------------------------------------------------------
    // Constants & immutable config
    // ---------------------------------------------------------------------

    /// @notice Hard ceiling on `feeBps` set at construction. Cannot be exceeded ever.
    uint16 public constant MAX_FEE_BPS = 200; // 2.00 %

    /// @notice EIP-712 typehash for the `PaymentAuth` struct.
    bytes32 public constant PAYMENT_AUTH_TYPEHASH = keccak256(
        "PaymentAuth(uint256 agentId,address token,address merchant,uint256 amount,bytes32 challengeId,uint256 nonce,uint64 deadline)"
    );

    /// @dev ERC-1271 magic return value for `isValidSignature`.
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

    /// @notice Canonical Celo ERC-8004 Identity Registry. Immutable for the life of the contract.
    IERC8004Identity public immutable IDENTITY;

    /// @notice Fee in basis points applied to every successful `pay()`. Immutable.
    uint16 public immutable feeBps;

    // ---------------------------------------------------------------------
    // Mutable state
    // ---------------------------------------------------------------------

    /// @notice Address that receives the fee portion of every payment. Owner-rotatable.
    address public treasury;

    /// @dev (agentId, nonce) → consumed. Random nonces; no ordering required.
    mapping(uint256 agentId => mapping(uint256 nonce => bool used)) private _usedNonces;

    /// @dev (agentId, token) → policy.
    mapping(uint256 agentId => mapping(address token => Limit)) private _limits;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted on every successful payment. This is the on-chain receipt.
    /// @param challengeId  Off-chain challenge identifier (e.g. x402 challenge id).
    /// @param agentId      ERC-8004 agent NFT id whose wallet signed the auth.
    /// @param merchant     Recipient of the net amount.
    /// @param token        ERC-20 token transferred.
    /// @param amount       Gross amount authorized (net + fee).
    /// @param fee          Portion routed to `treasury` (amount × feeBps / 10_000).
    /// @param nonce        Nonce that was just consumed.
    /// @param signer       Address recovered from the EIP-712 signature.
    event Settled(
        bytes32 indexed challengeId,
        uint256 indexed agentId,
        address indexed merchant,
        address token,
        uint256 amount,
        uint256 fee,
        uint256 nonce,
        address signer
    );

    event LimitSet(
        uint256 indexed agentId,
        address indexed token,
        uint128 perTx,
        uint128 perPeriod,
        uint32 periodLen
    );

    event LimitDisabled(uint256 indexed agentId, address indexed token);

    event TreasurySet(address indexed previous, address indexed current);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error AuthExpired();
    error BadMerchant();
    error BadSigner();
    error BadPeriod();
    error FeeTooHigh(uint16 requested, uint16 max);
    error InvalidAddress();
    error LimitDisabledOrUnset();
    error NoAgentWallet();
    error NonceAlreadyUsed();
    error NotAuthorizedForAgent();
    error PerPeriodLessThanPerTx();
    error PerPeriodExceeded(uint256 attempted, uint128 cap);
    error PerTxExceeded(uint256 attempted, uint128 cap);
    error ZeroAmount();
    error ZeroLimit();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(
        address identityRegistry,
        uint16 _feeBps,
        address _treasury,
        address initialOwner
    )
        EIP712("EnvoyFacilitator", "1")
        Ownable(initialOwner)
    {
        if (identityRegistry == address(0) || _treasury == address(0)) revert InvalidAddress();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh(_feeBps, MAX_FEE_BPS);

        IDENTITY = IERC8004Identity(identityRegistry);
        feeBps = _feeBps;
        treasury = _treasury;
        emit TreasurySet(address(0), _treasury);
    }

    // ---------------------------------------------------------------------
    // Policy management — callable by the agent's owner or approved operator
    // ---------------------------------------------------------------------

    /// @notice Set or update the spending policy for a given (agent, token) pair.
    /// @dev Authorization is delegated to the canonical ERC-8004 registry: any address
    ///      that is the agent's owner, an approved operator, or the approved address can call this.
    ///      Setting a limit resets `spentInPeriod` and starts a fresh window.
    function setLimit(
        uint256 agentId,
        address token,
        uint128 perTx,
        uint128 perPeriod,
        uint32 periodLen
    ) external {
        if (!IDENTITY.isAuthorizedOrOwner(msg.sender, agentId)) revert NotAuthorizedForAgent();
        if (perTx == 0 || perPeriod == 0) revert ZeroLimit();
        if (perPeriod < perTx) revert PerPeriodLessThanPerTx();
        if (periodLen == 0) revert BadPeriod();

        Limit storage L = _limits[agentId][token];
        L.perTx = perTx;
        L.perPeriod = perPeriod;
        L.periodLen = periodLen;
        L.spentInPeriod = 0;
        L.periodStart = uint64(block.timestamp);
        L.enabled = true;

        emit LimitSet(agentId, token, perTx, perPeriod, periodLen);
    }

    /// @notice Disable the policy for a (agent, token) pair. All subsequent `pay()` calls
    ///         on that pair will revert until `setLimit` is called again.
    function disableLimit(uint256 agentId, address token) external {
        if (!IDENTITY.isAuthorizedOrOwner(msg.sender, agentId)) revert NotAuthorizedForAgent();
        _limits[agentId][token].enabled = false;
        emit LimitDisabled(agentId, token);
    }

    // ---------------------------------------------------------------------
    // Payment — the hot path
    // ---------------------------------------------------------------------

    /// @notice Settle a payment authorized by an EIP-712 signature from the agent's wallet.
    /// @dev    Strict CEI ordering: all checks first, all state writes next, transfers last.
    ///         The signer recovered from `signature` MUST equal
    ///         `IDENTITY.getAgentWallet(auth.agentId)` at the time of this call. If the agent
    ///         has transferred their NFT (or unset their wallet) since signing, this reverts.
    function pay(PaymentAuth calldata auth, bytes calldata signature) external nonReentrant {
        // ---- Checks ----
        if (block.timestamp > auth.deadline) revert AuthExpired();
        if (auth.merchant == address(0)) revert BadMerchant();
        if (auth.amount == 0) revert ZeroAmount();
        if (_usedNonces[auth.agentId][auth.nonce]) revert NonceAlreadyUsed();

        address expectedSigner = IDENTITY.getAgentWallet(auth.agentId);
        if (expectedSigner == address(0)) revert NoAgentWallet();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_AUTH_TYPEHASH,
                    auth.agentId,
                    auth.token,
                    auth.merchant,
                    auth.amount,
                    auth.challengeId,
                    auth.nonce,
                    auth.deadline
                )
            )
        );
        if (!_isValidSig(digest, expectedSigner, signature)) revert BadSigner();

        // Apply spending policy (writes spent, resets window if needed)
        _applyLimit(auth.agentId, auth.token, auth.amount);

        // ---- Effects ----
        _usedNonces[auth.agentId][auth.nonce] = true;

        uint256 fee = (auth.amount * feeBps) / 10_000;
        uint256 net = auth.amount - fee;

        // ---- Interactions ----
        // Two direct safeTransferFroms — contract never holds funds, never has an
        // internal balance state to drift from on-chain reality.
        IERC20(auth.token).safeTransferFrom(expectedSigner, auth.merchant, net);
        if (fee != 0) {
            IERC20(auth.token).safeTransferFrom(expectedSigner, treasury, fee);
        }

        emit Settled(
            auth.challengeId,
            auth.agentId,
            auth.merchant,
            auth.token,
            auth.amount,
            fee,
            auth.nonce,
            expectedSigner
        );
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        address previous = treasury;
        treasury = newTreasury;
        emit TreasurySet(previous, newTreasury);
    }

    // ---------------------------------------------------------------------
    // Views — useful for off-chain SDKs and the x402 gateway
    // ---------------------------------------------------------------------

    function getLimit(uint256 agentId, address token) external view returns (Limit memory) {
        return _limits[agentId][token];
    }

    function isNonceUsed(uint256 agentId, uint256 nonce) external view returns (bool) {
        return _usedNonces[agentId][nonce];
    }

    /// @notice Returns the EIP-712 digest the agent's wallet must sign for a given auth.
    ///         Off-chain SDKs can call this to avoid having to re-derive the domain separator.
    function paymentAuthHash(PaymentAuth calldata auth) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_AUTH_TYPEHASH,
                    auth.agentId,
                    auth.token,
                    auth.merchant,
                    auth.amount,
                    auth.challengeId,
                    auth.nonce,
                    auth.deadline
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _applyLimit(uint256 agentId, address token, uint256 amount) private {
        Limit storage L = _limits[agentId][token];
        if (!L.enabled) revert LimitDisabledOrUnset();
        if (amount > L.perTx) revert PerTxExceeded(amount, L.perTx);

        // Lazy window rollover: if the current window has elapsed, reset spent.
        if (block.timestamp >= uint256(L.periodStart) + uint256(L.periodLen)) {
            L.periodStart = uint64(block.timestamp);
            L.spentInPeriod = 0;
        }

        uint256 newSpent = uint256(L.spentInPeriod) + amount;
        if (newSpent > L.perPeriod) revert PerPeriodExceeded(newSpent, L.perPeriod);
        L.spentInPeriod = uint128(newSpent);
    }

    /// @dev Verifies `signature` against `digest` for `signer`. Tries ECDSA first
    ///      (covers EOAs and EIP-7702 delegated EOAs). Falls back to ERC-1271
    ///      `isValidSignature` for smart contract wallets (Safe, Argent, etc.).
    function _isValidSig(bytes32 digest, address signer, bytes calldata signature)
        private
        view
        returns (bool)
    {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;

        // ECDSA didn't match. If `signer` is an EOA there's nothing more to try.
        if (signer.code.length == 0) return false;

        // ERC-1271 fallback for contract wallets.
        (bool ok, bytes memory res) = signer.staticcall(
            abi.encodeCall(IERC1271.isValidSignature, (digest, signature))
        );
        return ok && res.length >= 32 && abi.decode(res, (bytes4)) == ERC1271_MAGICVALUE;
    }
}
