import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  formatUnits,
  type WalletClient,
  type PublicClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  base,
  baseSepolia,
  arbitrum,
  arbitrumSepolia,
  optimism,
  optimismSepolia,
  mainnet as ethereum,
  sepolia as ethereumSepolia,
  polygon,
  polygonAmoy,
  xLayer,
  xLayerTestnet,
  celo,
  celoAlfajores,
} from 'viem/chains';
import { PaymentAdapter } from './types';
import { Logger, noopLogger } from '../logger';

// ─── Supported Chains Registry ──────────────────────────────────────

/** All EVM chains supported by envoy-pay. Celo is the first-class default. */
export type EvmChainName =
  | 'celo'
  | 'celo-alfajores'
  | 'base'
  | 'base-sepolia'
  | 'arbitrum'
  | 'arbitrum-sepolia'
  | 'optimism'
  | 'optimism-sepolia'
  | 'ethereum'
  | 'ethereum-sepolia'
  | 'polygon'
  | 'polygon-amoy'
  | 'xlayer'
  | 'xlayer-testnet';

/** ERC-20 stablecoin descriptor (address + decimals). */
export interface StablecoinInfo {
  address: `0x${string}`;
  decimals: number;
}

interface ChainConfig {
  chain: Chain;
  displayName: string;
  /** Circle USDC contract (null if no official USDC on this network). Legacy field — also present in `stablecoins`. */
  usdc: `0x${string}` | null;
  /** All known stablecoins on this chain, keyed by symbol. */
  stablecoins: Record<string, StablecoinInfo>;
}

/**
 * Chain registry — maps chain names to viem chain objects + stablecoin contracts.
 * Celo leads as the first-class chain. All USDC addresses are Circle's official
 * native USDC deployments. cUSD/cEUR/cREAL are Mento stablecoins.
 */
const CHAIN_REGISTRY: Record<EvmChainName, ChainConfig> = {
  // ── Celo (first-class, default) ─────────────────────────────────
  'celo': {
    chain: celo,
    displayName: 'Celo',
    usdc: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    stablecoins: {
      USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
      cUSD: { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
      cEUR: { address: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73', decimals: 18 },
      cREAL: { address: '0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787', decimals: 18 },
      USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
    },
  },
  'celo-alfajores': {
    chain: celoAlfajores,
    displayName: 'Celo Alfajores',
    usdc: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
    stablecoins: {
      USDC: { address: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B', decimals: 6 },
      cUSD: { address: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1', decimals: 18 },
      cEUR: { address: '0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F', decimals: 18 },
    },
  },

  // ── Base (Coinbase L2) ──────────────────────────────────────────
  'base': {
    chain: base,
    displayName: 'Base',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    stablecoins: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    },
  },
  'base-sepolia': {
    chain: baseSepolia,
    displayName: 'Base Sepolia',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    stablecoins: {
      USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
    },
  },

  // ── Arbitrum ────────────────────────────────────────────────────
  'arbitrum': {
    chain: arbitrum,
    displayName: 'Arbitrum One',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    stablecoins: {
      USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    },
  },
  'arbitrum-sepolia': {
    chain: arbitrumSepolia,
    displayName: 'Arbitrum Sepolia',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    stablecoins: {
      USDC: { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6 },
    },
  },

  // ── Optimism ────────────────────────────────────────────────────
  'optimism': {
    chain: optimism,
    displayName: 'Optimism',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    stablecoins: {
      USDC: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    },
  },
  'optimism-sepolia': {
    chain: optimismSepolia,
    displayName: 'Optimism Sepolia',
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    stablecoins: {
      USDC: { address: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', decimals: 6 },
    },
  },

  // ── Ethereum ────────────────────────────────────────────────────
  'ethereum': {
    chain: ethereum,
    displayName: 'Ethereum',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    stablecoins: {
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    },
  },
  'ethereum-sepolia': {
    chain: ethereumSepolia,
    displayName: 'Ethereum Sepolia',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    stablecoins: {
      USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
    },
  },

  // ── Polygon ─────────────────────────────────────────────────────
  'polygon': {
    chain: polygon,
    displayName: 'Polygon',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    stablecoins: {
      USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    },
  },
  'polygon-amoy': {
    chain: polygonAmoy,
    displayName: 'Polygon Amoy',
    usdc: null,
    stablecoins: {},
  },

  // ── X Layer (OKX L2, Polygon CDK) ───────────────────────────────
  'xlayer': {
    chain: xLayer,
    displayName: 'X Layer',
    usdc: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
    stablecoins: {
      USDC: { address: '0x74b7f16337b8972027f6196a17a631ac6de26d22', decimals: 6 },
    },
  },
  'xlayer-testnet': {
    chain: xLayerTestnet,
    displayName: 'X Layer Testnet',
    usdc: null,
    stablecoins: {},
  },
};

// ─── ERC-20 ABI (minimal) ───────────────────────────────────────────

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'to', type: 'address' as const },
      { name: 'amount', type: 'uint256' as const },
    ],
    outputs: [{ name: '', type: 'bool' as const }],
  },
  {
    name: 'balanceOf',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' as const }],
    outputs: [{ name: '', type: 'uint256' as const }],
  },
] as const;

