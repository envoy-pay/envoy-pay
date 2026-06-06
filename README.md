<div align="center">

# envoy

### The payment layer for autonomous AI agents.
### Give every agent an on-chain financial identity — in one line of code.

<sub>Celo-first · Dual protocol (x402 + MPP) · ERC-8004 identity · On-chain settlement · Spending policy · 12 EVM chains + Solana + Stellar + Stripe</sub>

<p>
  <a href="https://github.com/envoy-pay/envoy-pay/actions/workflows/ci.yml"><img src="https://github.com/envoy-pay/envoy-pay/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/envoy-pay"><img src="https://img.shields.io/npm/v/envoy-pay?style=flat-square&color=2e7d32&label=npm" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" alt="Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/built%20on-Celo-FCFF52?style=flat-square&labelColor=000000" alt="Built on Celo" />
  <img src="https://img.shields.io/badge/ERC--8004-identity-635bff?style=flat-square" alt="ERC-8004" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<p>
  <a href="#quickstart">Quickstart</a>&nbsp;·&nbsp;
  <a href="#what-is-envoy">What is envoy</a>&nbsp;·&nbsp;
  <a href="#how-does-envoy-work">How it works</a>&nbsp;·&nbsp;
  <a href="#the-on-chain-layer">On-chain layer</a>&nbsp;·&nbsp;
  <a href="#networks">Networks</a>&nbsp;·&nbsp;
  <a href="#live-on-celo-mainnet">Live on Celo</a>&nbsp;·&nbsp;
  <a href="#faq">FAQ</a>
</p>

</div>

---

## What is envoy?

**envoy** is open-source payment infrastructure that gives any AI agent an **on-chain financial identity** and the ability to **pay for itself**. It unifies the two machine-payment protocols — [x402](https://x402.org) (Coinbase) and [MPP](https://mpp.dev) (Stripe) — behind a single client, settles on **Celo** (plus 11 other EVM chains, Solana, Stellar, and Stripe fiat), and backs every agent with a canonical **ERC-8004** identity and an on-chain spending policy enforced by the `EnvoyFacilitator` contract.

```bash
npm install envoy-pay viem
```

> **Who should use envoy?** Any developer building AI agents or machine-to-machine workflows that need to send or receive payments. If your agent hits `HTTP 402 Payment Required`, envoy handles it automatically — detects the protocol, checks the spending policy, settles on-chain, and retries. Your agent code never touches a payment.

---

## Why do AI agents need envoy?

AI agents are the new workforce, but payments are built for humans. An agent can't open a bank account, fill out a checkout form, or click "pay now." When it hits `402 Payment Required`, it stops dead — and even if it could pay, nothing proves *which* agent paid, or stops it from draining its wallet.

| Problem | How envoy solves it |
|---|---|
| **Agents can't pay for APIs** | Auto-settles x402 and MPP `402` challenges on-chain (or via Stripe) — zero payment code. |
| **Agents have no verifiable identity** | Every agent is a first-class **ERC-8004 NFT** on Celo, indexed by [8004scan](https://8004scan.io). No bespoke identity contract. |
| **Agents overspend** | A spending policy is enforced **twice** — in the client (budget, per-tx cap, allow/deny) *and* on-chain by `EnvoyFacilitator` (per-agent, per-token rolling caps). |
| **No trust between agents** | `EnvoyFacilitator.pay()` settles an EIP-712-authorized payment, splits net/fee, and emits a verifiable `Settled` receipt — the merchant checks it on-chain before serving. |

> **envoy is Stripe for machines, settled on-chain.** Your agent calls `performTask()`; envoy handles wallet, protocol detection, settlement, policy, and receipt verification.

---

## Quickstart

### Install

```bash
npm install envoy-pay viem
```

Node 18+. Tree-shakable ESM + CJS dual build. Every non-Celo rail (Stripe, Solana, Stellar) is an **optional peer dependency**, pulled in only when you import its subpath.

### Make an agent pay for an API — Celo + cUSD

```ts
import { EnvoyClient, EvmPaymentAdapter } from 'envoy-pay';

const agent = new EnvoyClient({
  baseURL: 'https://api.example.com',
  adapter: new EvmPaymentAdapter({
    chain: 'celo',
    asset: 'cUSD',
    privateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}`,
  }),
  policy: {
    monthlyBudget: 100,           // never spend more than $100 / month
    maxAmountPerTransaction: 5,   // never spend more than $5 in one tx
  },
  logger: console.log,
});

