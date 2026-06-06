<div align="center">

# envoy

**The payment layer for autonomous AI agents.**

Built on Celo. Speaks `x402` and `MPP`. Settles in cUSD, USDC, or any stablecoin.

[Install](#install) · [Quickstart](#quickstart) · [How it works](#how-it-works) · [Contracts](#smart-contracts) · [Examples](#examples)

</div>

---

## What envoy is

envoy is **two things shipped as one**:

| | What it does |
|---|---|
| **TypeScript SDK** (`envoy-pay`) | An agent makes an HTTP request → the server returns `402 Payment Required` → envoy detects the protocol (x402 or MPP), checks the agent's spending policy, settles on-chain in cUSD/USDC, and retries the request — all without human intervention. |
| **Solidity contracts** on Celo | A minimal on-chain layer for trust-minimized agent commerce: one `EnvoyFacilitator` that settles EIP-712-authorized payments with per-(agent, token) spending caps, net/fee splitting, and `Settled` receipts — identity and reputation delegated to Celo's canonical ERC-8004 registries. |

Celo is the first-class chain (sub-cent fees, ~5s finality, native stablecoins). 12 other EVM chains plus Solana, Stellar, and Stripe MPP are supported too.

---

## Install

```bash
npm install envoy-pay viem
```

Node 18+. Tree-shakable ESM + CJS dual build. Stripe is an optional peer dependency.

---

## Quickstart

An AI agent that autonomously pays for any 402-gated API in **20 lines**:

```ts
import { EnvoyClient, EvmPaymentAdapter } from 'envoy-pay';

const adapter = new EvmPaymentAdapter({
  chain: 'celo',
  asset: 'cUSD',
  privateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}`,
});

const agent = new EnvoyClient({
  baseURL: 'https://api.example.com',
  policy: {
    monthlyBudget: 100,           // never spend more than $100 / month
    maxAmountPerTransaction: 5,   // never spend more than $5 in a single tx
  },
  adapter,
  logger: console.log,
});

// envoy handles the 402 → settle → retry loop transparently.
const result = await agent.performTask('/premium-data', { prompt: '...' });
```

That's the whole story for HTTP-driven payments. For on-chain commerce, jump to [Smart contracts](#smart-contracts).

---

## Import surface

The default `envoy-pay` import is a **lean Celo core**: the agent client, on-chain
settlement via `EnvoyFacilitator`, ERC-8004 identity, an EVM adapter + watcher, and
EIP-681 request URIs. Every other rail and capability is **opt-in via a subpath
import** — so your bundle only carries what you actually use, and adding a rail never
means giving one up:

```ts
import { EnvoyClient, EvmPaymentAdapter } from 'envoy-pay';   // Celo + 11 EVM chains
import { StripePaymentAdapter } from 'envoy-pay/stripe';      // fiat + stablecoin MPP
import { SolanaPaymentAdapter } from 'envoy-pay/solana';      // Solana rail
import { StellarPaymentAdapter } from 'envoy-pay/stellar';    // Stellar rail
import { UnifiedWallet } from 'envoy-pay/wallet';             // cross-chain wallet
import { createX402Gate } from 'envoy-pay/server';            // run your own 402-gated API
```

The heavy rail SDKs — `stripe`, `@solana/web3.js`, `@stellar/stellar-sdk` — are
**optional peer dependencies**: declared, never bundled. A Celo-only agent installs
nothing extra; importing `envoy-pay/stripe` (or `/solana`, `/stellar`) is what pulls
the corresponding SDK in. The full subpath list is in [What's in the box](#whats-in-the-box).

---

## How it works

```
       ┌───────────────┐         ┌─────────────────┐         ┌──────────────┐
       │  AI Agent     │  HTTP   │  Paid API /     │         │   Celo       │
       │  (your code)  ├────────►│  Agent service  │         │   Mainnet    │
       └───────┬───────┘         └────────┬────────┘         └──────▲───────┘
               │                          │                         │
               │                          ▼ 402 Payment Required    │
               │                  ┌───────────────┐                 │
               │                  │ x402  /  MPP  │                 │
               │                  │ challenge     │                 │
               │                  └───────┬───────┘                 │
               │                          │                         │
               ▼                          ▼                         │
   ┌────────────────────────────────────────────────┐               │
   │              EnvoyClient                       │               │
   │  ┌────────────┐  ┌──────────────┐  ┌───────┐   │               │
   │  │  detect    ├─►│ PolicyEngine ├─►│ pay() │───┼───cUSD/USDC───┘
   │  │  protocol  │  │  budget gate │  │ on-   │   │
   │  └────────────┘  └──────────────┘  │ chain │   │
   │                                    └───┬───┘   │
   │                                        │       │
   │     ◄── retry with X-PAYMENT proof ────┘       │
   └────────────────────────────────────────────────┘
