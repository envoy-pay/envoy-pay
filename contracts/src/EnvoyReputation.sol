// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title EnvoyReputation
/// @notice Lightweight on-chain reputation attestations for agents.
///         Attestations are caller-signed (msg.sender) and categorized.
/// @dev Categories (bytes32) are caller-defined hashes — e.g. keccak256("quality"),
///      keccak256("reliability"). Scores are 0–1000 (basis-point friendly).
contract EnvoyReputation {
    struct Attestation {
        address attester;
        bytes32 category;
        uint16 score;       // 0..1000
        uint64 timestamp;
        string evidenceURI; // optional pointer to off-chain evidence
    }

    /// @dev did hash → list of attestations
    mapping(bytes32 => Attestation[]) private _attestations;

    /// @dev (did hash, category, attester) → index+1 (0 means unset) for one-attestation-per-pair semantics
    mapping(bytes32 => mapping(bytes32 => mapping(address => uint256))) private _idx;

    event Attested(string indexed agentDID, bytes32 indexed category, address indexed attester, uint16 score, string evidenceURI);
    event Revoked(string indexed agentDID, bytes32 indexed category, address indexed attester);

    error ScoreOutOfRange();
    error AttestationNotFound();

    uint16 public constant MAX_SCORE = 1000;

    /// @notice Issue or update an attestation about an agent. One per (attester, category, did).
    function attest(
        string calldata agentDID,
        bytes32 category,
        uint16 score,
        string calldata evidenceURI
    ) external {
        if (score > MAX_SCORE) revert ScoreOutOfRange();

        bytes32 didKey = _key(agentDID);
        uint256 existingIdx = _idx[didKey][category][msg.sender];

        if (existingIdx == 0) {
            _attestations[didKey].push(
                Attestation({
                    attester: msg.sender,
                    category: category,
                    score: score,
                    timestamp: uint64(block.timestamp),
                    evidenceURI: evidenceURI
                })
            );
            _idx[didKey][category][msg.sender] = _attestations[didKey].length;
        } else {
            Attestation storage a = _attestations[didKey][existingIdx - 1];
            a.score = score;
            a.timestamp = uint64(block.timestamp);
            a.evidenceURI = evidenceURI;
        }

        emit Attested(agentDID, category, msg.sender, score, evidenceURI);
    }

    /// @notice Revoke your own attestation. Leaves a tombstone (score=0) — does not compact array to preserve indices.
    function revoke(string calldata agentDID, bytes32 category) external {
        bytes32 didKey = _key(agentDID);
        uint256 existingIdx = _idx[didKey][category][msg.sender];
        if (existingIdx == 0) revert AttestationNotFound();

        Attestation storage a = _attestations[didKey][existingIdx - 1];
        a.score = 0;
        a.timestamp = uint64(block.timestamp);
        a.evidenceURI = "";

        emit Revoked(agentDID, category, msg.sender);
    }

    /// @notice Return all attestations for an agent.
    function getAttestations(string calldata agentDID) external view returns (Attestation[] memory) {
        return _attestations[_key(agentDID)];
    }

    /// @notice Return only attestations in a specific category.
    function getAttestationsByCategory(string calldata agentDID, bytes32 category)
        external
        view
        returns (Attestation[] memory filtered)
    {
        Attestation[] storage all = _attestations[_key(agentDID)];
        uint256 count;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].category == category && all[i].score > 0) count++;
        }
        filtered = new Attestation[](count);
        uint256 j;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].category == category && all[i].score > 0) {
                filtered[j++] = all[i];
            }
        }
    }

    /// @notice Average score for an agent in a category (0 if none).
    function averageScore(string calldata agentDID, bytes32 category) external view returns (uint16) {
        Attestation[] storage all = _attestations[_key(agentDID)];
        uint256 total;
        uint256 count;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].category == category && all[i].score > 0) {
                total += all[i].score;
                count++;
            }
        }
        if (count == 0) return 0;
        return uint16(total / count);
    }

    function _key(string calldata did) private pure returns (bytes32) {
        return keccak256(bytes(did));
    }
}
