// envoy on-chain layer — Celo Solidity contracts (registry, escrow, reputation, policy guard)

export {
  AgentRegistryClient,
  createAgentRegistry,
} from './agent-registry';
export type { AgentRecord, AgentRegistryOptions } from './agent-registry';

export {
  EscrowClient,
  createEscrow,
} from './escrow';
export type { DepositRecord, EscrowOptions, ReleaseSignaturePayload } from './escrow';

export {
  ReputationClient,
  createReputation,
} from './reputation';
export type { OnChainAttestation, ReputationOptions } from './reputation';

export {
  PolicyGuardClient,
  createPolicyGuard,
} from './policy-guard';
export type { PolicyState, PolicyGuardOptions } from './policy-guard';

export {
  ENVOY_CONTRACT_ADDRESSES,
  getEnvoyAddresses,
} from './addresses';
export type { EnvoyContractAddresses } from './addresses';

export { ENVOY_AGENT_REGISTRY_ABI } from './abis/EnvoyAgentRegistry';
export { ENVOY_ESCROW_ABI } from './abis/EnvoyEscrow';
export { ENVOY_REPUTATION_ABI } from './abis/EnvoyReputation';
export { ENVOY_POLICY_GUARD_ABI } from './abis/EnvoyPolicyGuard';