```

The interceptor inside `EnvoyClient` does everything between the agent's request and the eventual response. Your agent code just calls `performTask()` — no manual challenge parsing, no signature management, no race conditions on retry.

---

## Two ways to use envoy

| Path | When you want this | Entrypoint |
|---|---|---|
| **HTTP payments** (x402 / MPP) | Your agent calls third-party APIs that gate access behind 402 challenges | [`EnvoyClient`](src/client.ts) + an adapter (`EvmPaymentAdapter`, `StripePaymentAdapter`, …) |
| **On-chain commerce** | Agents transact directly through the `EnvoyFacilitator` on Celo, with identity backed by canonical ERC-8004 | [`EnvoyFacilitator.sol`](contracts/src/EnvoyFacilitator.sol) + helpers under `src/identity/` |

Most production stacks use both. The SDK exposes them through a single import surface.

---

## What's in the box

| Module | Import | Purpose |
|---|---|---|
| [`EnvoyClient`](src/client.ts) | `envoy-pay` | Axios-based HTTP client, auto-handles `402 Payment Required` (x402 + MPP) |
| [`EvmPaymentAdapter`](src/adapters/evm.ts) | `envoy-pay` | One adapter for Celo + 11 other EVM chains. Native token + every stablecoin (cUSD, cEUR, cREAL, USDC, USDT) |
| [`PolicyEngine`](src/policy.ts) | `envoy-pay` | Monthly budgets, per-tx caps, allow / deny lists |
| [`AgentIdentity`](src/identity/agent-identity.ts) | `envoy-pay` · `/identity` | W3C DID + ERC-8004 agent identity (optionally backed by the on-chain registry) |
| [`EnvoyFacilitator` client](src/contracts/facilitator.ts) | `envoy-pay` · `/contracts` | Typed viem client — sign an EIP-712 `PaymentAuth`, call `pay()`, read limits, decode `Settled` |
| [`StripePaymentAdapter`](src/adapters/stripe.ts) | `envoy-pay/stripe` | MPP via Stripe Shared Payment Tokens (fiat + stablecoins) |
| [`SolanaPaymentAdapter`](src/adapters/solana.ts) · [`StellarPaymentAdapter`](src/adapters/stellar.ts) | `envoy-pay/solana` · `/stellar` | Non-EVM settlement + watchers + request URIs |
| [`UnifiedWallet`](src/wallet/unified-wallet.ts) | `envoy-pay/wallet` | Cross-chain wallet with intent resolution + chain routing |
| [`FacilitatorService`](src/facilitator/facilitator-service.ts) | `envoy-pay/facilitator` | Hosted facilitator with fee calculation + receipts |
| [402 gates](src/server/) | `envoy-pay/server` | Server-side x402 / MPP gating, webhook + receipt verification |
| [Watchers](src/monitor/) | `envoy-pay/monitor` | EVM, Solana, Stellar payment monitoring (the EVM watcher is in core) |
| [Contracts](#smart-contracts) | — | On-chain payment layer on Celo + canonical ERC-8004 |

---

## Smart contracts

Envoy's on-chain layer lives in [`contracts/`](contracts/) (Hardhat workspace, Solidity 0.8.27, OpenZeppelin 5, evm: cancun). It ships **one** payment contract and **delegates identity and reputation to Celo's canonical ERC-8004 registries**.

| Contract | What it does | Source |
|---|---|---|
| `EnvoyFacilitator` | One `pay()` call consumes an EIP-712 auth from the agent's wallet, validates the signer against canonical ERC-8004 `getAgentWallet(agentId)`, enforces per-(agent, token) rolling-window spending limits, splits the amount into net (→ merchant) and fee (→ treasury), and emits a `Settled` event keyed by `challengeId`. Strict CEI, ERC-1271 fallback for smart-wallet agents, zero internal balance. | [`EnvoyFacilitator.sol`](contracts/src/EnvoyFacilitator.sol) |

### Canonical ERC-8004 (Celo)

| Registry | Mainnet | Sepolia |
|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

The SDK calls these directly via thin viem helpers under `src/identity/`. No Envoy-specific identity contract — agents are first-class ERC-8004 NFTs and 8004scan indexes them automatically.

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
```

Deploy:

```bash
cp .env.example .env   # add DEPLOYER_PRIVATE_KEY + CELOSCAN_API_KEY
npx hardhat run scripts/deploy.ts --network celoSepolia  # testnet
npx hardhat run scripts/deploy.ts --network celo         # mainnet
```

After deployment, paste the printed addresses into [`src/contracts/addresses.ts`](src/contracts/addresses.ts) — the SDK's viem clients pick them up automatically.

