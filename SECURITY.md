# Security Policy

envoy-pay moves money. This document covers the project's security posture, how to
report a vulnerability, the trust model of the on-chain layer, and a production
hardening checklist for builders.

## Project maturity

| | |
|---|---|
| **Version** | `0.1.0` — **pre-1.0.** The public API may change between minor versions; pin an exact version and review the [CHANGELOG](CHANGELOG.md) before upgrading. |
| **Contract audit** | **Not yet independently audited.** `EnvoyFacilitator` is deployed and source-verified on Celoscan, but has not undergone a third-party security audit. Do not secure large value on it without your own review. |
| **Proven path** | The Celo x402 settlement path is deployed, demoed end-to-end, and unit-tested. Non-Celo rails (Solana, Stellar, Stripe, bridge, OKX) are implemented and unit-tested but less battle-tested — treat them as beta and validate your specific rail end-to-end. |

## Supported Versions

As a pre-1.0 project, only the latest published version receives security fixes.

| Version | Supported |
|---------|:---------:|
| 0.1.x   | ✅         |
| < 0.1   | ❌         |

## Reporting a Vulnerability

**Do NOT report security vulnerabilities through public GitHub issues.**

Report privately via GitHub's [private vulnerability reporting](https://github.com/envoy-pay/envoy-pay/security/advisories/new)
(the repo's **Security → Report a vulnerability** tab). Please include:

- A description of the vulnerability
- Affected version or commit
- Steps to reproduce
- Potential impact
- A suggested fix, if you have one

### Response Timeline

| Action | Timeline |
|--------|----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix development | Within 14 business days |
| Public disclosure | After a fix is released |

**In scope:** the `envoy-pay` SDK, the `EnvoyFacilitator` contract, and the
server-side gates. **Out of scope:** third-party dependency vulnerabilities
(report upstream), and issues requiring a compromised host or a leaked private key.

## Security model

envoy is **fail-closed** and gates every payment **twice** — in the client and on-chain:

- **PolicyEngine (client)** — rejects all payments by default; only passes a positive
  amount, under the per-transaction cap, within the rolling monthly budget, to an
  allowed destination.
- **EnvoyFacilitator (on-chain)** — independently enforces per-(agent, token)
  rolling-window caps in Solidity, so even a compromised client cannot exceed them.
- **No credential storage** — the SDK never persists private keys.

### On-chain trust model

`EnvoyFacilitator` is intentionally minimal and custodies no funds:

- **Holds zero balance.** Each `pay()` transfers net→merchant and fee→treasury
  atomically; the contract never sits on user funds.
- **Authenticates the agent, not the caller.** It validates the EIP-712 `PaymentAuth`
  signature against canonical ERC-8004 `getAgentWallet(agentId)` (ERC-1271 fallback
  for smart-wallet agents), so only an agent's bound wallet can authorize its spend.
- **Replay-guards** each payment by `challengeId` and nonce.

What it does **not** do: it is not a custodian, not an escrow, and not audited. The
guarantees are only as strong as the (unaudited) implementation.

### Deployed contracts (Celo Mainnet)

| Contract | Address |
|---|---|
| `EnvoyFacilitator` | [`0xE268B6fE16319b49D22562C93c0d2395F65FCAcC`](https://celoscan.io/address/0xE268B6fE16319b49D22562C93c0d2395F65FCAcC) |
| ERC-8004 Identity (canonical) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 Reputation (canonical) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

The facilitator is **Celo Mainnet only**; there is no facilitator on Celo Sepolia.

## Verifying payments on your server

> [!IMPORTANT]
> `createX402Gate`'s built-in checks only confirm a proof is **well-formed** — they
> do **not** confirm the payment settled on-chain. Without verification, anyone can
> craft a proof and be served for free.

Always supply a `verifyPayment` function when charging real value. The SDK ships one
that verifies the on-chain `EnvoyFacilitator` `Settled` event:

```ts
import { createX402Gate, createOnchainVerifier } from 'envoy-pay/server';
import { CELO_MAINNET } from 'envoy-pay';

const verifyPayment = createOnchainVerifier({
  chainId: CELO_MAINNET,
  payTo: '0xYourTreasury',
  token: '0x765DE816845861e75A25fCA122bb6898B8B1282a', // cUSD
  minAmount: 500000000000000000n,                       // 0.5 cUSD (18 decimals)
  rpcUrl: process.env.CELO_RPC_URL,                     // or pass a viem publicClient
  // requiredCapability: 'x402-payments',               // optional ERC-8004 gate
  // seen: myRedisReplayStore,                           // required if multi-instance
});

app.post('/api/premium', createX402Gate({
  payTo: '0xYourTreasury',
  amount: '500000000000000000',
  asset: 'cUSD',
  network: 'eip155:42220',
  verifyPayment,
}), handler);
```

It confirms the tx succeeded, emitted the deployed facilitator's `Settled` event,
paid the right merchant in the right token for at least the asking amount, and
replay-guards each `challengeId`. If you genuinely want an unverified gate
(demo/testnet, or a trusted upstream facilitator), set `allowUnverified: true` to
acknowledge it and silence the warning. The default replay store is in-process —
behind a load balancer, pass a shared (e.g. Redis-backed) `seen` store so a receipt
can't be redeemed on two nodes.

## Production hardening checklist

Before you ship envoy-pay for real value:

- [ ] **Pin `envoy-pay` to an exact version** — it's pre-1.0; review the [CHANGELOG](CHANGELOG.md) before bumping.
- [ ] **Verify settlement on every gate** — supply `createOnchainVerifier()` (or your own on-chain `Settled` check). Never ship the permissive default; the gate now warns you if you do.
- [ ] **Use a shared replay store** if you run more than one server instance, so a receipt can't be redeemed twice.
- [ ] **Never hold raw private keys in production** — use a TEE/KMS (e.g. Turnkey; the [envoy-app](https://github.com/envoy-pay/envoy-app) shows the pattern) so signing keys are non-exportable.
- [ ] **Set on-chain spending limits** with `facilitator.setLimit(...)` in addition to the client `PolicyEngine` — defense in depth that holds even if the client is compromised.
- [ ] **Use Celo Mainnet for the facilitator path** and fund the agent wallet with cUSD (payment) + a little CELO (gas).
- [ ] **Get the contract audited** before securing significant value — and understand it is currently unaudited.
- [ ] **Treat non-Celo rails as beta** — validate your specific rail (Solana/Stellar/Stripe) end-to-end before relying on it.
- [ ] **Scope and rotate credentials** — RPC keys, Stripe keys, and any treasury key are secrets; keep them server-side and rotate on exposure.

## Known limitations

- The client trusts the server's 402 challenge — it does not independently verify pricing (your `PolicyEngine` caps bound the exposure).
- Private keys are held in memory during the adapter lifecycle (use a TEE/KMS signer to avoid raw keys).
- The client's monthly budget tracking is in-memory and resets on process restart; the on-chain caps are the durable limit.
- `EnvoyFacilitator` is unaudited (see above).

## Disclosure policy

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you:

- Give us reasonable time to fix the issue before public disclosure
- Do not exploit the vulnerability beyond what is necessary to demonstrate it
- Do not access or modify other users' data

We appreciate your help in keeping envoy and its users safe.
