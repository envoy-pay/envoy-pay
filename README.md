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
| **Solidity contracts** on Celo | An on-chain layer for trust-minimized agent commerce: identity registry (ERC-8004-inspired), escrow with EIP-712 facilitator receipts, reputation attestations, and per-token spending caps. |

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

| Module | Purpose |
|---|---|
| [`EnvoyClient`](src/client.ts) | Axios-based HTTP client with auto-handling of `402 Payment Required` (x402 + MPP) |
| [`EvmPaymentAdapter`](src/adapters/evm.ts) | One adapter for Celo + 11 other EVM chains. Native token + every stablecoin (cUSD, cEUR, cREAL, USDC, USDT) |
| [`StripePaymentAdapter`](src/adapters/stripe.ts) | MPP via Stripe Shared Payment Tokens (fiat + stablecoins) |
| [`SolanaPaymentAdapter`](src/adapters/solana.ts), [`StellarPaymentAdapter`](src/adapters/stellar.ts) | Non-EVM settlement |
| [`PolicyEngine`](src/policy.ts) | Monthly budgets, per-tx caps, allow / deny lists |
| [`AgentIdentity`](src/identity/agent-identity.ts) | W3C DID + ERC-8004-inspired agent identity (optionally backed by the on-chain registry) |
| [`UnifiedWallet`](src/wallet/unified-wallet.ts) | Cross-chain wallet abstraction with intent resolution + chain routing |
| [`FacilitatorService`](src/facilitator/facilitator-service.ts) | Hosted facilitator with fee calculation + receipts |
| [Watchers](src/monitor/) | EVM, Solana, Stellar payment monitoring |
| [Contracts](#smart-contracts) | On-chain payment layer on Celo + canonical ERC-8004 integration |

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

A typed `EnvoyFacilitator` viem client + ERC-8004 helpers ship under `src/identity/` (in progress — see [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md)).

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

| File | Demonstrates |
|---|---|
| [`celo-quickstart.ts`](examples/celo-quickstart.ts) | Minimal Celo + cUSD payment |
| [`ows-demo.ts`](examples/ows-demo.ts) | Open Wallet Standard integration |
| [`xlayer-uniswap-agent.ts`](examples/xlayer-uniswap-agent.ts) | DEX-routed payments via OnchainOS |

Run any of them with `npx ts-node examples/<name>.ts` after setting the required env vars (each file documents its inputs at the top).

---

## Develop

```bash
npm install              # install SDK deps
npm run typecheck        # tsc --noEmit
npm test                 # vitest (501 tests)
npm run build            # cjs + esm + types

npm run contracts:compile   # cd contracts && hardhat compile
npm run contracts:test      # cd contracts && hardhat test
```

CI runs both workspaces on every push (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

---

## Project layout

```
envoy/
├── src/                      TypeScript SDK
│   ├── adapters/             EVM (Celo + 11 chains), Solana, Stellar, Stripe MPP, OWS
│   ├── contracts/            viem clients + ABIs for the Solidity contracts
│   ├── identity/             Agent identity, DID, reputation, owner registry
│   ├── facilitator/          Hosted facilitator service + fee engine
│   ├── monitor/              Payment watchers (EVM, Solana, Stellar)
│   ├── requests/             EIP-681, SEP-7, Solana Pay URI builders
│   ├── server/               Server-side gates (x402, MPP, webhook, receipt)
│   └── wallet/               Unified multi-chain wallet
├── contracts/                Hardhat workspace
│   ├── src/                  Solidity contracts (4 production + MockERC20 for tests)
│   ├── test/                 Hardhat tests (23 specs)
│   └── scripts/deploy.ts     Deployment script
└── examples/                 Runnable usage examples
```

---

## License

Apache-2.0
