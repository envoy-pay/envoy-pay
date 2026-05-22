// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.27;

/// @notice Test double for the canonical ERC-8004 Identity Registry.
///         Provides only the subset of behavior `EnvoyFacilitator` consumes,
///         plus knobs to manipulate state directly from tests.
contract MockIdentityRegistry {
    error AgentDoesNotExist(uint256 agentId);

    /// agentId => owner address (the ERC-721 holder equivalent)
    mapping(uint256 => address) public ownerOfAgent;

    /// agentId => operational signing wallet
    mapping(uint256 => address) public agentWalletOf;

    /// agentId => operator => approved (full account-level approval)
    mapping(uint256 => mapping(address => bool)) public approvedOperatorFor;

    function register(address owner, uint256 agentId, address agentWallet) external {
        ownerOfAgent[agentId] = owner;
        agentWalletOf[agentId] = agentWallet;
    }

    function setAgentWallet(uint256 agentId, address newWallet) external {
        agentWalletOf[agentId] = newWallet;
    }

    function approve(uint256 agentId, address operator, bool ok) external {
        approvedOperatorFor[agentId][operator] = ok;
    }

    function transferAgent(uint256 agentId, address newOwner) external {
        ownerOfAgent[agentId] = newOwner;
        // Canonical 8004 clears agentWallet on transfer — mirror that here.
        agentWalletOf[agentId] = address(0);
    }

    // ---- Read surface used by EnvoyFacilitator ----

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return agentWalletOf[agentId];
    }

    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        address owner = ownerOfAgent[agentId];
        if (owner == address(0)) revert AgentDoesNotExist(agentId);
        return spender == owner || approvedOperatorFor[agentId][spender];
    }
}
