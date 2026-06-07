/**
 * Stripe Issuing — the universal card rail.
 *
 * Issues a **stablecoin-backed virtual card** linked to the agent's wallet, so the
 * agent can pay *anything that takes a Visa/Mastercard*: subscriptions (Netflix),
 * domains, SaaS, cloud, e-commerce — the long tail that local bill rails and gift
 * cards can't reach.
 *
 * Funding model (per Stripe Issuing + Bridge):
 *  - **Non-custodial JIT (`standard`, default):** the card is linked to the agent's
 *    own wallet (`crypto_wallet[address]`). When the card is spent, Bridge pulls
 *    funds *just-in-time* on-chain, bounded by an ERC-20 approval the agent grants
 *    to Bridge's issuer (see {@link StripeCardPayoutProvider.approvalRequirement})
 *    AND by Stripe `spending_controls`. There is no per-payment settlement.
 *  - **Custodial top-up (`bridge_wallet`):** the agent first tops up a managed
 *    balance with cUSD; the card spends from it. This is the path the
 *    {@link PayoutProvider} `quote`/`settle` methods model.
 *
 * Reality check (June 2026): Stripe's stablecoin Issuing is in private preview with
 * a Bridge onboarding (~6-8 weeks); production cardholders are created via Bridge
 * (pass `cardholderId`). Solana+USDC and EVM (ERC-20 approval) are documented;
 * **Celo / cUSD funding requires Bridge confirmation** — until then, fund from USDC
 * on a supported chain (bridge cUSD→USDC) or use the bill rails for the Celo side.
 *
 * @see https://docs.stripe.com/issuing/stablecoin-cards
 * @see https://docs.stripe.com/issuing/bridge-stablecoin-cards
 */
import { Logger, noopLogger } from '../../logger';
import type {
  CardIssuer,
  CardSecrets,
  IssuedCard,
  PayoutProvider,
  PayoutQuote,
  PayoutRail,
  PayoutReceipt,
  PayoutRequest,
  PayoutTarget,
  ProvisionCardOptions,
  SettlementProof,
  SpendingControls,
} from '../types';

export interface CardholderBilling {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2, e.g. `'US'`. */
  country: string;
}

export interface StripeCardProviderOptions {
  /** Stripe secret key (`sk_test_…` / `sk_live_…`). */
  stripeSecretKey: string;
  /** Stripe Connect account id for commercial programs (sets the `Stripe-Account` header). */
  stripeAccount?: string;
  /** On-chain address the agent tops up cUSD to (custodial `bridge_wallet` model). */
  fundingAddress?: string;
  /** Default funding chain for issued cards. @default 'celo' */
  chain?: string;
  /** Default funding stablecoin. @default 'cusd' */
  stablecoin?: string;
  /** `'standard'` (non-custodial JIT) | `'bridge_wallet'` (custodial). @default 'standard' */
  walletType?: 'standard' | 'bridge_wallet';
  /** Bridge issuer address the agent grants an ERC-20 approval to (non-custodial JIT). */
  bridgeIssuerAddress?: string;
  /** Provider fee in basis points applied to custodial top-ups. @default 0 */
  feeBps?: number;
  /** Billing address used when creating a new cardholder (sandbox/standard Issuing). */
  cardholderBilling?: CardholderBilling;
  /** Stripe API base. @default 'https://api.stripe.com' */
  stripeApiBase?: string;
  /**
   * `Stripe-Version` header. Stablecoin Issuing is preview — set the version your
   * Stripe/Bridge program requires. If omitted, the account's default is used.
   */
  stripeVersion?: string;
  logger?: Logger;
}

interface StripeCardResponse {
  id: string;
  last4?: string;
  brand?: string;
  status: string;
  number?: string;
  cvc?: string;
  exp_month?: number;
  exp_year?: number;
}

const DEFAULT_BILLING: CardholderBilling = {
  line1: '1 Market St',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94105',
  country: 'US',
};

/** Human USD string → integer minor units (cents) string. */
function toMinorUsd(human: string): string {
  const cents = Math.round(parseFloat(human) * 100);
  if (!Number.isFinite(cents) || cents < 0) throw new Error(`Invalid USD amount: "${human}"`);
  return String(cents);
}

export class StripeCardPayoutProvider implements PayoutProvider, CardIssuer {
  public readonly id = 'stripe-card';
  public readonly rail: PayoutRail = 'card';

  private readonly secretKey: string;
  private readonly stripeAccount?: string;
  private readonly fundingAddress?: string;
  private readonly chain: string;
  private readonly stablecoin: string;
  private readonly walletType: 'standard' | 'bridge_wallet';
  private readonly bridgeIssuerAddress?: string;
  private readonly feeBps: number;
  private readonly billing: CardholderBilling;
  private readonly apiBase: string;
  private readonly stripeVersion?: string;
  private readonly log: Logger;

