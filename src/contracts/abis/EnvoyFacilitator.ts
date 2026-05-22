/**
 * Minimal ABI for `EnvoyFacilitator.sol`. Hand-curated to expose only the
 * functions and events the SDK touches — keep it lean so callers' bundles
 * don't carry hardhat/typechain output.
 *
 * Marked `as const` so viem can infer types end-to-end.
 */

export const ENVOY_FACILITATOR_ABI = [
  // ---- writes ----
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'auth',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'merchant', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'challengeId', type: 'bytes32' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint64' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setLimit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'perTx', type: 'uint128' },
      { name: 'perPeriod', type: 'uint128' },
      { name: 'periodLen', type: 'uint32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'disableLimit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setTreasury',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newTreasury', type: 'address' }],
    outputs: [],
  },
  // ---- reads ----
  {
    type: 'function',
    name: 'IDENTITY',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'feeBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'MAX_FEE_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'treasury',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getLimit',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'perTx', type: 'uint128' },
          { name: 'perPeriod', type: 'uint128' },
          { name: 'spentInPeriod', type: 'uint128' },
          { name: 'periodStart', type: 'uint64' },
          { name: 'periodLen', type: 'uint32' },
          { name: 'enabled', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'isNonceUsed',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'paymentAuthHash',
    stateMutability: 'view',
    inputs: [
      {
        name: 'auth',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'merchant', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'challengeId', type: 'bytes32' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint64' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'domainSeparator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  // ---- events ----
  {
    type: 'event',
    name: 'Settled',
    inputs: [
      { name: 'challengeId', type: 'bytes32', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'merchant', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'signer', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LimitSet',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'perTx', type: 'uint128', indexed: false },
      { name: 'perPeriod', type: 'uint128', indexed: false },
      { name: 'periodLen', type: 'uint32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LimitDisabled',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'token', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'TreasurySet',
    inputs: [
      { name: 'previous', type: 'address', indexed: true },
      { name: 'current', type: 'address', indexed: true },
    ],
  },
] as const;