A typed `EnvoyFacilitator` viem client ships under [`src/contracts/`](src/contracts/facilitator.ts) — exported from the core and from `envoy-pay/contracts` — and the canonical ERC-8004 helpers under [`src/identity/`](src/identity/) (`envoy-pay/identity`). Sign a `PaymentAuth`, call `pay()`, and decode `Settled` straight from TypeScript; build notes in [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md).

---

## Networks

Celo is ranked first in the router scorer (`priorityBoost: -3`). The full list:

| Chain | Chain ID | Native | Stablecoins | Notes |
|---|---|---|---|---|
| **Celo** | 42220 | CELO | cUSD, cEUR, cREAL, USDC, USDT | Default, first-class |
| Celo Sepolia | 11142220 | CELO | cUSD, cKES, USDC | Testnet (active — replaces Alfajores) |
| Base | 8453 | ETH | USDC | |
| Base Sepolia | 84532 | ETH | USDC | Testnet |
| Arbitrum | 42161 | ETH | USDC | |
| Optimism | 10 | ETH | USDC | |
| Ethereum | 1 | ETH | USDC | High gas, deprioritized in router |
| Polygon | 137 | MATIC | USDC | |
| X Layer | 196 | OKB | USDC | OKX L2 |

Plus Solana (`SolanaPaymentAdapter`), Stellar (`StellarPaymentAdapter`), and Stripe MPP (`StripePaymentAdapter`).

---

## Protocols

envoy speaks both major agent-payment protocols, transparently:

| Protocol | Originator | Challenge format | Proof header |
|---|---|---|---|
| [**x402**](https://x402.org) | Coinbase / Cloudflare | JSON body | `X-PAYMENT` |
| [**MPP**](https://mpp.dev) | Stripe / Tempo | `WWW-Authenticate: Payment` | `Authorization: Payment` |

The `EnvoyClient` interceptor auto-detects which one the server is using on every 402 and dispatches to the right handler. Your code never needs to know.

---

## Examples

| Example | Demonstrates |
|---|---|
| [**`autonomous-loop/`**](examples/autonomous-loop/) | **The whole thesis, end to end** — an `EnvoyClient` agent hits a 402-gated API, settles through `EnvoyFacilitator` on Celo with an EIP-712 auth, retries, and gets the data. The merchant verifies the on-chain `Settled` event + the agent's ERC-8004 capability before serving. No human co-signs a step. Run with `npm run demo`. |
| [`celo-quickstart.ts`](examples/celo-quickstart.ts) | Minimal Celo + cUSD payment via `EvmPaymentAdapter` |
| [`ows-demo.ts`](examples/ows-demo.ts) | Open Wallet Standard integration |
| [`xlayer-uniswap-agent.ts`](examples/xlayer-uniswap-agent.ts) · [`onchainos-xlayer-agent.ts`](examples/onchainos-xlayer-agent.ts) | DEX-routed payments on OKX X Layer via OnchainOS |

The single-file examples run with `npx ts-node examples/<name>.ts` after you set the env vars each file documents at the top. The autonomous loop has its own [walkthrough](examples/autonomous-loop/README.md) and a zero-spend dry run.

---

## Develop

```bash
npm install              # install SDK deps
npm run typecheck        # tsc --noEmit
npm test                 # vitest — 500 passing (9 Stripe/OnchainOS integration tests skip without creds)
npm run build            # cjs + esm + types (lean core + every subpath)
npm run demo             # the autonomous loop — dry run by default

npm run contracts:compile   # cd contracts && hardhat compile
npm run contracts:test      # cd contracts && hardhat test
```

CI runs both workspaces on every push (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

---

## Project layout

```
envoy/
├── src/                      TypeScript SDK
│   ├── index.ts              Lean Celo core — the default `envoy-pay` import
│   ├── solana.ts, stellar.ts Subpath entry points (envoy-pay/solana, /stellar)
│   ├── adapters/             EVM (Celo + 11 chains), Solana, Stellar, Stripe MPP, OWS
│   ├── contracts/            EnvoyFacilitator viem client + ABI + deployed addresses
│   ├── identity/             ERC-8004 helpers, DID, agent card, reputation
│   ├── facilitator/          Hosted facilitator service + fee engine
│   ├── monitor/              Payment watchers (EVM, Solana, Stellar, multi-chain)
│   ├── providers/            OnchainOS (OKX) + cross-chain USDC bridge
│   ├── requests/             EIP-681, SEP-7, Solana Pay URI builders
│   ├── server/               Server-side gates (x402, MPP, webhook, receipt)
│   └── wallet/               Unified multi-chain wallet
├── contracts/                Hardhat workspace
│   ├── src/                  EnvoyFacilitator.sol (+ mocks for tests)
│   ├── test/                 Hardhat tests (23 specs)
│   └── scripts/deploy.ts     Deployment script
└── examples/                 Runnable usage examples (incl. the autonomous loop)
```

---

## License

Apache-2.0
