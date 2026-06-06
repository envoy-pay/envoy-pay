/**
 * FacilitatorAdapter — the missing bridge between envoy's two halves.
 *
 * envoy ships two payment systems that, until now, never touched each other:
 *
 *   1. The autonomous HTTP loop — `EnvoyClient` catches a 402, checks policy,
 *      calls `adapter.pay()`, and retries. Its stock `EvmPaymentAdapter` settles
 *      with a *plain ERC-20 transfer*: no agent identity, no on-chain spending
 *      policy, no receipt.
 *   2. The on-chain layer — `EnvoyFacilitator.pay()` consumes an EIP-712
 *      `PaymentAuth` from a registered ERC-8004 agent, enforces the agent's
 *      on-chain spending limit, splits net→merchant / fee→treasury, and emits a
 *      `Settled` receipt keyed by challengeId. This is the whole differentiator —
 *      but nothing autonomous ever called it.
 *
 * This adapter is the bridge. It implements the same tiny `PaymentAdapter`
 * interface `EnvoyClient` already expects, so the *real* autonomous loop runs
 * unchanged — but `pay()` now settles through the facilitator. The string it
 * returns (used by EnvoyClient as the x402 proof) is a real `Settled` tx hash
 * that the merchant can re-verify on-chain.
 *
 * Kept local to this example on purpose: it doesn't widen the published SDK
 * surface. If it proves out, promoting it to `src/adapters/` is a copy-paste.
 */
import { randomBytes } from 'crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, celoSepolia } from 'viem/chains';
import {
  createEnvoyFacilitator,
  getEnvoyAddresses,
  erc8004,
  CELO_MAINNET,
  type PaymentAdapter,
  type PaymentAuth,
  type EnvoyFacilitatorClient,
} from '../../src';

/** cUSD (Mento) — same address on Celo Mainnet + Sepolia. 18 decimals. */
export const CUSD: Address = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const CUSD_DECIMALS = 18;
const ZERO: Address = '0x0000000000000000000000000000000000000000';