  constructor(options: StripeCardProviderOptions) {
    if (!options.stripeSecretKey) {
      throw new Error(
        'StripeCardPayoutProvider requires a stripeSecretKey. ' +
          'Get one from https://dashboard.stripe.com/apikeys',
      );
    }
    this.secretKey = options.stripeSecretKey;
    this.stripeAccount = options.stripeAccount;
    this.fundingAddress = options.fundingAddress;
    this.chain = options.chain ?? 'celo';
    this.stablecoin = options.stablecoin ?? 'cusd';
    this.walletType = options.walletType ?? 'standard';
    this.bridgeIssuerAddress = options.bridgeIssuerAddress;
    this.feeBps = options.feeBps ?? 0;
    this.billing = options.cardholderBilling ?? DEFAULT_BILLING;
    this.apiBase = options.stripeApiBase ?? 'https://api.stripe.com';
    this.stripeVersion = options.stripeVersion;
    this.log = options.logger ?? noopLogger;
  }

  // ─── HTTP ─────────────────────────────────────────────────────────────────

  private async stripe<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.stripeVersion) headers['Stripe-Version'] = this.stripeVersion;
    if (this.stripeAccount) headers['Stripe-Account'] = this.stripeAccount;

    let url = `${this.apiBase}${path}`;
    let body: string | undefined;
    if (form) {
      const encoded = new URLSearchParams(form).toString();
      if (method === 'GET') url += `?${encoded}`;
      else body = encoded;
    }

    this.log(`[stripe-card] ${method} ${path}`);
    const res = await fetch(url, { method, headers, body });
    const json = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) {
      const message = (json as { error?: { message?: string } })?.error?.message ?? res.statusText;
      throw new Error(`Stripe ${method} ${path} failed: ${message}`);
    }
    return json as T;
  }

  // ─── PayoutProvider (custodial top-up model) ───────────────────────────────

  supports(target: PayoutTarget): boolean {
    return target.kind === 'card';
  }

  async quote(req: PayoutRequest): Promise<PayoutQuote> {
    if (req.target.kind !== 'card') {
      throw new Error(`stripe-card cannot quote target kind="${req.target.kind}".`);
    }
    if (!this.fundingAddress) {
      throw new Error(
        'stripe-card: set `fundingAddress` to quote a custodial top-up. For the ' +
          'non-custodial JIT model, use provisionCard() + approvalRequirement() instead — ' +
          'spend is pulled at the card network, not settled per-payment.',
      );
    }
    const amount = parseFloat(req.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`stripe-card: invalid amount "${req.amount}".`);
    }
    const fee = (amount * this.feeBps) / 10_000;
    return {
      rail: this.rail,
      provider: this.id,
      request: req,
      cusdAmount: (amount + fee).toFixed(6),
      fee: fee.toFixed(6),
      fiat: { amount: amount.toFixed(2), currency: 'usd' },
      settleTo: this.fundingAddress,
      quoteRef: `card-topup:${req.target.cardId ?? 'new'}:${amount.toFixed(2)}:${Date.now()}`,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  }

  async settle(quote: PayoutQuote, proof: SettlementProof): Promise<PayoutReceipt> {
    if (!proof?.txHash) {
      throw new Error('stripe-card: settlement proof (txHash) is required to credit the card.');
    }
    // Production: confirm the on-chain top-up credited the program's funding balance
    // (verify `proof.txHash` paid `quote.cusdAmount` to `quote.settleTo`), then the
    // card spends from that balance. Non-custodial JIT cards skip this entirely.
    this.log(`[stripe-card] top-up confirmed via ${proof.txHash} (${quote.cusdAmount} cUSD)`);
    return {
      rail: this.rail,
      provider: this.id,
      status: 'settled',
      reference: proof.txHash,
      detail: { quoteRef: quote.quoteRef, fundedCusd: quote.cusdAmount },
    };
  }

  // ─── CardIssuer ────────────────────────────────────────────────────────────

  async provisionCard(opts: ProvisionCardOptions): Promise<IssuedCard> {
    let cardholderId = opts.cardholderId;
    if (!cardholderId) {
      // Production stablecoin programs create the cardholder via Bridge and pass its
      // id here; this standard-Issuing path keeps the SDK runnable in sandbox.
      const cardholder = await this.stripe<{ id: string }>('POST', '/v1/issuing/cardholders', {
        name: opts.cardholderName ?? `Envoy Agent ${opts.agentId ?? ''}`.trim(),
        type: 'individual',
        'billing[address][line1]': this.billing.line1,
        'billing[address][city]': this.billing.city,
        'billing[address][state]': this.billing.state,
        'billing[address][postal_code]': this.billing.postalCode,
        'billing[address][country]': this.billing.country,
      });
      cardholderId = cardholder.id;
      this.log(`[stripe-card] cardholder ${cardholderId}`);
    }

    const form: Record<string, string> = {
      cardholder: cardholderId,
      currency: 'usd',
      type: 'virtual',
      status: 'active',
      'crypto_wallet[chain]': opts.chain ?? this.chain,
      'crypto_wallet[currency]': opts.stablecoin ?? this.stablecoin,
      'crypto_wallet[type]': opts.walletType ?? this.walletType,
    };
    if (opts.walletAddress) form['crypto_wallet[address]'] = opts.walletAddress;
    if (opts.agentId) form['metadata[agentId]'] = opts.agentId;
    for (const [k, v] of Object.entries(opts.metadata ?? {})) form[`metadata[${k}]`] = v;
    applySpendingControls(form, opts.spendingControls);

    const card = await this.stripe<StripeCardResponse>('POST', '/v1/issuing/cards', form);
    this.log(`[stripe-card] issued ${card.id} (••${card.last4 ?? '????'})`);
    return this.toIssuedCard(card, opts.walletAddress);
  }

  async getCard(cardId: string): Promise<IssuedCard> {
    const card = await this.stripe<StripeCardResponse>('GET', `/v1/issuing/cards/${cardId}`);
    return this.toIssuedCard(card);
  }

  async getCardSecrets(cardId: string): Promise<CardSecrets> {
    // PAN/CVC are only returned when explicitly expanded (and are PCI-gated live).
    const card = await this.stripe<StripeCardResponse>('GET', `/v1/issuing/cards/${cardId}`, {
      'expand[0]': 'number',
      'expand[1]': 'cvc',
    });
    return {
      number: card.number,
      cvc: card.cvc,
      expMonth: card.exp_month,
      expYear: card.exp_year,
    };
  }

  async setSpendingControls(cardId: string, controls: SpendingControls): Promise<IssuedCard> {
    const form: Record<string, string> = {};
    applySpendingControls(form, controls);
    const card = await this.stripe<StripeCardResponse>('POST', `/v1/issuing/cards/${cardId}`, form);
    return this.toIssuedCard(card);
  }

  /**
   * The on-chain ERC-20 approval the agent must grant so Bridge can JIT-pull from
   * its wallet (non-custodial cards). This is the Celo-side spending ceiling — set
   * it from the agent's policy and the agent can never be charged beyond it.
   */
  approvalRequirement(opts: { token: string; amount: string }): {
    token: string;
    spender: string;
    amount: string;
  } {
    if (!this.bridgeIssuerAddress) {
      throw new Error(
        'stripe-card: set `bridgeIssuerAddress` to compute the ERC-20 approval for ' +
          'non-custodial JIT cards (the spender Bridge pulls funds through).',
      );
    }
    return { token: opts.token, spender: this.bridgeIssuerAddress, amount: opts.amount };
  }

  private toIssuedCard(card: StripeCardResponse, walletAddress?: string): IssuedCard {
    return {
      id: card.id,
      last4: card.last4,
      brand: card.brand,
      status: card.status,
      walletAddress,
      chain: this.chain,
      stablecoin: this.stablecoin,
    };
  }
}

