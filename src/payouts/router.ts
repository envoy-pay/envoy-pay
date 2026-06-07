/**
 * PayoutRouter — picks the right real-world rail for a target and orchestrates
 * the quote → on-chain settlement → dispatch flow.
 *
 * The on-chain settlement step is *injected* (see {@link SettleOnChain}) so the
 * SDK stays decoupled from how the agent signs — connected wallet, pasted agent
 * key, or a Turnkey enclave. In practice that callback wraps
 * `EnvoyFacilitator.pay()` paying `quote.cusdAmount` to `quote.settleTo`, which
 * keeps the agent's on-chain spending policy and proof-of-human in force for
 * every real-world payout.
 */
import type { Logger } from '../logger';
import { noopLogger } from '../logger';
import type {
  PayoutProvider,
  PayoutQuote,
  PayoutReceipt,
  PayoutRequest,
  PayoutTarget,
  SettlementProof,
} from './types';

export interface PayoutRouterOptions {
  logger?: Logger;
}

/**
 * Performs the on-chain cUSD settlement for a quote and returns proof.
 * Typically: sign a PaymentAuth and call `EnvoyFacilitator.pay()` paying
 * `quote.cusdAmount` to `quote.settleTo`.
 */
export type SettleOnChain = (quote: PayoutQuote) => Promise<SettlementProof>;

export class PayoutRouter {
  private readonly providers: PayoutProvider[] = [];
  private readonly log: Logger;

  constructor(opts: PayoutRouterOptions = {}) {
    this.log = opts.logger ?? noopLogger;
  }

  /** Register a rail. Order matters: the first that `supports()` a target wins. */
  register(provider: PayoutProvider): this {
    this.providers.push(provider);
    this.log(`[payouts] registered "${provider.id}" (rail=${provider.rail})`);
    return this;
  }

  /** Every provider registered. */
  list(): readonly PayoutProvider[] {
    return this.providers;
  }

  /** All providers that can handle a target. */
  providersFor(target: PayoutTarget): PayoutProvider[] {
    return this.providers.filter((p) => p.supports(target));
  }

  /** The first provider that supports the target. Throws if none is registered. */
  route(target: PayoutTarget): PayoutProvider {
    const provider = this.providers.find((p) => p.supports(target));
    if (!provider) {
      const rails = this.providers.map((p) => `${p.id}(${p.rail})`).join(', ') || 'none';
      throw new Error(
        `No payout provider handles target kind="${target.kind}". Registered: ${rails}. ` +
          `Register a matching provider (e.g. a card, bill, or gift-card rail).`,
      );
    }
    return provider;
  }

  /** Price a payout via the routed provider. */
  async quote(req: PayoutRequest): Promise<PayoutQuote> {
    return this.route(req.target).quote(req);
  }

  /** Dispatch a previously-quoted payout, given on-chain settlement proof. */
  async settle(quote: PayoutQuote, proof: SettlementProof): Promise<PayoutReceipt> {
    const provider = this.providers.find((p) => p.id === quote.provider);
    if (!provider) {
      throw new Error(`Provider "${quote.provider}" from this quote is not registered.`);
    }
    return provider.settle(quote, proof);
  }

  /**
   * Full flow: quote → settle on-chain (injected) → dispatch the real-world payout.
   *
   * @example
   * ```ts
   * const receipt = await router.pay(
   *   { target: { kind: 'card', cardId }, amount: '12.00' },
   *   async (quote) => {
   *     const ev = await facilitator.pay(buildAuth(quote), signature); // on-chain, policy-gated
   *     return { txHash: ev.txHash, chainId: CELO_MAINNET, agentId };
   *   },
   * );
   * ```
   */
  async pay(req: PayoutRequest, settleOnChain: SettleOnChain): Promise<PayoutReceipt> {
    const quote = await this.quote(req);
    if (quote.expiresAt * 1000 < Date.now()) {
      throw new Error(`Quote from "${quote.provider}" expired before settlement; re-quote.`);
    }
    this.log(
      `[payouts] ${quote.provider}: settle ${quote.cusdAmount} cUSD → ${quote.settleTo} ` +
        `for ${req.target.kind}`,
    );
    const proof = await settleOnChain(quote);
    if (!proof?.txHash) {
      throw new Error('settleOnChain returned no txHash — cannot dispatch the payout.');
    }
    return this.settle(quote, proof);
  }
}
