// envoy — Celo-first agent payment SDK (x402 + MPP)
// https://github.com/JemIIahh/envoy
//
// The default import is the lean Celo core: the agent client, on-chain
// settlement via the EnvoyFacilitator, ERC-8004 identity, an EVM payment
// adapter + watcher, and EIP-681 request URIs. Everything else is opt-in via
// subpath imports, so you only pay for what you use:
//
//   envoy-pay/server       402 gating middleware (x402 / MPP) + webhooks
//   envoy-pay/wallet       unified multi-chain wallet abstraction
//   envoy-pay/ows          Open Wallet Standard — local key mgmt + signing
//   envoy-pay/stripe       Stripe MPP adapter (fiat + stablecoins)
//   envoy-pay/solana       Solana adapter + watcher + Solana Pay URIs
//   envoy-pay/stellar      Stellar adapter + watcher + SEP-7 URIs
//   envoy-pay/okx          OnchainOS (OKX DEX aggregator)
//   envoy-pay/bridge       cross-chain USDC bridge
//   envoy-pay/monitor      every chain watcher (incl. multi-chain)
//   envoy-pay/requests     every payment-request URI builder
//   envoy-pay/facilitator  hosted facilitation service (revenue engine)
//   envoy-pay/contracts    on-chain EnvoyFacilitator client (also re-exported here)
//   envoy-pay/identity     ERC-8004 + identity primitives (also re-exported here)

// ── Core ──────────────────────────────────────────────────────────────────
export { EnvoyClient, EnvoyClientOptions } from './client';
export { PolicyEngine, BudgetPolicy } from './policy';
export type { Logger } from './logger';

// ── Protocol — x402 + MPP ───────────────────────────────────────────────────
export {
  parseMppChallenge,
  parseMppChallenges,
  decodeChallengeRequest,
  buildMppCredential,
  buildAuthorizationHeader,
  parseMppReceipt,
  detectProtocol,
  extractMppChallenges,
  base64urlEncode,
  base64urlDecode,
} from './mpp';
export type {
  MppChallenge,
  MppCredential,
  MppRequestObject,
  MppStripePayload,
  MppTempoPayload,
  MppReceipt,
  MppMethod,
  MppIntent,
} from './mpp';

// ── On-chain x402 adapter — Celo and any EVM chain ──────────────────────────
export { EvmPaymentAdapter, listEvmChains } from './adapters/evm';
export type { EvmAdapterOptions, EvmChainName } from './adapters/evm';

// ── Adapter interface — implement this to add a rail ────────────────────────
export type {
  PaymentAdapter,
  WatchOptions,
  IncomingPayment,
  PaymentRequestOptions,
  PaymentRequest,
  Unsubscribe,
} from './adapters/types';

// ── Watch a Celo / EVM address for incoming payments ────────────────────────
export { createEvmWatcher } from './monitor/evm-watcher';
export type { EvmWatcherConfig } from './monitor/evm-watcher';

// ── Payment-request URIs — EIP-681 (Celo / EVM) ─────────────────────────────
export { buildEip681Uri } from './requests/eip681';
export type { Eip681Options } from './requests/eip681';

// ── Identity — ERC-8004 (canonical) + off-chain primitives ──────────────────
export {
  AgentIdentity,
  DIDResolver,
  AgentCard,
  Reputation,
  OwnerRegistry,
  erc8004,
} from './identity';
export type {
  AgentDID,
  DIDDocument,
  VerificationMethod,
  ServiceEndpoint,
  AgentCardData,
  AgentIdentityOptions,
  ReputationAttestation,
  ReputationCategory,
  ReputationProfile,
  CreateAttestationOptions,
  OwnerRecord,
  DelegationLevel,
  ResolvedIdentity,
  ResolveOptions,
  AgentId,
  CanonicalAgent,
  MetadataEntry,
  FeedbackArgs,
} from './identity';

// ── Contracts — EnvoyFacilitator on-chain client (Celo) ─────────────────────
export {
  ENVOY_CONTRACT_ADDRESSES,
  getEnvoyAddresses,
  CELO_MAINNET,
  CELO_SEPOLIA,
  createEnvoyFacilitator,
  signPaymentAuth,
  paymentAuthDomain,
  paymentAuthTypedData,
  PAYMENT_AUTH_TYPES,
  ENVOY_FACILITATOR_ABI,
} from './contracts';
export type {
  EnvoyContractAddresses,
  PaymentAuth,
  LimitView,
  SettledEvent,
  EnvoyFacilitatorClient,
  EnvoyFacilitatorClientOptions,
} from './contracts';
