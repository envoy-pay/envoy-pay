export const ENVOY_REPUTATION_ABI = [
  { type: 'function', name: 'attest', stateMutability: 'nonpayable', inputs: [
    { name: 'agentDID', type: 'string' },
    { name: 'category', type: 'bytes32' },
    { name: 'score', type: 'uint16' },
    { name: 'evidenceURI', type: 'string' },
  ], outputs: [] },
  { type: 'function', name: 'revoke', stateMutability: 'nonpayable', inputs: [
    { name: 'agentDID', type: 'string' },
    { name: 'category', type: 'bytes32' },
  ], outputs: [] },
  { type: 'function', name: 'getAttestations', stateMutability: 'view', inputs: [{ name: 'agentDID', type: 'string' }], outputs: [{
    type: 'tuple[]',
    components: [
      { name: 'attester', type: 'address' },
      { name: 'category', type: 'bytes32' },
      { name: 'score', type: 'uint16' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'evidenceURI', type: 'string' },
    ],
  }] },
  { type: 'function', name: 'getAttestationsByCategory', stateMutability: 'view', inputs: [
    { name: 'agentDID', type: 'string' },
    { name: 'category', type: 'bytes32' },
  ], outputs: [{
    type: 'tuple[]',
    components: [
      { name: 'attester', type: 'address' },
      { name: 'category', type: 'bytes32' },
      { name: 'score', type: 'uint16' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'evidenceURI', type: 'string' },
    ],
  }] },
  { type: 'function', name: 'averageScore', stateMutability: 'view', inputs: [
    { name: 'agentDID', type: 'string' },
    { name: 'category', type: 'bytes32' },
  ], outputs: [{ type: 'uint16' }] },
] as const;
