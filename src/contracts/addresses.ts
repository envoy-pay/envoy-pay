/**
 * Contract addresses for envoy's on-chain layer plus the canonical ERC-8004 registries
 * on Celo. Keyed by EIP-155 chainId.
 *
 *  - `facilitator`         → `EnvoyFacilitator.sol` (this repo) — placeholder until deployed
 *  - `identityRegistry`    → canonical ERC-8004 Identity Registry on Celo
 *  - `reputationRegistry`  → canonical ERC-8004 Reputation Registry on Celo
 *
 * Run `npm run deploy:celoSepolia` in the contracts/ workspace, then paste the
 * printed JSON to fill in the `facilitator` entries.
 */

export interface EnvoyContractAddresses {
  facilitator: `0x${string}`;
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
}

const ZERO = '0x0000000000000000000000000000000000000000' as const;

/** Celo Mainnet (42220) */
export const CELO_MAINNET = 42220 as const;
/** Celo Sepolia (11142220) — active testnet; replaces Alfajores */
export const CELO_SEPOLIA = 11142220 as const;

export const ENVOY_CONTRACT_ADDRESSES: Record<number, EnvoyContractAddresses> = {
  [CELO_MAINNET]: {
    facilitator: ZERO,
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
  [CELO_SEPOLIA]: {
    facilitator: ZERO,
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  },
};

/** Lookup helper. Throws if the chain has no envoy mapping. */
export function getEnvoyAddresses(chainId: number): EnvoyContractAddresses {
  const addresses = ENVOY_CONTRACT_ADDRESSES[chainId];
  if (!addresses) {
    throw new Error(
      `envoy is not configured for chainId ${chainId}. ` +
        `Supported: ${Object.keys(ENVOY_CONTRACT_ADDRESSES).join(', ')}`,
    );
  }
  return addresses;
}
