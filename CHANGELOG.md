# Changelog

All notable changes to this project will be documented in this file.

For the dated decision journal behind these changes, see [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md).

## [0.2.0] — 2026-06-07

The Celo-first re-imagining of the SDK with a real on-chain layer. Headlining this release: server-side on-chain settlement verification (`createOnchainVerifier`) and a formal security policy (`SECURITY.md`). Targets Celo Sepolia (testnet) and Celo mainnet.

### Added
- **`createOnchainVerifier(...)`** (`envoy-pay/server`) — a ready-made `verifyPayment` for `createX402Gate` that confirms an x402 proof maps to a real on-chain `EnvoyFacilitator` `Settled` event: checks the tx succeeded, paid the right merchant in the right token for at least the asking amount, replay-guards each `challengeId`, and optionally requires an ERC-8004 capability. Promotes the autonomous-loop example's verification into the SDK so production gates don't re-implement it. Pluggable `ReplayStore` for multi-instance deployments. (12-test suite, `verify-onchain.test.ts`.)
- **`SECURITY.md`** — security policy: pre-1.0 / unaudited status, on-chain trust model, deployed-contract list, the `verifyPayment` requirement, a production hardening checklist, and private vulnerability reporting.
- Scaffold forked from `ASGCompute-ows-agent-pay`, restructured around Celo as the first-class chain
- **`EnvoyFacilitator.sol`** — single on-chain payment contract that consumes an EIP-712 `PaymentAuth` from the agent's wallet, validates the signer against canonical ERC-8004 `getAgentWallet(agentId)`, enforces per-(agent, token) rolling-window spending limits atomically, splits the amount into net (→ merchant) and fee (→ treasury), and emits a `Settled(challengeId, agentId, merchant, …)` event. Strict CEI, custom errors, `ReentrancyGuardTransient`, ERC-1271 fallback for smart-wallet agents, zero internal balance (contract never holds funds).
- `MockIdentityRegistry.sol` + `MockSmartWallet.sol` test fixtures
- 23-test suite for `EnvoyFacilitator` covering: constructor invariants, `setLimit` authorization via ERC-8004 `isAuthorizedOrOwner`, atomic split + event emission, ERC-1271 contract-wallet flow, expired auths, wrong-signer rejection, NFT-transfer-revokes-wallet behavior, nonce reuse, per-tx and per-period exceed, lazy window rollover, treasury rotation, and on-chain ↔ off-chain typed-data hash parity
- **`src/identity/erc8004/`** — viem-based helpers for the canonical Celo ERC-8004 Identity and Reputation registries. Functional, pure, no global state. Exported under `import { erc8004 } from 'envoy-pay'` and individual function exports. Covers: `registerAgent` (all three overloads), `setAgentWallet`, `unsetAgentWallet`, `setAgentURI`, `setMetadata`, `getAgent`/`getAgentWallet`/`getAgentOwner`/`getAgentURI`/`getMetadata`, `isAuthorizedOrOwner`, EIP-712 `agentWalletRotationTypedData` builder, `giveFeedback`, `revokeFeedback`, and a `makeScoreFeedback` convenience helper.
- **`src/contracts/facilitator.ts`** — typed viem client for `EnvoyFacilitator`. Exposes pure helpers (`paymentAuthDomain`, `paymentAuthTypedData`, `signPaymentAuth`) and a `createEnvoyFacilitator(...)` factory that bundles reads (`getFeeBps`, `getLimit`, `isNonceUsed`, `paymentAuthHash`, ...), writes (`setLimit`, `disableLimit`, `setTreasury`, `pay`), and EIP-712 signing in one object. `pay()` waits for the receipt and returns a decoded `Settled` event including `txHash` + `blockNumber`.
- **`src/contracts/abis/EnvoyFacilitator.ts`** — minimal hand-curated ABI, `as const` for viem type inference. Carries only the function/event signatures the SDK touches.
- `src/__tests__/facilitator.test.ts` — 6 vitest cases verifying EIP-712 signing: signature → recovered address parity, sensitivity to every PaymentAuth field, chainId-dependent domains, hashTypedData stability, and the exported PAYMENT_AUTH_TYPES shape.
- `vitest.config.mts` updated to exclude `**/_legacy/**` directories so archived tests don't run.
- New top-level README narrative oriented around "payment layer for autonomous AI agents on Celo"
- `docs/BUILD_LOG.md` capturing the dated decision trail (architecture, demo, ERC-8004 interface notes, Facilitator design rationale, SDK design rationale)

