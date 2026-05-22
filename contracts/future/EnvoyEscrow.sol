// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title EnvoyEscrow
/// @notice Holds agent funds for x402/MPP payments. Funds release on an EIP-712
///         signed receipt from the facilitator authority, or refund after timeout.
/// @dev paymentId is supplied by the caller (e.g. challenge id or random) and must be unique per agent.
contract EnvoyEscrow is EIP712, Ownable {
    using SafeERC20 for IERC20;

    struct Deposit {
        address payer;
        address token;
        uint256 amount;
        uint64 createdAt;
        uint64 expiresAt;
        bool settled;
    }

    bytes32 private constant RELEASE_TYPEHASH = keccak256(
        "Release(bytes32 paymentId,address recipient,uint256 amount,uint256 deadline)"
    );

    /// @notice Trusted facilitator authority — only signatures from this address release funds.
    address public facilitator;

    mapping(bytes32 => Deposit) private _deposits;

    event Deposited(bytes32 indexed paymentId, address indexed payer, address indexed token, uint256 amount, uint64 expiresAt);
    event Released(bytes32 indexed paymentId, address indexed recipient, uint256 amount);
    event Refunded(bytes32 indexed paymentId, address indexed payer, uint256 amount);
    event FacilitatorUpdated(address indexed previous, address indexed current);

    error DepositExists();
    error DepositNotFound();
    error AlreadySettled();
    error NotExpired();
    error DeadlinePassed();
    error InvalidSignature();
    error ZeroAmount();
    error AmountExceedsDeposit();
    error InvalidExpiry();

    constructor(address initialOwner, address initialFacilitator)
        EIP712("EnvoyEscrow", "1")
        Ownable(initialOwner)
    {
        facilitator = initialFacilitator;
        emit FacilitatorUpdated(address(0), initialFacilitator);
    }

    /// @notice Update the facilitator signing authority. Owner-only.
    function setFacilitator(address newFacilitator) external onlyOwner {
        address previous = facilitator;
        facilitator = newFacilitator;
        emit FacilitatorUpdated(previous, newFacilitator);
    }

    /// @notice Lock funds against a payment id.
    /// @param token ERC-20 token to deposit (cUSD, USDC, etc.).
    /// @param amount Token amount in atomic units.
    /// @param paymentId Caller-chosen unique identifier (e.g. challenge id).
    /// @param expiresAt Unix timestamp after which the payer can refund. Must be > now.
    function deposit(
        IERC20 token,
        uint256 amount,
        bytes32 paymentId,
        uint64 expiresAt
    ) external {
        if (amount == 0) revert ZeroAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (_deposits[paymentId].payer != address(0)) revert DepositExists();

        token.safeTransferFrom(msg.sender, address(this), amount);

        _deposits[paymentId] = Deposit({
            payer: msg.sender,
            token: address(token),
            amount: amount,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            settled: false
        });

        emit Deposited(paymentId, msg.sender, address(token), amount, expiresAt);
    }

    /// @notice Release funds to recipient. Caller submits an EIP-712 signature from the facilitator.
    /// @dev Partial release supported: amount ≤ deposit.amount. Remainder stays locked.
    function release(
        bytes32 paymentId,
        address recipient,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert DeadlinePassed();
        Deposit storage d = _deposits[paymentId];
        if (d.payer == address(0)) revert DepositNotFound();
        if (d.settled) revert AlreadySettled();
        if (amount == 0) revert ZeroAmount();
        if (amount > d.amount) revert AmountExceedsDeposit();

        bytes32 structHash = keccak256(
            abi.encode(RELEASE_TYPEHASH, paymentId, recipient, amount, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (signer != facilitator) revert InvalidSignature();

        d.settled = true;
        IERC20(d.token).safeTransfer(recipient, amount);

        if (amount < d.amount) {
            uint256 remainder = d.amount - amount;
            IERC20(d.token).safeTransfer(d.payer, remainder);
        }

        emit Released(paymentId, recipient, amount);
    }

    /// @notice Refund a deposit back to the payer after expiry.
    function refund(bytes32 paymentId) external {
        Deposit storage d = _deposits[paymentId];
        if (d.payer == address(0)) revert DepositNotFound();
        if (d.settled) revert AlreadySettled();
        if (block.timestamp < d.expiresAt) revert NotExpired();

        d.settled = true;
        uint256 amount = d.amount;
        IERC20(d.token).safeTransfer(d.payer, amount);

        emit Refunded(paymentId, d.payer, amount);
    }

    /// @notice Read a deposit record.
    function getDeposit(bytes32 paymentId)
        external
        view
        returns (
            address payer,
            address token,
            uint256 amount,
            uint64 createdAt,
            uint64 expiresAt,
            bool settled
        )
    {
        Deposit storage d = _deposits[paymentId];
        return (d.payer, d.token, d.amount, d.createdAt, d.expiresAt, d.settled);
    }

    /// @notice EIP-712 domain separator (exposed for off-chain signing).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
