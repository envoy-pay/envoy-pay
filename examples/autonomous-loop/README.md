# The autonomous loop

This is envoy's whole thesis, runnable in one command:

> An AI agent calls a paid API, gets `402 Payment Required`, **pays for it itself**
> through the `EnvoyFacilitator` on Celo, retries, and gets the data — and **no
> human co-signs a single step**.

Until now the repo had the two halves but nothing joining them: the autonomous
HTTP loop (`EnvoyClient`) settled with a plain ERC-20 transfer, while the on-chain
layer (`EnvoyFacilitator` + ERC-8004 identity + on-chain spending policy) was only
ever driven by hand. This example supplies the missing bridge and closes the loop.

## What's here

| File | Role |
|---|---|
| `facilitator-adapter.ts` | **The bridge.** A `PaymentAdapter` whose `pay()` signs an EIP-712 `PaymentAuth` and settles through `EnvoyFacilitator.pay()`, returning the on-chain `Settled` tx hash. Drops straight into the stock `EnvoyClient`. |
| `merchant.ts` | A 402-gated service (`createX402Gate`) that **verifies the settlement on-chain** — decodes the `Settled` event, checks merchant/amount/token, replay-guards it — and **requires the paying agent's ERC-8004 card to declare a capability** before serving. |
| `demo.ts` | One command: preflight + narrate the loop (zero spend), then on `CONFIRM=send` run the real `EnvoyClient` agent against the in-process merchant and print the Celoscan receipt. |

## The agent is just this

The whole agent — the interceptor handles payment, policy, and retry:

```ts
const agent = new EnvoyClient({
  baseURL: merchant.url,
  policy: { monthlyBudget: 100, maxAmountPerTransaction: 5 },
  adapter: new FacilitatorAdapter({ agentId, privateKey }), // ← settles via the facilitator
});

const data = await agent.performTask('/premium/market-report', { ask: 'CELO/USD 24h' });
```

## Run it

**Dry run first** — narrates the entire loop and checks readiness, spends nothing:

```bash
AGENT_ID=128 AGENT_PRIVATE_KEY=0x… npx ts-node --transpile-only examples/autonomous-loop/demo.ts
# or: AGENT_ID=128 AGENT_PRIVATE_KEY=0x… npm run demo
```

**For real** — a genuine sub-cent settlement on Celo Mainnet:

```bash
CONFIRM=send AGENT_ID=128 AGENT_PRIVATE_KEY=0x… npm run demo
```

By default the agent pays **itself** as the merchant, so only the ~0.25% fee
actually leaves the wallet — a true closed loop for a fraction of a cent.

## Prerequisites

The agent has to be a real, fundable ERC-8004 agent (mint one on the `/create`
page — it reveals the signing key once):

- `AGENT_ID` — a registered ERC-8004 agent id
- `AGENT_PRIVATE_KEY` — its signing wallet; must equal `getAgentWallet(AGENT_ID)`
- that wallet must hold a little **cUSD** (the payment) **+ a little CELO** (gas)
- its on-chain card must declare the capability the merchant asks for (default
  `x402-payments`) — set capabilities when you mint at `/create`
- a spending policy must exist (the demo sets it for you if this key is the owner)

The preflight checks every one of these and tells you exactly what's missing
before anything is broadcast.

## Optional env

| Var | Default | Meaning |
|---|---|---|
| `MERCHANT` | self | recipient of the net payment |
| `AMOUNT` | `0.001` | cUSD price of the resource |
| `CAPABILITY` | `x402-payments` | capability the merchant requires |
| `CHAIN` | mainnet | set `sepolia` for testnet (note: facilitator is Mainnet-only) |
| `RPC_URL` | viem default | custom Celo RPC |
