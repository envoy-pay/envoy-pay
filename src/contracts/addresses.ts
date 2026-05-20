/**
 * envoy on-chain contract addresses, keyed by EIP-155 chainId.
 *
 * Mainnet (42220) and Alfajores (44787) entries are placeholders (zero address)
 * until the contracts are deployed. Run `npm run deploy:alfajores` in the
 * contracts/ workspace, then paste the printed JSON here.
 */
export interface EnvoyContractAddresses {
  registry: `0x${string}`;
  escrow: `0x${string}`;
  reputation: `0x${string}`;
  policyGuard: `0x${string}`;
}

const ZERO = '0x0000000000000000000000000000000000000000' as const;

export const ENVOY_CONTRACT_ADDRESSES: Record<number, EnvoyContractAddresses> = {
  // Celo Mainnet — fill in after deployment
  42220: {
    registry: ZERO,
    escrow: ZERO,
    reputation: ZERO,
    policyGuard: ZERO,
  },
  // Celo Alfajores Testnet — fill in after deployment
  44787: {
    registry: ZERO,
    escrow: ZERO,
    reputation: ZERO,
    policyGuard: ZERO,
  },
};

/** Lookup helper. Throws if the chain has no envoy deployment. */
export function getEnvoyAddresses(chainId: number): EnvoyContractAddresses {
  const addresses = ENVOY_CONTRACT_ADDRESSES[chainId];
  if (!addresses) {
    throw new Error(
      `envoy contracts are not deployed on chainId ${chainId}. ` +
      `Available: ${Object.keys(ENVOY_CONTRACT_ADDRESSES).join(', ')}`,
    );
  }
  return addresses;
}
