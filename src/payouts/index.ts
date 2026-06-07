/**
 * `envoy-pay/payouts` — the pluggable "agent pays the real world" layer.
 *
 * Envoy's facilitator authorizes a spend on-chain (signed, policy-gated, with
 * proof-of-human); the payout layer turns that cUSD into a real-world payment over
 * the right rail — cards (subscriptions/domains/SaaS), bills, gift cards, banks.
 *
 * @example
 * ```ts
 * import { PayoutRouter, StripeCardPayoutProvider } from 'envoy-pay/payouts';
 *
 * const router = new PayoutRouter().register(
 *   new StripeCardPayoutProvider({ stripeSecretKey: process.env.STRIPE_SECRET_KEY! }),
 * );
 *
 * // Universal card rail: issue a stablecoin-funded virtual card the agent uses
 * // to pay anything that takes a Visa/Mastercard.
 * const card = await router
 *   .list()
 *   .find((p) => p.id === 'stripe-card');
 * ```
 */
export * from './types';
export { PayoutRouter } from './router';
export type { PayoutRouterOptions, SettleOnChain } from './router';
export { createFacilitatorSettler } from './facilitator-settler';
export type { FacilitatorSettlerOptions } from './facilitator-settler';
export {
  StripeCardPayoutProvider,
  createStripeCardProviderFromEnv,
} from './providers/stripe-card';
export type {
  StripeCardProviderOptions,
  CardholderBilling,
} from './providers/stripe-card';