// ─── Adapter Options ────────────────────────────────────────────────

export interface EvmAdapterOptions {
  /**
   * Chain to settle on.
   * @example 'base', 'arbitrum', 'optimism', 'ethereum', 'polygon'
   * @example 'base-sepolia', 'arbitrum-sepolia' (testnets)
   */
  chain: EvmChainName;
  /**
   * Asset to settle with.
   * - 'native' — chain's native token (ETH on L1/L2, MATIC on Polygon, CELO on Celo)
   * - 'USDC' — Circle's native USDC (ERC-20)
   * - 'cUSD' / 'cEUR' / 'cREAL' — Mento stablecoins (Celo only)
   * - any string symbol present in the chain's `stablecoins` map
   * @default 'native'
   */
  asset?: 'native' | 'USDC' | 'cUSD' | 'cEUR' | 'cREAL' | 'USDT' | string;
  /** Hex private key (0x-prefixed). If omitted, a random key is generated. */
  privateKey?: `0x${string}`;
  /** Optional custom RPC URL. Uses viem's default public RPCs if omitted. */
  rpcUrl?: string;
  /** Optional logger. SDK is silent by default. */
  logger?: Logger;
}

// ─── Universal EVM Adapter ──────────────────────────────────────────

/**
 * EvmPaymentAdapter — Universal EVM on-chain settlement.
 *
 * One adapter for ALL EVM chains supported by x402:
 * Base, Arbitrum, Optimism, Ethereum, Polygon — mainnet & testnet.
 *
 * Supports native token (ETH/MATIC) and USDC (Circle ERC-20) transfers.
 *
 * @example
 * ```ts
 * // Arbitrum USDC settlement
 * const adapter = new EvmPaymentAdapter({
 *   chain: 'arbitrum',
 *   asset: 'USDC',
 *   privateKey: '0x...',
 * });
 *
 * // Base ETH settlement (testnet)
 * const adapter = new EvmPaymentAdapter({
 *   chain: 'base-sepolia',
 *   asset: 'native',
 * });
 * ```
 *
 * @see https://x402.org — x402 payment protocol
 * @see https://envoy.dev — envoy production infrastructure
 */
export class EvmPaymentAdapter implements PaymentAdapter {
  public readonly chainName: string;
  public readonly caip2Id: string;

  private wallet: WalletClient;
  private publicClient: PublicClient;
  private account: ReturnType<typeof privateKeyToAccount>;
  private chainConfig: ChainConfig;
  private asset: string;
  private log: Logger;

  constructor(options: EvmAdapterOptions) {
    const config = CHAIN_REGISTRY[options.chain];
    if (!config) {
      throw new Error(
        `Unsupported chain: "${options.chain}". ` +
        `Supported: ${Object.keys(CHAIN_REGISTRY).join(', ')}`
      );
    }

    this.chainConfig = config;
    this.chainName = config.displayName;
    this.caip2Id = `eip155:${config.chain.id}`;
    this.asset = options.asset ?? 'native';
    this.log = options.logger ?? noopLogger;

    if (this.asset !== 'native' && !config.stablecoins[this.asset]) {
      const available = Object.keys(config.stablecoins);
      throw new Error(
        `Asset "${this.asset}" not available on ${config.displayName}. ` +
        `Available: native${available.length ? ', ' + available.join(', ') : ''}.`
      );
    }

    const key = options.privateKey ?? generatePrivateKey();
    this.account = privateKeyToAccount(key);

    const transport = options.rpcUrl ? http(options.rpcUrl) : http();

    this.wallet = createWalletClient({
      account: this.account,
      chain: config.chain,
      transport,
    });

    this.publicClient = createPublicClient({
      chain: config.chain,
      transport,
    }) as PublicClient;
  }

