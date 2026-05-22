# Envoy — Team Overview

> A from-scratch explanation of what we're building, who it's for, and how the pieces fit together. **Read this first if you're joining the project.** For the dated decision trail and per-task design notes, see [`BUILD_LOG.md`](BUILD_LOG.md). For user-facing change summaries, see [`../CHANGELOG.md`](../CHANGELOG.md).

---

## The problem envoy solves

AI agents — the autonomous kind, the ones driven by an LLM that decide what to do on their own — **cannot pay for anything by themselves today**. Every time an agent needs a paid API, a human has to either:

1. Pre-load a credit card on file with the service, OR
2. Hand the agent a private key to a wallet and *hope* it doesn't do something stupid

Option 1 doesn't scale — you can't put a credit card on file with every API in the world.
Option 2 is terrifying — you've given a probabilistic, sometimes-hallucinating piece of software unrestricted access to money.

**The gap is in the middle: a way for an agent to pay for things on its own, in real money, but with rules its owner sets and the chain enforces.** That's envoy.

---

## The one-sentence pitch

> envoy is a payment system that lets an AI agent pay for any paid API by itself, in stablecoins, but only within strict spending rules that its owner sets on-chain.

---

## See it in one picture

```
┌──────────────┐   ① POST /send-sms                ┌───────────────────┐
│  AI Agent    │ ──────────────────────────────►   │   SMS Gateway     │
│  + envoy SDK │                                   │  (Node.js, Task#6)│
│              │   ② 402 + x402 challenge          │                   │
│              │ ◄──────────────────────────────── │                   │
│              │                                   │                   │
│              │   ⑤ retry w/ X-PAYMENT header    │                   │
│              │ ──────────────────────────────►   │                   │
└──────┬───────┘                                   └─────────┬─────────┘
       │ ③ check policy                                      │ ⑥ verify
       │ ④ pay()                                             │   on-chain
       ▼                                                     │ ⑦ call API
┌─────────────────────────────────────────────────────────┐  │
│                       Celo blockchain                    │  │
│                                                          │  │
│   EnvoyFacilitator (ours)  ◄──► ERC-8004 Identity      │  │
│   • verifies EIP-712 sig         (canonical, 0x8004…)   │  │
│   • enforces spending limit      • getAgentWallet(id)   │  │
│   • splits net + fee                                     │  │
│   • emits Settled event                                  │  │
│            │                                              │  │
│            ▼                                              │  │
│        Mento cKES tokens                                  │  │
└─────────────────────────────────────────────────────────┘  │
                                                              ▼
                                                  ┌─────────────────────┐
                                                  │  Africa's Talking   │
                                                  │  SMS API (real)     │
                                                  └──────────┬──────────┘
                                                             │
                                                             ▼
                                                    📱 phone rings in Lagos
```

