// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title EnvoyAgentRegistry
/// @notice On-chain registry mapping agent DIDs to owner addresses + metadata URIs.
///         Inspired by ERC-8004 (agent identity), tailored for Celo.
/// @dev Each DID is unique. Owners can update metadata or revoke. Anyone can read.
contract EnvoyAgentRegistry {
    struct Agent {
        address owner;
        string metadataURI;
        bool revoked;
        uint64 registeredAt;
        uint64 updatedAt;
    }

    mapping(bytes32 => Agent) private _agents;

    event AgentRegistered(string indexed did, address indexed owner, string metadataURI);
    event AgentUpdated(string indexed did, string metadataURI);
    event AgentRevoked(string indexed did);
    event AgentOwnerTransferred(string indexed did, address indexed previousOwner, address indexed newOwner);

    error AgentAlreadyExists();
    error AgentNotFound();
    error NotAgentOwner();
    error AgentIsRevoked();
    error InvalidOwner();

    modifier onlyOwner(string calldata did) {
        bytes32 key = _key(did);
        Agent storage a = _agents[key];
        if (a.owner == address(0)) revert AgentNotFound();
        if (a.owner != msg.sender) revert NotAgentOwner();
        _;
    }

    /// @notice Register a new agent.
    /// @param did Agent's decentralized identifier (any string format, e.g. "did:envoy:0x..").
    /// @param owner The wallet that controls this agent identity.
    /// @param metadataURI URI pointing to the agent card (IPFS / HTTPS / data:).
    function registerAgent(
        string calldata did,
        address owner,
        string calldata metadataURI
    ) external {
        if (owner == address(0)) revert InvalidOwner();
        bytes32 key = _key(did);
        if (_agents[key].owner != address(0)) revert AgentAlreadyExists();

        _agents[key] = Agent({
            owner: owner,
            metadataURI: metadataURI,
            revoked: false,
            registeredAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });

        emit AgentRegistered(did, owner, metadataURI);
    }

    /// @notice Update the metadata URI for an agent (owner-only).
    function updateAgent(string calldata did, string calldata metadataURI) external onlyOwner(did) {
        bytes32 key = _key(did);
        Agent storage a = _agents[key];
        if (a.revoked) revert AgentIsRevoked();
        a.metadataURI = metadataURI;
        a.updatedAt = uint64(block.timestamp);
        emit AgentUpdated(did, metadataURI);
    }

    /// @notice Transfer ownership of an agent identity to a new wallet.
    function transferAgentOwnership(string calldata did, address newOwner) external onlyOwner(did) {
        if (newOwner == address(0)) revert InvalidOwner();
        bytes32 key = _key(did);
        Agent storage a = _agents[key];
        address previous = a.owner;
        a.owner = newOwner;
        a.updatedAt = uint64(block.timestamp);
        emit AgentOwnerTransferred(did, previous, newOwner);
    }

    /// @notice Revoke an agent (owner-only). Revoked agents remain queryable.
    function revokeAgent(string calldata did) external onlyOwner(did) {
        bytes32 key = _key(did);
        _agents[key].revoked = true;
        _agents[key].updatedAt = uint64(block.timestamp);
        emit AgentRevoked(did);
    }

    /// @notice Read an agent record.
    function getAgent(string calldata did)
        external
        view
        returns (
            address owner,
            string memory metadataURI,
            bool revoked,
            uint64 registeredAt,
            uint64 updatedAt
        )
    {
        Agent storage a = _agents[_key(did)];
        if (a.owner == address(0)) revert AgentNotFound();
        return (a.owner, a.metadataURI, a.revoked, a.registeredAt, a.updatedAt);
    }

    /// @notice Check whether a DID is registered (and not revoked).
    function isActive(string calldata did) external view returns (bool) {
        Agent storage a = _agents[_key(did)];
        return a.owner != address(0) && !a.revoked;
    }

    function _key(string calldata did) private pure returns (bytes32) {
        return keccak256(bytes(did));
    }
}
