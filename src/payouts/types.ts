/**
 * Payout layer — "an agent pays the real world."
 *
 * Envoy's facilitator gives an agent a universal, policy-gated way to *authorize*
 * a spend on-chain (signed PaymentAuth, per-tx + daily caps, proof-of-human). The
 * payout layer is the pluggable other half: it turns that authorized cUSD into a
 * real-world payment over whatever rail the target needs.
 *
 *   target → rail → provider
 *   ─────────────────────────────────────────────────────────────────────────
 *   subscriptions / domains / SaaS / anything a card accepts  → `card`        (Stripe Issuing, Lithic)
 *   electricity / water / airtime / mobile money              → `bill`        (Pretium, Kotani)
 *   gift-cardable brands (Netflix gift card, Amazon, Steam)   → `giftcard`    (Bitrefill, Reloadly)
 *   bank transfer / IBAN / ACH                                → `bank`        (off-ramps)
 *
 * Every rail implements the same {@link PayoutProvider} contract, so the agent
 * gets one `pay(target)` call and the {@link PayoutRouter} picks the rail.
 */
import type { Logger } from '../logger';

/** The settlement rail a payout travels over. */
export type PayoutRail = 'card' | 'bill' | 'giftcard' | 'bank' | 'mobile-money';

/** What the agent ultimately wants to pay — a discriminated union by rail. */
export type PayoutTarget =
  | { kind: 'card'; cardId?: string; merchant?: string }
  | { kind: 'bill'; biller: string; account: string; country?: string }
  | { kind: 'giftcard'; brand: string; country?: string }
  | { kind: 'bank'; accountRef: string; country?: string }
  | { kind: 'mobile-money'; network: string; phone: string; country?: string };

export interface PayoutRequest {
  /** What to pay. */
  target: PayoutTarget;
  /** Human cUSD amount to spend, e.g. `"9.20"`. */
  amount: string;
  /** Settlement asset. @default 'cUSD' */
  asset?: string;
  /** Idempotency / external reference, echoed into the receipt. */
  reference?: string;
  /** Arbitrary provider metadata. */
  metadata?: Record<string, string>;
}

export interface FiatAmount {
  /** Human amount, e.g. `"12.00"`. */
  amount: string;
  /** ISO currency, e.g. `"usd"`, `"kes"`. */
  currency: string;
}

/**
 * A provider's price for a payout: how much cUSD the agent must settle on-chain,
 * and where. The `settleTo` address is the EnvoyFacilitator `merchant` — i.e. the
 * agent's signed PaymentAuth pays cUSD there, and the provider releases the
 * real-world value on proof of that settlement.
 */
export interface PayoutQuote {
  rail: PayoutRail;
  /** Id of the provider that issued this quote (used to settle it). */
  provider: string;
  /** The request this quote answers. */
  request: PayoutRequest;
  /** cUSD the agent must settle on-chain (human units), inclusive of fee. */
  cusdAmount: string;
  /** Provider fee in cUSD (human units). */
  fee: string;
  /** Fiat value being delivered, for display. */
  fiat?: FiatAmount;
  /** On-chain address the agent settles cUSD to (the EnvoyFacilitator `merchant`). */
  settleTo: string;
  /** Opaque ref the provider needs to dispatch at settle time. */
  quoteRef: string;
  /** Unix seconds; the quote is invalid after this. */
  expiresAt: number;
}

/** Proof that the agent settled the quote on-chain. */
export interface SettlementProof {
  /** Tx hash of the on-chain cUSD settlement (EnvoyFacilitator `Settled` or ERC-20 transfer). */
  txHash: string;
  /** Chain the settlement happened on. */
  chainId: number;
  /** ERC-8004 agent id, if applicable. */
  agentId?: string;
}

export type PayoutStatus = 'settled' | 'pending' | 'failed';

