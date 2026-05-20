# envoy

> Agent payment SDK on Celo. x402 + MPP protocols, on-chain escrow, agent identity, and a policy engine — built for autonomous AI agents that move money.

`envoy` is a TypeScript SDK + Solidity contracts that let AI agents make and receive payments on Celo (and any other EVM chain, plus Solana / Stellar / Stripe MPP). Celo is the first-class default; everything else is supported, just not preferred.

```bash
npm install envoy-pay viem
```

---

## Why Celo

- **Mobile-money DNA.** Celo was built for phones, low-fee stablecoin payments, and emerging-market commerce — the same constraints autonomous agents hit at scale.
- **Native stablecoins.** cUSD, cEUR, cREAL — plus Circle USDC. No bridging required.
- **Sub-cent fees, ~5s finality.** Cheap enough for genuine micropayments.
- **EVM-compatible.** Use viem, Hardhat, OpenZeppelin — everything you already know.

---

## Quickstart — pay 1 cUSD on Celo

```ts
import { EnvoyClient, EvmPaymentAdapter } from 'envoy-pay';

const adapter = new EvmPaymentAdapter({
  chain: 'celo',
  asset: 'cUSD',
  privateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}`,
});

const client = new EnvoyClient({
  baseURL: 'https://api.example.com',
  policy: { monthlyBudget: 100, maxAmountPerTransaction: 5 },
  adapter,
  logger: console.log,
});

// The remote endpoint returns 402 → envoy detects x402, pays 1 cUSD, retries.
const result = await client.performTask('/expensive-resource', { prompt: '...' });
```

That's the whole story for HTTP-driven payments. The interceptor handles 402 challenges, the policy engine guards spend, and the adapter settles on Celo.

---

## What's in the box

| Layer | What it does |
|---|---|
| **`EnvoyClient`** | Axios-based HTTP client with auto-handling of `402 Payment Required` (x402 + MPP) |
| **`EvmPaymentAdapter`** | One adapter for Celo + 11 other EVM chains. Native + every stablecoin |
| **`PolicyEngine`** | Monthly budgets, per-tx caps, allow/deny lists |
| **Contracts** | `EnvoyAgentRegistry`, `EnvoyEscrow`, `EnvoyReputation`, `EnvoyPolicyGuard` — Solidity on Celo |
| **`AgentIdentity`** | W3C DID + ERC-8004-inspired identity, optionally backed by the on-chain registry |
| **`UnifiedWallet`** | Cross-chain wallet abstraction with intent resolution + chain routing |
| **`FacilitatorService`** | Hosted facilitator with fee calculation + receipts |
| **Watchers** | EVM, Solana, Stellar payment monitoring |

---

## Smart contracts

Four Solidity contracts ship in `contracts/` (Hardhat workspace, Solidity 0.8.24, OpenZeppelin 5):

| Contract | Purpose |
|---|---|
| [`EnvoyAgentRegistry`](contracts/src/EnvoyAgentRegistry.sol) | On-chain agent identity. `did → owner + metadataURI`. ERC-8004-inspired. |
| [`EnvoyEscrow`](contracts/src/EnvoyEscrow.sol) | Payment escrow. Deposit, release on EIP-712 facilitator signature, refund after timeout. |
| [`EnvoyReputation`](contracts/src/EnvoyReputation.sol) | Caller-signed reputation attestations per agent DID and category. |
| [`EnvoyPolicyGuard`](contracts/src/EnvoyPolicyGuard.sol) | Trust-minimized daily spending caps for agent wallets. |

Compile & test:

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
```

Deploy:

```bash
cp .env.example .env  # add DEPLOYER_PRIVATE_KEY + CELOSCAN_API_KEY
npx hardhat run scripts/deploy.ts --network alfajores
npx hardhat run scripts/deploy.ts --network celo
```

After deployment, paste the printed addresses into [`src/contracts/addresses.ts`](src/contracts/addresses.ts).

The SDK exposes viem-based clients for each: `createAgentRegistry`, `createEscrow`, `createReputation`, `createPolicyGuard`. See [`examples/celo-escrow.ts`](examples/celo-escrow.ts) and [`examples/celo-agent-identity.ts`](examples/celo-agent-identity.ts).

---

## Networks

Celo is the first-class default; the routing layer ranks it ahead of other chains. The full list (set via `chain: '...'` on `EvmPaymentAdapter`):

| Chain | Chain ID | Native | Stablecoins |
|---|---|---|---|
| **Celo** | 42220 | CELO | cUSD, cEUR, cREAL, USDC, USDT |
| Celo Alfajores (testnet) | 44787 | CELO | cUSD, cEUR, USDC |
| Base | 8453 | ETH | USDC |
| Base Sepolia | 84532 | ETH | USDC |
| Arbitrum | 42161 | ETH | USDC |
| Optimism | 10 | ETH | USDC |
| Ethereum | 1 | ETH | USDC |
| Polygon | 137 | MATIC | USDC |
| X Layer | 196 | OKB | USDC |

Plus Solana (`SolanaPaymentAdapter`), Stellar (`StellarPaymentAdapter`), and Stripe MPP (`StripePaymentAdapter`).

---

## Protocols

`envoy` speaks both major agent payment protocols:

- **x402** ([Coinbase/Cloudflare](https://x402.org)) — JSON 402 body + `X-PAYMENT` header. On-chain settlement.
- **MPP** ([Stripe / Machine Payments Protocol](https://mpp.dev)) — `WWW-Authenticate: Payment` challenges. Fiat + stablecoins via Shared Payment Tokens.

The client auto-detects the protocol on every 402 and dispatches the right handler.

---

## Examples

- [`examples/celo-quickstart.ts`](examples/celo-quickstart.ts) — Pay 1 cUSD on Celo
- [`examples/celo-escrow.ts`](examples/celo-escrow.ts) — Deposit → facilitator-signed release
- [`examples/celo-agent-identity.ts`](examples/celo-agent-identity.ts) — Register agent DID on Celo
- [`examples/ows-demo.ts`](examples/ows-demo.ts) — Open Wallet Standard integration
- [`examples/xlayer-uniswap-agent.ts`](examples/xlayer-uniswap-agent.ts) — DEX-routed payments via OnchainOS

---

## Develop

```bash
npm install
npm run typecheck
npm test
npm run build

# Contracts (separate workspace)
npm run contracts:compile
npm run contracts:test
```

## Repo layout

```
envoy/
├── src/                      # TypeScript SDK
│   ├── adapters/             # EVM (Celo + 11 chains), Solana, Stellar, Stripe MPP, OWS
│   ├── contracts/            # viem-based clients for the Solidity contracts
│   ├── identity/             # Agent identity, DID, reputation, owner registry
│   ├── facilitator/          # Hosted facilitator service + fee engine
│   ├── monitor/              # Payment watchers (EVM, Solana, Stellar)
│   ├── requests/             # EIP-681, SEP-7, Solana Pay URI builders
│   ├── server/               # Server-side gates (x402, MPP, webhook, receipt)
│   └── wallet/               # Unified multi-chain wallet
├── contracts/                # Hardhat workspace
│   ├── src/                  # Solidity contracts
│   ├── test/                 # Hardhat tests
│   └── scripts/deploy.ts     # Deployment script
└── examples/                 # Runnable usage examples
```

## License

Apache-2.0