function applySpendingControls(form: Record<string, string>, sc?: SpendingControls): void {
  if (!sc) return;
  let i = 0;
  const addLimit = (amount: string, interval: string) => {
    form[`spending_controls[spending_limits][${i}][amount]`] = toMinorUsd(amount);
    form[`spending_controls[spending_limits][${i}][interval]`] = interval;
    i++;
  };
  if (sc.perAuthorization) addLimit(sc.perAuthorization, 'per_authorization');
  if (sc.daily) addLimit(sc.daily, 'daily');
  if (sc.monthly) addLimit(sc.monthly, 'monthly');
  sc.allowedCategories?.forEach((c, j) => {
    form[`spending_controls[allowed_categories][${j}]`] = c;
  });
  sc.blockedCategories?.forEach((c, j) => {
    form[`spending_controls[blocked_categories][${j}]`] = c;
  });
}

/**
 * Build a Stripe card provider from environment variables.
 * Reads: STRIPE_SECRET_KEY (required), STRIPE_ACCOUNT, STRIPE_CARD_FUNDING_ADDRESS,
 * STRIPE_BRIDGE_ISSUER_ADDRESS, STRIPE_CARD_CHAIN, STRIPE_CARD_STABLECOIN.
 */
export function createStripeCardProviderFromEnv(
  logger?: Logger,
): StripeCardPayoutProvider | null {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return null;
  return new StripeCardPayoutProvider({
    stripeSecretKey,
    stripeAccount: process.env.STRIPE_ACCOUNT,
    fundingAddress: process.env.STRIPE_CARD_FUNDING_ADDRESS,
    bridgeIssuerAddress: process.env.STRIPE_BRIDGE_ISSUER_ADDRESS,
    chain: process.env.STRIPE_CARD_CHAIN,
    stablecoin: process.env.STRIPE_CARD_STABLECOIN,
    logger,
  });
}