// envoy handles the 402 → settle → retry loop transparently.
const data = await agent.performTask('/premium-data', { prompt: '…' });
```

**What happens:** agent sends request → API returns `402 Payment Required` → envoy auto-detects the protocol (x402 or MPP) → checks the policy → settles on Celo → retries with the payment proof → `200 OK`. Your agent never sees the payment.

<details>
<summary><strong>💳 Stripe MPP (fiat + stablecoin)</strong> — <code>envoy-pay/stripe</code></summary>

```ts
import { EnvoyClient } from 'envoy-pay';
import { StripePaymentAdapter } from 'envoy-pay/stripe';

const agent = new EnvoyClient({
  baseURL: 'https://api.example.com',
  adapter: new StripePaymentAdapter({
    stripeSecretKey: process.env.STRIPE_SECRET_KEY!,
    networkId: 'my-network',
  }),
  policy: { monthlyBudget: 200, maxAmountPerTransaction: 10 },
});
```

Manages the full Stripe Shared Payment Token lifecycle, including crypto deposits via Tempo.

</details>

<details>
<summary><strong>◎ Solana (SOL / USDC)</strong> — <code>envoy-pay/solana</code></summary>

```ts
import { EnvoyClient } from 'envoy-pay';
import { SolanaPaymentAdapter } from 'envoy-pay/solana';

const agent = new EnvoyClient({
  baseURL: 'https://api.example.com',
  adapter: new SolanaPaymentAdapter({
    secretKey: myKeypair.secretKey,
    network: 'mainnet-beta',
    asset: 'USDC',
  }),
  policy: { monthlyBudget: 50, maxAmountPerTransaction: 2 },
});
```

Creates Associated Token Accounts automatically. SOL + Circle USDC on mainnet-beta and devnet.

</details>

<details>
<summary><strong>🌟 Stellar (XLM / USDC)</strong> — <code>envoy-pay/stellar</code></summary>

```ts
import { EnvoyClient } from 'envoy-pay';
import { StellarPaymentAdapter } from 'envoy-pay/stellar';

const agent = new EnvoyClient({
  baseURL: 'https://api.example.com',
  adapter: new StellarPaymentAdapter({
    secretKey: process.env.STELLAR_SECRET!,
    network: 'mainnet',
    asset: 'USDC',
  }),
  policy: { monthlyBudget: 50, maxAmountPerTransaction: 2 },
});
```

Handles Stellar trustline management automatically. XLM + Circle USDC on mainnet and testnet.

</details>

<details>
<summary><strong>⛓️ On-chain settlement via <code>EnvoyFacilitator</code></strong> — <code>envoy-pay/contracts</code></summary>

```ts
import { createEnvoyFacilitator, signPaymentAuth } from 'envoy-pay/contracts';

// Sign an EIP-712 PaymentAuth from the agent's wallet and settle it through the
// EnvoyFacilitator on Celo — net to the merchant, fee to the treasury, one Settled event.
const facilitator = createEnvoyFacilitator({ chainId: 42220, walletClient, publicClient });
const auth = await signPaymentAuth(account, { /* agentId, to, token, amount, challengeId, … */ });
const { txHash } = await facilitator.pay(auth);
```

This is the bridge the [autonomous-loop example](examples/autonomous-loop/) drops into a stock `EnvoyClient` so the whole 402 loop settles on-chain with no human in the loop.

</details>

---

## How does envoy work?

The core `EnvoyClient` handles protocol detection and the retry loop; pluggable `PaymentAdapter` implementations handle chain-specific settlement.

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
               ▼                          ▼                         │
   ┌────────────────────────────────────────────────┐               │
   │              EnvoyClient                       │               │
   │  ┌────────────┐  ┌──────────────┐  ┌───────┐   │               │
   │  │  detect    ├─►│ PolicyEngine ├─►│ pay() │───┼───cUSD/USDC───┘
   │  │  protocol  │  │  budget gate │  │ on-   │   │
   │  └────────────┘  └──────────────┘  │ chain │   │
   │                                    └───┬───┘   │
   │     ◄── retry with X-PAYMENT proof ────┘       │
   └────────────────────────────────────────────────┘
```