export interface PayoutReceipt {
  rail: PayoutRail;
  provider: string;
  status: PayoutStatus;
  /** Provider's confirmation reference (bill ref, issued card id, voucher code, …). */
  reference: string;
  /** Rail-specific detail. */
  detail?: Record<string, unknown>;
}

/**
 * A real-world payout rail. Two-phase by design so the on-chain settlement
 * (which needs the agent's signer) stays decoupled from the provider:
 *   1. {@link quote} — how much cUSD, and where to settle it.
 *   2. caller settles on-chain (EnvoyFacilitator.pay → `quote.settleTo`).
 *   3. {@link settle} — provider verifies the proof and dispatches the payout.
 */
export interface PayoutProvider {
  /** Stable id, e.g. `'stripe-card'`, `'pretium-bill'`. */
  readonly id: string;
  readonly rail: PayoutRail;
  /** Whether this provider can handle the given target. */
  supports(target: PayoutTarget): boolean;
  /** Price the payout: cUSD owed + on-chain settle address. */
  quote(req: PayoutRequest): Promise<PayoutQuote>;
  /** Dispatch the real-world payout, given proof of on-chain settlement. */
  settle(quote: PayoutQuote, proof: SettlementProof): Promise<PayoutReceipt>;
}

// ─── Card issuance (the virtual-card rail) ──────────────────────────────────

/**
 * Spending limits mirrored into the card network. Amounts are human USD strings.
 * These complement (do not replace) the agent's on-chain spending policy.
 */
export interface SpendingControls {
  /** Max per single authorization, e.g. `"50"`. */
  perAuthorization?: string;
  /** Max per day. */
  daily?: string;
  /** Max per month. */
  monthly?: string;
  /** Allowed merchant category codes (MCC). */
  allowedCategories?: string[];
  /** Blocked merchant category codes (MCC). */
  blockedCategories?: string[];
}

export interface ProvisionCardOptions {
  /** ERC-8004 agent this card belongs to (labeling/metadata). */
  agentId?: string;
  /** Name for a new cardholder. Ignored if `cardholderId` is given. */
  cardholderName?: string;
  /** Existing (e.g. Bridge-provided) cardholder id; skips cardholder creation. */
  cardholderId?: string;
  /** Agent's on-chain wallet that funds the card (non-custodial JIT). */
  walletAddress?: string;
  /** Funding chain, e.g. `'celo'`, `'solana'`, `'ethereum'`. */
  chain?: string;
  /** Funding stablecoin, e.g. `'usdc'`, `'cusd'`. */
  stablecoin?: string;
  /** `'standard'` (non-custodial JIT) | `'bridge_wallet'` (custodial). */
  walletType?: 'standard' | 'bridge_wallet';
  /** Spending policy mirrored into the card network. */
  spendingControls?: SpendingControls;
  metadata?: Record<string, string>;
}

export interface IssuedCard {
  id: string;
  last4?: string;
  brand?: string;
  status: string;
  /** Funding wallet (non-custodial JIT). */
  walletAddress?: string;
  chain?: string;
  stablecoin?: string;
}

/** Sensitive card details for online use — gated by the provider (test data in sandbox). */
export interface CardSecrets {
  number?: string;
  cvc?: string;
  expMonth?: number;
  expYear?: number;
}

/** A provider that can issue stablecoin-funded virtual cards (the universal card rail). */
export interface CardIssuer {
  /** Issue a virtual card linked to the agent's wallet / cardholder. */
  provisionCard(opts: ProvisionCardOptions): Promise<IssuedCard>;
  /** Fetch a card's current state. */
  getCard(cardId: string): Promise<IssuedCard>;
  /** Reveal PAN/CVC for online use. */
  getCardSecrets(cardId: string): Promise<CardSecrets>;
  /** Update the card's spending controls. */
  setSpendingControls(cardId: string, controls: SpendingControls): Promise<IssuedCard>;
}

export interface ProviderContext {
  logger?: Logger;
}
