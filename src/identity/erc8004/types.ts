import type { Address, Hex } from 'viem';

/** ERC-8004 agent identifier. Equals the NFT tokenId on the canonical Identity Registry. */
export type AgentId = bigint;

/** A single metadata entry stored on the canonical Identity Registry, addressable by key. */
export interface MetadataEntry {
  key: string;
  value: Hex;
}

/** Aggregated read of an agent's canonical record. */
export interface CanonicalAgent {
  agentId: AgentId;
  owner: Address;
  agentWallet: Address;
  tokenURI: string;
}

/** Arguments for `giveFeedback` on the canonical Reputation Registry. */
export interface FeedbackArgs {
  agentId: AgentId;
  /** Signed value, encoded with `valueDecimals` decimals (e.g. 4500 with decimals=2 → 45.00). */
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  /** Origin / endpoint the agent was used through, free-form. */
  endpoint: string;
  /** URI to a richer feedback document (IPFS, https, data:). */
  feedbackURI: string;
  /** Optional integrity hash of the feedback URI's contents. */
  feedbackHash: Hex;
}
