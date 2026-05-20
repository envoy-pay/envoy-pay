export const ENVOY_AGENT_REGISTRY_ABI = [
  { type: 'function', name: 'registerAgent', stateMutability: 'nonpayable', inputs: [{ name: 'did', type: 'string' }, { name: 'owner', type: 'address' }, { name: 'metadataURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'updateAgent', stateMutability: 'nonpayable', inputs: [{ name: 'did', type: 'string' }, { name: 'metadataURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'transferAgentOwnership', stateMutability: 'nonpayable', inputs: [{ name: 'did', type: 'string' }, { name: 'newOwner', type: 'address' }], outputs: [] },
  { type: 'function', name: 'revokeAgent', stateMutability: 'nonpayable', inputs: [{ name: 'did', type: 'string' }], outputs: [] },
  { type: 'function', name: 'getAgent', stateMutability: 'view', inputs: [{ name: 'did', type: 'string' }], outputs: [
    { name: 'owner', type: 'address' },
    { name: 'metadataURI', type: 'string' },
    { name: 'revoked', type: 'bool' },
    { name: 'registeredAt', type: 'uint64' },
    { name: 'updatedAt', type: 'uint64' },
  ] },
  { type: 'function', name: 'isActive', stateMutability: 'view', inputs: [{ name: 'did', type: 'string' }], outputs: [{ type: 'bool' }] },
  { type: 'event', name: 'AgentRegistered', anonymous: false, inputs: [
    { name: 'did', type: 'string', indexed: true },
    { name: 'owner', type: 'address', indexed: true },
    { name: 'metadataURI', type: 'string', indexed: false },
  ] },
  { type: 'event', name: 'AgentUpdated', anonymous: false, inputs: [
    { name: 'did', type: 'string', indexed: true },
    { name: 'metadataURI', type: 'string', indexed: false },
  ] },
  { type: 'event', name: 'AgentRevoked', anonymous: false, inputs: [
    { name: 'did', type: 'string', indexed: true },
  ] },
] as const;