const ERC20_ABI = [
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

export interface FacilitatorAdapterOptions {
  /** The registered ERC-8004 agent id this wallet signs for. */
  agentId: bigint;
  /** The agent's signing wallet. MUST equal getAgentWallet(agentId) or pay() reverts BadSigner. */
  privateKey: Hex;
  /** Celo chain id. Default: 42220 (Mainnet — the only chain the facilitator is deployed on). */
  chainId?: number;
  /** Optional custom RPC. */
  rpcUrl?: string;
  /** Optional logger. Silent by default. */
  logger?: (msg: string) => void;
}

/**
 * Settle x402 challenges through `EnvoyFacilitator.pay()` instead of a raw transfer.
 *
 * Implements `PaymentAdapter`, so it drops straight into `EnvoyClient`.
 */
export interface LastSettlement {
  txHash: Hex;
  amount: bigint;
  fee: bigint;
  merchant: Address;
  agentId: bigint;
}

export class FacilitatorAdapter implements PaymentAdapter {
  public readonly chainName: string;
  public readonly caip2Id: string;
  /** The most recent on-chain settlement (for receipts / explorer links). */
  public lastSettled: LastSettlement | null = null;

  private readonly agentId: bigint;
  private readonly chainId: number;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly facilitatorAddress: Address;
  private readonly fac: EnvoyFacilitatorClient;
  private readonly log: (msg: string) => void;

  constructor(opts: FacilitatorAdapterOptions) {
    this.agentId = opts.agentId;
    this.chainId = opts.chainId ?? CELO_MAINNET;
    this.log = opts.logger ?? (() => {});

    const chain = this.chainId === CELO_MAINNET ? celo : celoSepolia;
    this.chainName = chain.name;
    this.caip2Id = `eip155:${this.chainId}`;

    const transport = opts.rpcUrl ? http(opts.rpcUrl) : http();
    this.account = privateKeyToAccount(opts.privateKey);
    this.publicClient = createPublicClient({ chain, transport }) as PublicClient;
    this.walletClient = createWalletClient({ account: this.account, chain, transport });

    const { facilitator } = getEnvoyAddresses(this.chainId);
    if (facilitator === ZERO) {
      throw new Error(`No EnvoyFacilitator deployed on chain ${this.chainId}.`);
    }
    this.facilitatorAddress = facilitator;
    this.fac = createEnvoyFacilitator({
      address: facilitator,
      publicClient: this.publicClient,
      walletClient: this.walletClient,
      chainId: this.chainId,
    });
  }

  getAddress(): string {
    return this.account.address;
  }

  /**
   * Settle one x402 challenge.
   *
   * @param destination  the merchant (payTo from the challenge)
   * @param amount       atomic cUSD (18 decimals) — exactly what the challenge asked for
   * @returns the on-chain `Settled` tx hash (the x402 proof), or null on failure
   */
  async pay(destination: string, amount: string): Promise<string | null> {
    const merchant = destination as Address;
    const value = BigInt(amount);

    try {
      // The facilitator pulls cUSD from the agent wallet via transferFrom, so the
      // wallet must have approved the facilitator at least `value`.
      const allowance = (await this.publicClient.readContract({
        address: CUSD,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [this.account.address, this.facilitatorAddress],
      })) as bigint;

      if (allowance < value) {
        this.log(`[facilitator] approving cUSD allowance → facilitator…`);
        const approveTx = await this.walletClient.writeContract({
          account: this.account,
          chain: this.walletClient.chain,
          address: CUSD,
          abi: ERC20_ABI,
          functionName: 'approve',
          // Approve a generous multiple so repeat runs skip the approve hop.
          args: [this.facilitatorAddress, value * 100n],
        });
        await this.publicClient.waitForTransactionReceipt({ hash: approveTx });
        this.log(`[facilitator] allowance set · ${approveTx}`);
      }

      // Build + sign the PaymentAuth. The agent's own key authorizes the spend —
      // no human co-signs. challengeId/nonce are fresh per payment (replay-safe).
      const auth: PaymentAuth = {
        agentId: this.agentId,
        token: CUSD,
        merchant,
        amount: value,
        challengeId: `0x${randomBytes(32).toString('hex')}` as Hex,
        nonce: BigInt(`0x${randomBytes(8).toString('hex')}`),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };

      this.log(`[facilitator] signing PaymentAuth · ${formatUnits(value, CUSD_DECIMALS)} cUSD → ${short(merchant)}`);
      const signature = await this.fac.signPaymentAuth(auth);

      this.log(`[facilitator] calling EnvoyFacilitator.pay()…`);
      const settled = await this.fac.pay(auth, signature);
      this.lastSettled = {
        txHash: settled.txHash,
        amount: settled.amount,
        fee: settled.fee,
        merchant: settled.merchant,
        agentId: settled.agentId,
      };

      this.log(
        `[facilitator] ✓ Settled · net ${formatUnits(settled.amount - settled.fee, CUSD_DECIMALS)} → merchant · ` +
          `fee ${formatUnits(settled.fee, CUSD_DECIMALS)} → treasury · tx ${short(settled.txHash)}`,
      );
      return settled.txHash;
    } catch (err: any) {
      this.log(`[facilitator] ✗ settlement failed: ${err.shortMessage ?? err.message ?? err}`);
      return null;
    }
  }

  // ── Preflight helpers (used by the demo before any spend) ──────────────────

  /** The agent's authorized signing wallet on-chain (must equal getAddress()). */
  async resolveAgentWallet(): Promise<Address> {
    const { identityRegistry } = getEnvoyAddresses(this.chainId);
    return erc8004.getAgentWallet(this.publicClient, identityRegistry, this.agentId);
  }

  /** Read the agent's on-chain spending policy for cUSD. */
  async getLimit() {
    return this.fac.getLimit(this.agentId, CUSD);
  }

  /** Set the agent's on-chain spending policy (caller must be the agent owner/operator). */
  async setLimit(perTx: bigint, perPeriod: bigint, periodLen = 86_400): Promise<Hex> {
    return this.fac.setLimit({ agentId: this.agentId, token: CUSD, perTx, perPeriod, periodLen });
  }

  /** Is this signing wallet authorized to set policy (owner/operator of the agent NFT)? */
  async isOwnerOrOperator(): Promise<boolean> {
    const { identityRegistry } = getEnvoyAddresses(this.chainId);
    return erc8004.isAuthorizedOrOwner(this.publicClient, identityRegistry, this.account.address, this.agentId);
  }

  /** cUSD balance of the agent wallet (human-readable). */
  async cusdBalance(): Promise<string> {
    const bal = (await this.publicClient.readContract({
      address: CUSD,
      abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [this.account.address],
    })) as bigint;
    return formatUnits(bal, CUSD_DECIMALS);
  }

  /** Capabilities the agent declares in its on-chain ERC-8004 card. */
  async capabilities(): Promise<string[]> {
    const { identityRegistry } = getEnvoyAddresses(this.chainId);
    const { tokenURI } = await erc8004.getAgent(this.publicClient, identityRegistry, this.agentId);
    if (!tokenURI || !tokenURI.startsWith('data:')) return [];
    try {
      const comma = tokenURI.indexOf(',');
      const meta = tokenURI.slice(5, comma);
      const payload = tokenURI.slice(comma + 1);
      const json = /;base64/i.test(meta)
        ? Buffer.from(payload, 'base64').toString('utf-8')
        : decodeURIComponent(payload);
      const card = JSON.parse(json);
      return Array.isArray(card?.capabilities)
        ? card.capabilities.filter((c: unknown) => typeof c === 'string').map((c: string) => c.toLowerCase())
        : [];
    } catch {
      return [];
    }
  }

  /** Native CELO balance of the agent wallet (it pays its own gas). */
  async celoBalance(): Promise<string> {
    const bal = await this.publicClient.getBalance({ address: this.account.address });
    return formatUnits(bal, 18);
  }
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
