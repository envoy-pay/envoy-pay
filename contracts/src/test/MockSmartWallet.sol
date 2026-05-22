// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Minimal ERC-1271 smart wallet that delegates signature validation to a single
///         configured EOA. Used to test the Facilitator's ERC-1271 fallback path —
///         the wallet contract receives the digest, recovers the inner signature with
///         ECDSA, and returns the magic value iff the inner signer matches the
///         configured `signingKey`.
contract MockSmartWallet is IERC1271 {
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;
    address public immutable signingKey;

    constructor(address _signingKey) {
        signingKey = _signingKey;
    }

    receive() external payable {}

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signingKey) {
            return MAGICVALUE;
        }
        return 0xffffffff;
    }

    /// @dev Minimal call-forwarding helper so the wallet can `approve()` tokens it holds.
    ///      No access control — this is a test fixture, not a real wallet.
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "MockSmartWallet: exec failed");
        return ret;
    }
}
