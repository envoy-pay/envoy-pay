export const ENVOY_POLICY_GUARD_ABI = [
  { type: 'function', name: 'setPolicy', stateMutability: 'nonpayable', inputs: [
    { name: 'agent', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'dailyLimit', type: 'uint256' },
  ], outputs: [] },
  { type: 'function', name: 'revokePolicy', stateMutability: 'nonpayable', inputs: [
    { name: 'agent', type: 'address' },
    { name: 'token', type: 'address' },
  ], outputs: [] },
  { type: 'function', name: 'checkAndSpend', stateMutability: 'nonpayable', inputs: [
    { name: 'agent', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ], outputs: [] },
  { type: 'function', name: 'getPolicy', stateMutability: 'view', inputs: [
    { name: 'agent', type: 'address' },
    { name: 'token', type: 'address' },
  ], outputs: [
    { name: 'owner', type: 'address' },
    { name: 'dailyLimit', type: 'uint256' },
    { name: 'spentToday', type: 'uint256' },
    { name: 'windowStart', type: 'uint64' },
    { name: 'active', type: 'bool' },
    { name: 'remainingToday', type: 'uint256' },
  ] },
] as const;
