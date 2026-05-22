/**
 * Canonical Celo ERC-8004 helpers — Identity + Reputation registries.
 *
 * These wrap the read/write surface envoy needs from the canonical contracts
 * deployed on Celo (mainnet + Sepolia). All helpers are pure functions taking
 * a viem client; no global state, no hidden singletons.
 *
 * Pull the registry addresses from `getEnvoyAddresses(chainId)`.
 */

export {
  registerAgent,
  setAgentWallet,
  unsetAgentWallet,
  setAgentURI,
  setMetadata,
  getAgentWallet,
  getAgentOwner,
  getAgentURI,
  getMetadata,
  isAuthorizedOrOwner,
  getAgent,
  agentWalletRotationTypedData,
  encodeStringMetadata,
  encodeBytesMetadata,
  contentHash,
} from './identity';
export type { RegisterAgentArgs } from './identity';

export { giveFeedback, revokeFeedback, makeScoreFeedback } from './reputation';

export { ERC8004_IDENTITY_ABI, ERC8004_REPUTATION_ABI } from './abis';
export type { AgentId, CanonicalAgent, MetadataEntry, FeedbackArgs } from './types';