The numbers map to the sequence walkthrough further down. Everything inside the dotted box is our code. Everything else (Celo, the canonical ERC-8004 contract, Africa's Talking) already exists — we just compose with it.

---

## The familiar-system analogy

Think of envoy as **the company-card system for AI agents**, where instead of a corporate card backed by Chase, the "card" is a stablecoin wallet on Celo, and instead of an expense-report tool, the spending rules live in an unforgeable smart contract.

| In a normal company | In envoy |
|---|---|
| HR registers the new employee in the company directory | We register the agent on **Celo's canonical ERC-8004 contract** — an "agent phone book" that already exists on Celo |
| Finance issues the employee a corporate card | The owner pre-approves the agent's wallet to spend a specific stablecoin (like cKES) |
| Finance sets the card's daily limit | The owner calls `setLimit(agentId, cKES, perTx=$1, perDay=$10)` on **EnvoyFacilitator** — our contract |
| Employee swipes the card at a vendor | Agent calls `pay()` on EnvoyFacilitator with a signed authorization |
| Card network verifies, debits the account, sends a receipt | Contract verifies signature, checks limit, splits the money: most to the vendor, tiny fee to our treasury, emits a public receipt |
| Accounting can audit every transaction | Every payment is a public event on Celo, indexed by agent ID forever |

---

## The concrete demo (what a judge will actually see)

This is what we're building toward — the moment that has to land in a 90-second video:

> An AI agent running on a laptop wants to send a text message to a customer in Lagos, Nigeria. It calls our "SMS gateway" service. The service replies "402 Payment Required — pay 0.05 cKES (≈ $0.0003) to this address with this challenge ID." The agent's envoy SDK reads the challenge, checks the owner-set spending policy on-chain ("am I allowed to spend 0.05 cKES right now? yes"), signs a payment authorization, calls `pay()` on EnvoyFacilitator. The contract takes 0.05 cKES from the agent's wallet, sends most to our gateway, keeps a tiny fee. The gateway sees the on-chain event, then calls the real **Africa's Talking** SMS API and sends the text. A second later, a real Nokia phone in Lagos buzzes. **The agent paid for it itself, in Kenya's currency, with zero human involvement.**

Why this demo specifically:

- **cKES** is Mento's Kenyan-Shilling stablecoin, native to Celo. Using it in its actual market is a Celo-judge magnet.
- **Africa's Talking** is a real telecom API that real businesses use today.
- **A phone buzzing** is the kind of visual that makes a hackathon judge stop scrolling.
- It targets **Track 1** (Best Agent) + falls into **Track 3** (8004scan rank, because every payment shows up under the agent's ID) + can stretch into **Track 2** (Most Activity, if we run the demo on a 24-hour loop near submission).

### What happens during a single payment (the 13 steps)

These are the numbered events in the diagram above, expanded:

1. **Agent calls the gateway.** `POST /send-sms { to: "+254…", body: "…" }`. No payment attached yet.
2. **Gateway returns 402.** Body is the x402 challenge: `{ amount: "0.05", asset: "cKES", chain: "celo", recipient: <facilitator-addr>, challengeId: "0x…" }`.
3. **Envoy SDK in the agent reads the challenge.** Confirms `chain === "celo"` and `asset === "cKES"`. Looks up the agent's current spending policy on-chain.
4. **SDK calls `EnvoyFacilitator.getLimit(agentId, cKES)`.** Confirms `enabled === true` and `amount <= perTx` and `spentInPeriod + amount <= perPeriod`.
5. **SDK builds the EIP-712 `PaymentAuth`.** Fields: `{ agentId, token=cKES, merchant=gateway, amount, challengeId, nonce, deadline }`.
6. **SDK signs with the agent's signing wallet** — the address that canonical 8004 returns from `getAgentWallet(agentId)`.
7. **SDK calls `EnvoyFacilitator.pay(auth, signature)`** on Celo.
8. **Contract execution, in order:**
   a. `block.timestamp <= deadline` ✓
   b. nonce not previously used ✓
   c. signer recovered from sig equals `IDENTITY.getAgentWallet(agentId)` ✓
   d. limit check + lazy period rollover updates `spentInPeriod`
   e. `cKES.safeTransferFrom(signer, merchant, net)` — most of the amount
   f. `cKES.safeTransferFrom(signer, treasury, fee)` — our 0.25 %
   g. `emit Settled(challengeId, agentId, merchant, …)`
9. **SDK reads the Settled event** from the receipt. Builds the X-PAYMENT header (tx hash + challenge id).
10. **SDK retries the original request** — `POST /send-sms { to, body }` with `X-PAYMENT: <header>`.
11. **Gateway verifies the X-PAYMENT proof.** Queries Celo for the Settled event, confirms `challengeId` and `amount` match.
12. **Gateway calls the real Africa's Talking SMS API**, paying from its prepaid balance in fiat.
13. **Phone in Lagos rings.** Gateway returns `200 { sent: true, messageId }` to the agent.

The whole sequence: ~5–10 seconds end-to-end. Celo's ~5 s block time is the dominant latency.

---

## Getting started locally

The repo is two workspaces: the SDK at the root (`src/`) and the contracts (`contracts/`). Both need their own `npm install`.

```bash
# 1. Clone + install
git clone https://github.com/JemIIahh/envoy.git
cd envoy
npm install                          # root SDK deps (viem, vitest, …)

cd contracts
npm install                          # contracts deps (hardhat, OZ, …)

# 2. Run the tests
npx hardhat test                     # 23 contract tests, ~1 s
cd ..
npx vitest run                       # 496 SDK tests, ~2 s

# 3. Type-check the SDK
npx tsc --noEmit -p tsconfig.json
```

If all three pass, your environment is good.

### To actually deploy (Task #5 territory)

You'll need credentials in `contracts/.env` (copy from `.env.example` once Task #5 lands):

```bash
DEPLOYER_PRIVATE_KEY=0x…             # wallet that deploys (and pays gas)
CELOSCAN_API_KEY=…                   # for hardhat verify
TREASURY_ADDRESS=0x…                 # optional; defaults to deployer
FACILITATOR_FEE_BPS=25               # optional; 0.25 % default, max 200 (2 %)
```

Get Celo Sepolia CELO for gas from <https://faucet.celo.org/celo-sepolia>. The faucet drops ~1 CELO, way more than enough for our deploys + demo loop.

Then:

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network celoSepolia
# Outputs the EnvoyFacilitator address + a verify command. Paste the
# address into src/contracts/addresses.ts under chainId 11142220.
```

---

## What's been built so far — the 4 finished pieces

Picture the system as a stack with four layers. All four are done.

### 1. The architecture decision (Task #1 — research)

Celo has **already deployed** the agent phone book (ERC-8004 Identity Registry) and an agent review system (Reputation Registry). They live at addresses starting with `0x8004…` on Celo Sepolia and Celo mainnet:

| Registry | Mainnet | Sepolia |
|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Crucially, **we are not making our own phone book.** We use theirs. This is the biggest call we made — because the hackathon's Track 3 ($500) is "highest rank in 8004scan," and 8004scan only sees agents registered in *that* canonical phone book.

Originally the plan had us building four contracts (own registry, own escrow, own reputation, own policy guard). After verifying what already existed on Celo, that was cut to **one contract**.

Active testnet: **Celo Sepolia** (chainId `11142220`), not Alfajores. The canonical 8004 deployments are only on Sepolia, and that decides our testnet.

### 2. The cleanup (Task #2)

The snowflake registry + reputation contracts were physically removed from the active build (preserved in [`contracts/future/`](../contracts/future/) for reference). The TypeScript code that used them was moved to `src/contracts/_legacy/`. The deploy script, hardhat config, top + contracts READMEs, and all SDK barrel exports were updated. No dead weight in the active build.

### 3. The one contract that matters: EnvoyFacilitator (Task #3)

This is the **"smart cash register"** in the company-card analogy. ~250 lines of Solidity, lives at [`contracts/src/EnvoyFacilitator.sol`](../contracts/src/EnvoyFacilitator.sol). One function does the actual work, called `pay()`. When called:

1. **Checks the receipt is legit** — the agent's owner signed an authorization (EIP-712), and that signature came from the right wallet (the one Celo's phone book says is the agent's signer, via `getAgentWallet(agentId)`)
2. **Checks the spending rules** — did the owner set a limit? Is this within per-transaction cap? Within per-period cap? Has this exact authorization been used before?
3. **Moves the money** — takes the amount from the agent's wallet, sends most to the merchant, keeps a 0.25 % fee for our treasury
4. **Prints a public receipt** — emits a `Settled` event on Celo with the challenge ID, agent ID, amount, etc. Anyone can verify the payment happened.

Crucially: **the contract never holds any money.** The agent's wallet pays the merchant directly. No vault to be hacked. No funds in escrow to drift. The contract is just the *referee* that checks the rules and lets the transfer happen.

**23 different test cases prove it works** (wrong signer rejected, expired auth rejected, over-budget rejected, fancy "smart contract wallets" via ERC-1271 supported, etc.). All passing. See [`contracts/test/EnvoyFacilitator.test.ts`](../contracts/test/EnvoyFacilitator.test.ts).

### 4. The TypeScript SDK that makes it usable (Task #4)

A smart contract by itself is useless to most developers. You need a friendly library that wraps it. We built:

- **[`src/identity/erc8004/`](../src/identity/erc8004/)** — viem-based helpers for Celo's canonical phone book: `registerAgent()`, `getAgent()`, `setAgentWallet()`, `giveFeedback()`, etc. A dev can register an agent and submit a review with a single function call.
- **[`src/contracts/facilitator.ts`](../src/contracts/facilitator.ts)** — typed client for `EnvoyFacilitator`. `createEnvoyFacilitator(...)` returns an object with `pay()`, `setLimit()`, `signPaymentAuth()` methods. The dev never has to think about ABIs, EIP-712 type hashes, event decoding, or any blockchain plumbing.

All exported under a clean `import { erc8004, createEnvoyFacilitator } from 'envoy-pay'`. 6 SDK tests pass. Existing 490 SDK tests still pass.

---

## What's coming next

There are 5 more tasks. They're all *application-level* work — no more contract or SDK design:

| Task | What it is | Why it matters |
|---|---|---|
| **#5** | Deploy EnvoyFacilitator to Celo Sepolia (testnet) and verify on Celoscan | Now there's a real address on real Celo testnet that anyone can call |
| **#6** | Build the SMS gateway — a small Node.js service in front of Africa's Talking | This is the "merchant" in the demo. It speaks 402-payment-required, takes cKES, sends SMS |
| **#7** | The autonomous agent demo script — the thing that actually shows agent → 402 → pay → SMS arrives | The 90-second video lives here |
| **#8** | Deploy to Celo mainnet + run a 24-hour cron sending SMS once an hour | Generates real on-chain activity for Track 2 and Track 3 |
| **#9** | Package the submission — Karma project page, Self Agent ID, demo video, pitch deck, tweet | The thing judges actually open |

---

## The 30-second framing for someone outside the room

> *"Envoy is the payment layer for AI agents on Celo. We let an agent autonomously pay for any paid API in stablecoins, while the on-chain contract enforces the spending rules its human owner set. Our demo is an agent that autonomously pays for SMS in Kenyan-shilling stablecoin to send real text messages through Africa's Talking — agent in California, phone in Lagos, no human in between."*

---

## Where to look next in this repo

| Looking for | Read |
|---|---|
| The dated decision trail (why we chose X over Y) | [`docs/BUILD_LOG.md`](BUILD_LOG.md) |
| Per-release change list (Added / Changed / Removed) | [`CHANGELOG.md`](../CHANGELOG.md) |
| The actual payment contract | [`contracts/src/EnvoyFacilitator.sol`](../contracts/src/EnvoyFacilitator.sol) |
| The contract's tests (23 cases, the spec in test form) | [`contracts/test/EnvoyFacilitator.test.ts`](../contracts/test/EnvoyFacilitator.test.ts) |
| The canonical Celo ERC-8004 helpers (SDK side) | [`src/identity/erc8004/`](../src/identity/erc8004/) |
| The typed Facilitator viem client | [`src/contracts/facilitator.ts`](../src/contracts/facilitator.ts) |
| What's archived and why | [`contracts/future/README.md`](../contracts/future/README.md) |

---

## Glossary

The jargon you'll hit reading the code, in the order it usually shows up.

- **AI Agent** — autonomous software, usually LLM-driven, that takes actions on its own. In envoy it's the entity that makes a payment.
- **Owner** — the human (or DAO) that deployed/created the agent and sets its spending rules. Holds the ERC-8004 NFT.
- **Agent wallet** — the address authorized to *sign payments* for an agent. Set by the owner via canonical 8004 `setAgentWallet`. Different from the NFT owner — the owner controls the agent, the wallet signs on its behalf. On NFT transfer, the wallet clears automatically.
- **agentId** — the `uint256` tokenId of the canonical ERC-8004 Identity NFT. Equivalent to "the agent's account number" everywhere in our code.
- **ERC-8004** — Ethereum standard for agent identity, defined as ERC-721 NFTs plus a reputation registry. Celo deployed a canonical implementation at `0x8004…` (the address prefix is intentional — easy to spot).
- **Canonical contracts** — the official ERC-8004 Identity and Reputation registries on Celo, not contracts we wrote. We *use* them; we don't reimplement them.
- **x402** — payment protocol. A server returns HTTP `402 Payment Required` with a JSON challenge; the client pays on-chain, then retries with an `X-PAYMENT` proof header. Coinbase/Cloudflare-originated, named the protocol envoy speaks first-class.
- **MPP** — the competing payment protocol from Stripe + Tempo. Uses `WWW-Authenticate: Payment` instead of JSON challenges. envoy supports it too via the same SDK.
- **402 challenge** — the JSON blob a server sends back with the 402 response, telling the client how to pay (amount, chain, asset, recipient, challengeId).
- **challengeId** — opaque identifier the gateway issues in the 402 challenge. Echoes back in the on-chain `Settled` event so the gateway can match the payment to the original 402.
- **X-PAYMENT** — HTTP header the client adds on retry, containing proof of the on-chain payment (tx hash + challenge id).
- **Facilitator** — in x402 terminology, the entity that verifies/settles the payment. Our `EnvoyFacilitator.sol` plays this role on Celo. Not the same as a relayer or paymaster.
- **PaymentAuth** — the EIP-712 typed-data struct the agent's wallet signs to authorize a single payment: `{ agentId, token, merchant, amount, challengeId, nonce, deadline }`.
- **EIP-712** — Ethereum standard for structured-data signatures. Lets the agent sign a *meaning* ("I authorize agent #42 to pay 0.05 cKES to address X") instead of an opaque hash.
- **Nonce** — anti-replay counter per (agentId, nonce). The contract refuses to use the same nonce twice. We use random nonces, not sequential ones.
- **Settled event** — the on-chain receipt emitted by `EnvoyFacilitator.pay()`. Indexed by challengeId, agentId, and merchant. Contains amount, fee, signer, and the original nonce.
- **Limit** — per-(agent, token) spending policy. `{ perTx, perPeriod, periodLen, spentInPeriod, periodStart, enabled }`. Stored in the Facilitator. Set by the agent's owner.
- **Lazy period rollover** — our policy reset pattern: instead of needing a cron to reset daily limits, the next `pay()` after the window elapses zeros `spentInPeriod` automatically. No keeper required.
- **ERC-1271** — standard for signature verification by contract wallets (Safe, Argent, EIP-7702 EOAs, etc.). Our Facilitator falls back to this when ECDSA recovery doesn't match — so smart-wallet agents work out of the box.
- **Mento** — protocol that issues Celo's native stablecoins. Mints cUSD, cEUR, cREAL, cKES against a CELO + USDC reserve.
- **cKES** — Mento's Celo Kenyan Shilling stablecoin. 18 decimals. The currency our demo uses, because Kenya is Celo's biggest market.
- **cUSD, cEUR, cREAL** — other Mento stablecoins (US dollar, Euro, Brazilian Real).
- **MiniPay** — Celo-native mobile wallet, 15M+ users primarily across Africa. Why payments-on-Celo is a real market, not a hypothesis.
- **Celoscan** — block explorer for Celo (Etherscan equivalent). We'll use `https://celoscan.io` and `https://celo-sepolia.blockscout.com` to verify contracts.
- **8004scan** — separate explorer that indexes ERC-8004 agent activity. The hackathon's Track 3 ($500) ranks agents by 8004scan position.
- **Self Agent ID** — credential service (`app.ai.self.xyz`) for privacy-first agent identity. Hackathon submission says it's beneficial (not required) for our agent.
- **Karma** — project registration platform the hackathon uses (<https://karma.app>). Our project page lives there.
- **Celo Sepolia** — Celo's active testnet, chainId `11142220`. Replaces Alfajores. The canonical ERC-8004 contracts are deployed here for testing.
- **CEI** — Checks-Effects-Interactions, the standard pattern for reentrancy-safe Solidity. Our `pay()` follows it strictly.
- **ReentrancyGuardTransient** — OpenZeppelin reentrancy guard that uses EVM transient storage (TSTORE, Cancun-era). Cheaper than the classic storage-based guard.
- **viem** — modern TypeScript library for Ethereum (alternative to ethers). The SDK uses viem throughout.