### Components

| Module | Import | What it does |
|---|---|---|
| [`EnvoyClient`](src/client.ts) | `envoy-pay` | Dual-protocol HTTP client — intercepts `402`, auto-detects x402 vs MPP, settles, retries. |
| [`EvmPaymentAdapter`](src/adapters/evm.ts) | `envoy-pay` | One class for Celo + 11 EVM chains. Native token + every stablecoin (cUSD, cEUR, cREAL, USDC, USDT). |
| [`PolicyEngine`](src/policy.ts) | `envoy-pay` | Monthly budget, per-tx cap, allow/deny lists. Rejects by default. |
| [`AgentIdentity`](src/identity/agent-identity.ts) | `envoy-pay` · `/identity` | W3C DID + ERC-8004 identity, optionally backed by the on-chain registry. |
| [`EnvoyFacilitator` client](src/contracts/facilitator.ts) | `envoy-pay` · `/contracts` | Sign EIP-712 `PaymentAuth`, call `pay()`, read limits, decode `Settled`. |
| [`StripePaymentAdapter`](src/adapters/stripe.ts) | `envoy-pay/stripe` | MPP via Stripe Shared Payment Tokens (fiat + stablecoins). |
| [`SolanaPaymentAdapter`](src/adapters/solana.ts) · [`StellarPaymentAdapter`](src/adapters/stellar.ts) | `envoy-pay/solana` · `/stellar` | Non-EVM settlement + watchers + request URIs. |
| [`UnifiedWallet`](src/wallet/unified-wallet.ts) | `envoy-pay/wallet` | Cross-chain wallet with intent resolution + chain routing. |
| [`FacilitatorService`](src/facilitator/facilitator-service.ts) | `envoy-pay/facilitator` | Hosted facilitator with fee calculation + receipts. |
| [402 gates](src/server/) | `envoy-pay/server` | Server-side x402 / MPP gating, webhook + receipt verification. |
| [Watchers](src/monitor/) | `envoy-pay/monitor` | EVM, Solana, Stellar payment monitoring (the EVM watcher ships in core). |

> **Extensible:** add any rail by implementing the [`PaymentAdapter`](src/adapters/types.ts) interface.

### Charge agents for *your* API (Pay In)

```ts
import { createX402Gate } from 'envoy-pay/server';

app.post('/api/premium', createX402Gate({
  payTo: '0xYOUR_TREASURY',
  amount: '500000',          // 0.50 in 6-decimal stablecoin units
  asset: 'cUSD',
  network: 'eip155:42220',   // Celo
}), (req, res) => {
  res.json({ data: 'premium content' });
});
```

Server returns `402` + challenge → agent pays on-chain → retries with proof → the gate verifies and serves `200 OK`. MPP gating (`createMppGate`) works the same way.

### Generate payment-request URIs

```ts
import { buildEip681Uri } from 'envoy-pay';                 // EIP-681 (Celo / EVM)
import { buildSep7Uri } from 'envoy-pay/stellar';           // SEP-7 (Stellar)
import { buildSolanaPayUri } from 'envoy-pay/solana';       // Solana Pay
```

For QR codes, deep links, or agent-to-agent payment requests across any supported chain.

---

## The on-chain layer

