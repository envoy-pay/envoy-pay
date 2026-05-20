export const ENVOY_ESCROW_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'paymentId', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint64' },
  ], outputs: [] },
  { type: 'function', name: 'release', stateMutability: 'nonpayable', inputs: [
    { name: 'paymentId', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'signature', type: 'bytes' },
  ], outputs: [] },
  { type: 'function', name: 'refund', stateMutability: 'nonpayable', inputs: [{ name: 'paymentId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'getDeposit', stateMutability: 'view', inputs: [{ name: 'paymentId', type: 'bytes32' }], outputs: [
    { name: 'payer', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'createdAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'settled', type: 'bool' },
  ] },
  { type: 'function', name: 'facilitator', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'setFacilitator', stateMutability: 'nonpayable', inputs: [{ name: 'newFacilitator', type: 'address' }], outputs: [] },
  { type: 'function', name: 'domainSeparator', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
] as const;
