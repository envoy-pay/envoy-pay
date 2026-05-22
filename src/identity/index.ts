// Identity Layer — Barrel exports
//
// This module ships two layers:
//   - Off-chain TypeScript primitives (AgentIdentity, DIDResolver, ...) for
//     building agent cards, resolving DIDs, scoring reputation, etc.
//   - On-chain helpers under `./erc8004/` for the canonical Celo ERC-8004
//     Identity + Reputation registries (re-exported as `erc8004` below).

export { AgentIdentity } from './agent-identity';
export { DIDResolver } from './did-resolver';
export { AgentCard } from './agent-card';
export { Reputation } from './reputation';
export { OwnerRegistry } from './owner-registry';
export type {
  AgentDID,
  DIDDocument,
  VerificationMethod,
  ServiceEndpoint,
  AgentCardData,
  AgentIdentityOptions,
  ReputationAttestation,
  ReputationCategory,
  ReputationProfile,
  CreateAttestationOptions,
  OwnerRecord,
  DelegationLevel,
  ResolvedIdentity,
  ResolveOptions,
} from './types';

// Canonical Celo ERC-8004 helpers — Identity + Reputation registries.
export * as erc8004 from './erc8004';
export type { AgentId, CanonicalAgent, MetadataEntry, FeedbackArgs } from './erc8004';
