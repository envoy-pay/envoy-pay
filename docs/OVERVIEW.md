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
