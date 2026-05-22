// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EnvoyPolicyGuard
/// @notice Trust-minimized daily spending caps for agent wallets. Agents (or their
///         delegated session keys) call `checkAndSpend` instead of moving funds
///         directly; the guard enforces the policy on every call.
/// @dev Owners (typically the human who created the agent) set caps. Caps reset
///      every 24h based on wallclock.
contract EnvoyPolicyGuard {
    using SafeERC20 for IERC20;

    struct Policy {
        address owner;
        uint256 dailyLimit;
        uint256 spentToday;
        uint64 windowStart;
        bool active;
    }

    /// @dev (agent, token) → policy
    mapping(address => mapping(address => Policy)) private _policies;

    event PolicySet(address indexed agent, address indexed token, address indexed owner, uint256 dailyLimit);
    event PolicyRevoked(address indexed agent, address indexed token);
    event Spent(address indexed agent, address indexed token, address indexed recipient, uint256 amount);

    error PolicyNotFound();
    error NotPolicyOwner();
    error DailyLimitExceeded();
    error PolicyInactive();
    error ZeroLimit();

    uint64 public constant WINDOW = 1 days;

    /// @notice Set or update a daily limit for an agent on a specific token.
    /// @dev First setter becomes owner. Subsequent updates require msg.sender == owner.
    function setPolicy(address agent, IERC20 token, uint256 dailyLimit) external {
        if (dailyLimit == 0) revert ZeroLimit();
        Policy storage p = _policies[agent][address(token)];
        if (p.owner == address(0)) {
            p.owner = msg.sender;
        } else if (p.owner != msg.sender) {
            revert NotPolicyOwner();
        }
        p.dailyLimit = dailyLimit;
        p.active = true;
        if (p.windowStart == 0) {
            p.windowStart = uint64(block.timestamp);
        }
        emit PolicySet(agent, address(token), p.owner, dailyLimit);
    }

    /// @notice Revoke a policy (no further spends allowed).
    function revokePolicy(address agent, IERC20 token) external {
        Policy storage p = _policies[agent][address(token)];
        if (p.owner == address(0)) revert PolicyNotFound();
        if (p.owner != msg.sender) revert NotPolicyOwner();
        p.active = false;
        emit PolicyRevoked(agent, address(token));
    }

    /// @notice Agent (or delegated session key) executes a spend. Caller must equal `agent`.
    /// @dev Requires the agent to have approved this contract for `amount` first.
    function checkAndSpend(
        address agent,
        IERC20 token,
        uint256 amount,
        address recipient
    ) external {
        require(msg.sender == agent, "envoy: caller must be agent");
        Policy storage p = _policies[agent][address(token)];
        if (p.owner == address(0)) revert PolicyNotFound();
        if (!p.active) revert PolicyInactive();

        if (block.timestamp >= p.windowStart + WINDOW) {
            p.windowStart = uint64(block.timestamp);
            p.spentToday = 0;
        }

        uint256 newSpent = p.spentToday + amount;
        if (newSpent > p.dailyLimit) revert DailyLimitExceeded();
        p.spentToday = newSpent;

        token.safeTransferFrom(agent, recipient, amount);
        emit Spent(agent, address(token), recipient, amount);
    }

    /// @notice Read current policy state for an agent/token pair.
    function getPolicy(address agent, IERC20 token)
        external
        view
        returns (
            address owner,
            uint256 dailyLimit,
            uint256 spentToday,
            uint64 windowStart,
            bool active,
            uint256 remainingToday
        )
    {
        Policy storage p = _policies[agent][address(token)];
        uint256 effectiveSpent = p.spentToday;
        if (block.timestamp >= p.windowStart + WINDOW) {
            effectiveSpent = 0;
        }
        uint256 remaining = effectiveSpent >= p.dailyLimit ? 0 : p.dailyLimit - effectiveSpent;
        return (p.owner, p.dailyLimit, effectiveSpent, p.windowStart, p.active, remaining);
    }
}