### Changed
- **`createX402Gate` now warns when no settlement verification is configured.** Its built-in checks only confirm a proof is well-formed, not that it settled on-chain — so without `verifyPayment` (or `facilitatorUrl`) it logs a one-time security warning at gate creation. Pass `allowUnverified: true` to acknowledge and silence it (demo/testnet/trusted-upstream only). Non-breaking.
- **Testnet target switched from Celo Alfajores → Celo Sepolia** (chainId `11142220`). The canonical Celo ERC-8004 contracts are deployed on Sepolia; Alfajores is no longer a build target. `hardhat.config.ts` updated accordingly.
- Top-level + `contracts/` READMEs updated to reflect the lean architecture (one on-chain payment layer + canonical ERC-8004 delegation)
- **`src/contracts/addresses.ts`** rewritten: `EnvoyContractAddresses` shape is now `{ facilitator, identityRegistry, reputationRegistry }` (was four snowflake fields). Canonical 8004 addresses are baked in for both Celo mainnet (42220) and Celo Sepolia (11142220). New `CELO_MAINNET` / `CELO_SEPOLIA` chain-id constants exported.

### Removed
- **`EnvoyAgentRegistry.sol`** — superseded by the canonical ERC-8004 Identity Registry on Celo (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` mainnet, `0x8004A818BFB912233c491871b3d84c89A494BD9e` Sepolia). Source preserved under [`contracts/future/`](contracts/future/).
- **`EnvoyReputation.sol`** — superseded by the canonical ERC-8004 Reputation Registry (`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` mainnet, `0x8004B663056A597Dffe9eCcC1965A193B7388713` Sepolia). Source preserved under [`contracts/future/`](contracts/future/).
- **`EnvoyEscrow.sol`** and **`EnvoyPolicyGuard.sol`** — merged into the new `EnvoyFacilitator.sol`. Source preserved under [`contracts/future/`](contracts/future/). The atomic check + settle model in the new contract removes the two-call race window the old escrow / policy split had.
- SDK exports `AgentRegistryClient`, `createAgentRegistry`, `ReputationClient`, `createReputation`, `EscrowClient`, `createEscrow`, `PolicyGuardClient`, `createPolicyGuard`, the four `ENVOY_*_ABI` exports, and their types — viem wrappers moved to `src/contracts/_legacy/` pending replacement with a single `EnvoyFacilitator` client + canonical ERC-8004 helpers.
- `examples/celo-agent-identity.ts` and `examples/celo-escrow.ts` archived to `examples/_legacy/` (both referenced removed contracts).

### Deployed
- **`EnvoyFacilitator` is live on Celo mainnet** (chainId `42220`) at [`0xE268B6fE16319b49D22562C93c0d2395F65FCAcC`](https://celoscan.io/address/0xE268B6fE16319b49D22562C93c0d2395F65FCAcC), wired into `src/contracts/addresses.ts` alongside the canonical ERC-8004 Identity/Reputation registries.

---

## Pre-fork history

_The versions below are from the upstream project (`ASGCompute-ows-agent-pay`) that envoy was forked from, retained for provenance. envoy's npm lineage is the entries above (`0.1.0` → `0.2.0`)._

## [0.2.0] — 2026-04-04

### 🚀 Pay In Infrastructure (NEW)

This release transforms envoy from a spending-only SDK into a **bi-directional A2A payment powerhouse**.

#### Server-Side 402 Gating (`src/server/`)
- **x402Gate** — x402 JSON challenge middleware with `X-PAYMENT` proof validation
- **MppGate** — MPP `WWW-Authenticate` middleware with credential validation
- **PaymentGate** — Dual-protocol unified gate (auto-detects x402 vs MPP)
- **WebhookHandler** — Stripe HMAC-SHA256 verification with idempotency guard
- **ReceiptBuilder** — Payment-Receipt header builder/parser

#### Real-Time Payment Monitoring (`src/monitor/`)
- **EvmWatcher** — JSON-RPC polling for ERC-20 Transfer events + native ETH
- **StellarWatcher** — Horizon SSE streaming for incoming payments
- **SolanaWatcher** — `getSignaturesForAddress` polling with tx parsing
- **MultiChainWatcher** — Unified cross-chain aggregator

#### Payment Request URIs (`src/requests/`)
- **EIP-681** — Ethereum payment URI generator
- **SEP-7** — Stellar payment URI generator
- **Solana Pay** — Solana payment URI generator
- **Universal** — Chain-agnostic router

### 📈 Quality
- Tests: **175 → 269** (+94 new tests)
- Coverage: **~76% → 84.38%** (80% enforced in CI)
- 19 new production files
- Zero new dependencies

### 🔧 Breaking Changes
- None — all new `PaymentAdapter` methods are optional for backward compatibility

---

## [0.1.2] — 2026-04-03

### Changed
- World-class README redesign with hero banner, architecture diagram, ecosystem showcase
- Added CI pipeline with Node 18/20/22 matrix
- Added CONTRIBUTING.md, SECURITY.md, issue templates

## [0.1.1] — 2026-03-28

### Added
- Full Stellar payment adapter (XLM + USDC, auto trustline)
- MPP protocol support (client-side challenge handling)
- Solana payment adapter (SOL + USDC SPL, auto ATA)
- Policy engine with 4 fail-closed gates

## [0.1.0] — 2026-03-20

### Added
- Initial release
- EVM payment adapter (10 chains, native + USDC)
- x402 protocol support
- Stripe MPP adapter
- EnvoyClient with dual-protocol 402 handling