  getAddress(): string {
    return this.account.address;
  }

  /** Get native token balance (ETH, MATIC, etc.). */
  async getNativeBalance(): Promise<string> {
    const balance = await this.publicClient.getBalance({
      address: this.account.address,
    });
    return formatEther(balance);
  }

  /** Get USDC balance (6 decimals). Returns '0.00' if USDC not supported. */
  async getUsdcBalance(): Promise<string> {
    return this.getStablecoinBalance('USDC');
  }

  /** Get balance for any stablecoin symbol present on this chain. Returns '0.00' if not supported. */
  async getStablecoinBalance(symbol: string): Promise<string> {
    const info = this.chainConfig.stablecoins[symbol];
    if (!info) return '0.00';

    const balance = await this.publicClient.readContract({
      address: info.address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.account.address],
    });

    return formatUnits(balance, info.decimals);
  }

  /** List stablecoin symbols available on this chain. */
  listStablecoins(): string[] {
    return Object.keys(this.chainConfig.stablecoins);
  }

  async pay(
    destination: string,
    amount: string,
    network: string
  ): Promise<string | null> {
    if (this.asset === 'native') {
      return this.payNative(destination, amount);
    }
    return this.payStablecoin(destination, amount, this.asset);
  }

  // ── Native token transfer ───────────────────────────────────────

  private async payNative(
    destination: string,
    amount: string
  ): Promise<string | null> {
    const tag = `[${this.chainName}/native]`;
    try {
      const amountWei = BigInt(amount);
      const formatted = formatEther(amountWei);

      this.log(`${tag} 🚀 ${formatted} → ${this.shortAddr(destination)}`);

      const balance = await this.publicClient.getBalance({
        address: this.account.address,
      });

      if (balance < amountWei) {
        this.log(`${tag} ❌ Insufficient: ${formatEther(balance)} < ${formatted}`);
        return null;
      }

      const hash = await this.wallet.sendTransaction({
        account: this.account,
        to: destination as `0x${string}`,
        value: amountWei,
        chain: this.chainConfig.chain,
      });

      this.log(`${tag} ✅ ${hash}`);
      return hash;
    } catch (error: any) {
      this.log(`${tag} ❌ ${error.message}`);
      return null;
    }
  }

  // ── ERC-20 stablecoin transfer (USDC, cUSD, cEUR, etc.) ─────────

  private async payStablecoin(
    destination: string,
    amount: string,
    symbol: string
  ): Promise<string | null> {
    const tag = `[${this.chainName}/${symbol}]`;
    const info = this.chainConfig.stablecoins[symbol]!;

    try {
      const amountAtomic = BigInt(amount);
      const formatted = formatUnits(amountAtomic, info.decimals);

      this.log(`${tag} 🚀 ${formatted} ${symbol} → ${this.shortAddr(destination)}`);

      const balance = await this.publicClient.readContract({
        address: info.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.account.address],
      });

      if (balance < amountAtomic) {
        this.log(`${tag} ❌ Insufficient: ${formatUnits(balance, info.decimals)} < ${formatted} ${symbol}`);
        return null;
      }

      const hash = await this.wallet.writeContract({
        address: info.address,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [destination as `0x${string}`, amountAtomic],
        chain: this.chainConfig.chain,
        account: this.account,
      });

      this.log(`${tag} ✅ ${hash}`);
      return hash;
    } catch (error: any) {
      this.log(`${tag} ❌ ${error.message}`);
      return null;
    }
  }

  private shortAddr(addr: string): string {
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
  }
}

// ─── Helper: list all supported chains ──────────────────────────────

/** Returns metadata for all supported EVM chains. */
export function listEvmChains(): Array<{
  name: EvmChainName;
  displayName: string;
  chainId: number;
  caip2Id: string;
  hasUsdc: boolean;
  stablecoins: string[];
}> {
  return Object.entries(CHAIN_REGISTRY).map(([name, config]) => ({
    name: name as EvmChainName,
    displayName: config.displayName,
    chainId: config.chain.id,
    caip2Id: `eip155:${config.chain.id}`,
    hasUsdc: config.usdc !== null,
    stablecoins: Object.keys(config.stablecoins),
  }));
}