This is what makes envoy **trust-minimized** rather than just a payment client. The on-chain layer lives in [`contracts/`](contracts/) (Hardhat, Solidity 0.8.27, OpenZeppelin 5) and ships **one** payment contract — identity and reputation are delegated to Celo's canonical **ERC-8004** registries.

| Contract | What it does | Source |
|---|---|---|
| **`EnvoyFacilitator`** | One `pay()` consumes an EIP-712 auth from the agent's wallet, validates the signer against canonical ERC-8004 `getAgentWallet(agentId)`, enforces per-(agent, token) rolling-window spending limits, splits the amount into net (→ merchant) and fee (→ treasury), and emits a `Settled` event keyed by `challengeId`. Strict CEI, ERC-1271 fallback for smart-wallet agents, zero internal balance. | [`EnvoyFacilitator.sol`](contracts/src/EnvoyFacilitator.sol) |

### Canonical ERC-8004 (Celo)

| Registry | Mainnet | Sepolia |
|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Agents are first-class ERC-8004 NFTs, so [8004scan](https://8004scan.io) indexes them automatically — no Envoy-specific identity contract.

```bash
cd contracts && npm install
npx hardhat compile && npx hardhat test            # 23 specs
npx hardhat run scripts/deploy.ts --network celo   # mainnet (celoSepolia for testnet)
```

---

## Live on Celo Mainnet

`EnvoyFacilitator` is deployed and verified on Celo Mainnet — every payment is a real, sub-cent on-chain settlement.

| | |
|---|---|
| **EnvoyFacilitator** | [`0xE268B6fE16319b49D22562C93c0d2395F65FCAcC`](https://celoscan.io/address/0xE268B6fE16319b49D22562C93c0d2395F65FCAcC) |
| **Chain** | Celo Mainnet (`42220`) — sub-cent fees, ~5s finality, native stablecoins |
| **Identity** | Canonical ERC-8004 NFTs, [8004scan](https://8004scan.io)-indexed |
| **Demo** | [`examples/autonomous-loop/`](examples/autonomous-loop/) — `npm run demo` |

The **autonomous loop** is envoy's whole thesis, runnable in one command: an `EnvoyClient` agent hits a 402-gated API, settles through `EnvoyFacilitator` with an EIP-712 auth, retries, and gets the data — while the merchant verifies the on-chain `Settled` event *and* the agent's ERC-8004 capability before serving. **No human co-signs a single step.** It ships with a zero-spend dry run; see its [walkthrough](examples/autonomous-loop/README.md).

---

## Import surface

The default `envoy-pay` import is a **lean Celo core**; every other rail and capability is opt-in via a subpath, so your bundle only carries what you use — and adding a rail never means giving one up.

| Subpath | Ships |
|---|---|
| `envoy-pay` | Core — `EnvoyClient`, `PolicyEngine`, x402/MPP, `EvmPaymentAdapter`, EVM watcher, EIP-681, ERC-8004 identity, `EnvoyFacilitator` client |
| `envoy-pay/stripe` | `StripePaymentAdapter` — Stripe MPP (fiat + stablecoins) |
| `envoy-pay/solana` · `/stellar` | Solana / Stellar adapters + watchers + request URIs |
| `envoy-pay/server` | Server-side 402 gates (x402, MPP), webhook + receipt verification |
| `envoy-pay/wallet` | `UnifiedWallet` — cross-chain wallet, intent resolution, chain routing |
| `envoy-pay/facilitator` | Hosted `FacilitatorService` + fee engine |
| `envoy-pay/contracts` · `/identity` | Typed `EnvoyFacilitator` client + ABI · ERC-8004 helpers |
| `envoy-pay/monitor` · `/requests` | Every chain watcher · every request-URI builder |
| `envoy-pay/ows` · `/okx` · `/bridge` | Open Wallet Standard · OnchainOS (OKX DEX) · cross-chain USDC bridge |

The heavy rail SDKs (`stripe`, `@solana/web3.js`, `@stellar/stellar-sdk`) are optional peer dependencies — declared, never bundled. A Celo-only agent installs nothing extra.

---

## What protocols does envoy support?

envoy speaks both major machine-payment protocols and auto-detects which one a server uses on every `402`.

<table>
<tr>
<td width="50%">

### x402
<sub>Coinbase · Cloudflare · Base</sub>

```
Server → 402 + JSON body
         { x402Version: 1, accepts: [...] }

Agent  → On-chain tx
       → X-PAYMENT: <base64 proof>

Server → 200 OK ✅
```

</td>
<td width="50%">

### MPP
<sub>Stripe · Tempo</sub>

```
Server → 402
       → WWW-Authenticate: Payment
         id="ch1", method="..."

Agent  → settle (on-chain / SPT)
       → Authorization: Payment <cred>

Server → 200 OK + Payment-Receipt ✅
```

</td>
</tr>
</table>

> Your agent code doesn't change — `EnvoyClient` detects the protocol and dispatches to the right handler.

---

## Networks

Celo is the first-class chain (ranked first in the router scorer). envoy settles across **12 EVM chains plus Solana, Stellar, and Stripe fiat**.

<table>
<tr><td valign="top">

### EVM

| Chain | Chain ID | Stablecoins |
|---|---|---|
| **Celo** ⭐ | `42220` | cUSD, cEUR, cREAL, USDC, USDT |
| Celo Sepolia | `11142220` | cUSD, cKES, USDC |
| Base | `8453` | USDC |
| Arbitrum | `42161` | USDC |
| Optimism | `10` | USDC |
| Ethereum | `1` | USDC |
| Polygon | `137` | USDC |
| X Layer | `196` | USDC |

</td><td valign="top">

### Non-EVM

| Network | Assets |
|---|---|
| **Solana** | SOL, USDC |
| Solana Devnet | SOL, USDC |
| **Stellar** | XLM, USDC |
| Stellar Testnet | XLM, USDC |
| **Stripe MPP** | USD (fiat) |

⭐ Celo: default, sub-cent fees, ~5s finality, native stablecoins.

</td></tr>
</table>

---

## How does the spending policy work?

Every payment is gated **twice** — defense in depth no client-only SDK can offer:

1. **In the client** — `PolicyEngine` rejects by default and only lets a payment through if it passes every check: positive amount, under the per-transaction cap, within the rolling monthly budget, and to an allowed destination.
2. **On-chain** — `EnvoyFacilitator` independently enforces per-(agent, token) rolling-window limits in Solidity. Even a compromised client cannot exceed the caps written on-chain.

```ts
policy: {
  monthlyBudget: 100,          // rolling 30-day ceiling
  maxAmountPerTransaction: 5,  // per-tx cap
  // optional allow / deny lists for destinations
}
```

---

## How does envoy compare?

| Capability | **envoy** | Stripe (MPP) | Coinbase (x402) | Generic x402 lib |
|---|:---:|:---:|:---:|:---:|
| x402 protocol | ✅ | ❌ | ✅ (Base) | ✅ |
| MPP protocol | ✅ | ✅ | ❌ | ❌ |
| **Dual protocol (x402 + MPP)** | ✅ | ❌ | ❌ | ❌ |
| On-chain settlement contract | ✅ `EnvoyFacilitator` | ❌ | ❌ | ❌ |
| **Canonical ERC-8004 identity** | ✅ | ❌ | ❌ | ❌ |
| On-chain enforced spending caps | ✅ | ❌ | ❌ | ❌ |
| Celo-first (sub-cent, native stablecoins) | ✅ | ❌ | ❌ | varies |
| Multi-chain (12 EVM + Solana + Stellar + fiat) | ✅ | ❌ | Base only | varies |
| Modular subpath imports | ✅ | — | — | — |
| Open source (Apache-2.0) | ✅ | ❌ | partial | varies |

> envoy is the only stack that pairs **dual-protocol HTTP settlement** with a **deployed on-chain facilitator** and **canonical ERC-8004 identity** — agents are verifiable on-chain entities, not anonymous wallets.

---

## FAQ

### Is envoy free and open-source?
Yes — Apache-2.0. The SDK and contracts are free; you pay only blockchain gas (sub-cent on Celo) or Stripe fees.

### Does it work with LangChain, CrewAI, or custom agents?
Yes. envoy is a plain TypeScript SDK — import it, configure an adapter + policy, and any JS/TS agent framework handles payments automatically.

### Can I do agent-to-agent payments?
Yes. Use an adapter to pay out, the `envoy-pay/server` gates to charge, and the request-URI builders for payment requests. On-chain, `EnvoyFacilitator` settles agent→agent with verifiable receipts.

### Why Celo?
Sub-cent fees, ~5s finality, and native stablecoins (cUSD/cEUR/cREAL) make micropayments viable — and Celo hosts the canonical ERC-8004 registries envoy uses for identity.

### What is ERC-8004?
A standard for on-chain agent identity. envoy registers each agent as an ERC-8004 NFT in Celo's canonical registry, so any party can verify who an agent is — and `EnvoyFacilitator` checks the signer against `getAgentWallet(agentId)` before settling.

### How do I add a new chain or rail?
Implement the [`PaymentAdapter`](src/adapters/types.ts) interface. See the EVM, Solana, Stellar, and Stripe adapters as references.

---

## Testing

```bash
npm install
npm run typecheck                 # tsc --noEmit
npm test                          # vitest
npm run build                     # cjs + esm + types (lean core + every subpath)
npm run demo                      # the autonomous loop — dry run by default

npm run contracts:compile         # hardhat compile
npm run contracts:test            # hardhat test (23 specs)
```

| Suite | Tests | Covers |
|---|---|---|
| `evm.test.ts` | 51 | Celo + EVM chains, native + every stablecoin, balances |
| `mpp.test.ts` | 26 | Challenge parsing, credentials, protocol detection |
| `stripe.test.ts` | 25 | SPT flow, PaymentIntent, server challenges |
| `unified-wallet.test.ts` · `payment-uri.test.ts` | 23 each | Cross-chain wallet · EIP-681 / SEP-7 / Solana Pay |
| `facilitator-service.test.ts` · `session-manager.test.ts` | 21 each | Fee engine + receipts · session lifecycle |
| `policy.test.ts` · `intent-resolver.test.ts` | 20 each | Budget gates · cross-chain intent routing |
| `solana` · `stellar` · `chain-router` · `agent-card` · `did-resolver` … | 15–18 each | Non-EVM rails, routing, ERC-8004 identity |
| _… 35 suites total_ | **499 passing** (+9 integration tests skipped without creds) | + server gates, watchers, webhooks, contracts client |

CI runs the SDK and the Hardhat contracts on every push (Node 18/20/22) — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Technology stack

| Layer | Stack |
|---|---|
| **EVM** | [viem](https://viem.sh) — type-safe Ethereum client |
| **Contracts** | Solidity 0.8.27, OpenZeppelin 5, [Hardhat](https://hardhat.org) |
| **Identity** | Canonical [ERC-8004](https://8004scan.io) registries on Celo |
| **Solana** | [@solana/web3.js](https://solana.com) + [@solana/spl-token](https://spl.solana.com/token) |
| **Stellar** | [@stellar/stellar-sdk](https://stellar.org) |
| **Stripe** | Stripe MPP / Shared Payment Tokens |
| **HTTP** | [axios](https://axios-http.com) with interceptor-based 402 handling |
| **Build / Test** | TypeScript strict, dual CJS + ESM, [Vitest](https://vitest.dev) |

---

## Project layout

```
envoy-pay/
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
├── contracts/                Hardhat workspace — EnvoyFacilitator.sol (+ mocks), 23 specs
└── examples/                 Runnable examples (incl. the autonomous loop)
```

The web product UI lives in a separate repo, [`envoy-pay/envoy-app`](https://github.com/envoy-pay/envoy-app), which consumes this package.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

<div align="center">
<sub>envoy — the payment layer for autonomous AI agents. Built on Celo.</sub>
</div>
