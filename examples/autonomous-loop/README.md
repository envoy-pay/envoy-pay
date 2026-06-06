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
| `merchant.ts` | A 402-gated service (`createX402Gate`) that **verifies the settlement on-chain** — decodes the `Settled` event, checks merchant/amount/token, replay-guards it — **requires the paying agent's ERC-8004 card to declare a capability**, and (optionally) **requires proof-of-human via Self Agent ID** before serving. |
| `self-identity.ts` | **Proof-of-human glue.** Builds the Self `SelfAgentVerifier` (service side), verifies a request's `x-self-agent-*` signature, and attaches an Axios interceptor that makes the agent sign every request with its Self key. Keeps `@selfxyz/agent-sdk` out of the published SDK. |
| `register-self.ts` | One-time: mint a **Self Agent ID** (soulbound ERC-721 bound to the owner's passport ZK-proof). This is the id the hackathon asks for in the submission tweet. `npm run register:self` |
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

## Proof-of-human (Self Agent ID) — optional, off by default

The on-chain checks prove a payment *settled* and that the agent *declares* a
capability. They can't prove there's a real, sanctions-clean **human** behind the
agent. [Self Agent ID](https://docs.self.xyz/self-agent-id/overview) — a
Proof-of-Human extension of ERC-8004 — closes that gap: the owner scans a passport
once (ZK, nothing leaves the phone) and a soulbound NFT on Celo binds the agent's
key to that human proof. The agent then signs every HTTP request with the **same
secp256k1 key** it uses for payments, and the merchant refuses to serve an agent no
human stands behind.

**1. Get a Self Agent ID** (the id that goes in your submission tweet):

```bash
# testnet (mock passport in the Self app)
HUMAN_ADDRESS=0xYourOwnerWallet CHAIN=sepolia npm run register:self
# mainnet (real passport)
HUMAN_ADDRESS=0xYourOwnerWallet npm run register:self
```

It prints a deep link to scan in the Self app, then your **Self Agent ID** and the
agent key. Use that key as `AGENT_PRIVATE_KEY` (and bind the same address at
`/create`) so one identity is provable in both registries — canonical ERC-8004 and
Self's.

**2. Run the loop with proof-of-human enforced:**

```bash
REQUIRE_HUMAN_PROOF=1 REQUIRE_OFAC=1 CONFIRM=send \
  AGENT_ID=<id> AGENT_PRIVATE_KEY=0x… npm run demo
```

The merchant now gates on **paid on-chain + declares capability + human-backed** —
the full trust triangle. Note Self Agent ID lives in a **separate** registry from
the canonical ERC-8004 one Envoy mints into; they share the agent key but live at
different addresses on Celo.

## Optional env

| Var | Default | Meaning |
|---|---|---|
| `MERCHANT` | self | recipient of the net payment |
| `AMOUNT` | `0.001` | cUSD price of the resource |
| `CAPABILITY` | `x402-payments` | capability the merchant requires |
| `CHAIN` | mainnet | set `sepolia` for testnet (note: facilitator is Mainnet-only) |
| `RPC_URL` | viem default | custom Celo RPC |
| `REQUIRE_HUMAN_PROOF` | off | `1` to require a Self Agent ID proof-of-human on every request |
| `REQUIRE_OFAC` | off | `1` to also require the human passed OFAC screening |
| `MIN_AGE` | off | `18` or `21` to require the human's verified age |
