# Build Log

A dated journal of decisions and reasoning behind the Envoy build. The `CHANGELOG.md` documents *what* changed in code; this file documents *why* we made each call.

Newest entries on top.

---

## 2026-05-22 — Task #4 complete: SDK helpers for canonical 8004 + typed Facilitator client

Three new modules, no new runtime dependencies. Everything sits on top of `viem` (already a peer dep).

### Module layout

```
src/
├── contracts/
│   ├── addresses.ts                   ← rewritten; canonical 8004 baked in for Celo mainnet + Sepolia
│   ├── facilitator.ts                 ← typed EnvoyFacilitator client (~290 lines)
│   └── abis/EnvoyFacilitator.ts       ← minimal hand-curated ABI, as const
└── identity/
    └── erc8004/                       ← canonical Celo ERC-8004 helpers
        ├── abis.ts                    ← minimal IdentityRegistry + ReputationRegistry ABIs
        ├── identity.ts                ← register*, set*/get*/unset*, EIP-712 rotation builder
        ├── reputation.ts              ← giveFeedback, revokeFeedback, makeScoreFeedback
        ├── types.ts                   ← AgentId, CanonicalAgent, MetadataEntry, FeedbackArgs
        └── index.ts                   ← barrel
```

### Design points worth remembering

1. **Functional over class-based for on-chain helpers.** The existing `src/identity/` is a class facade (`AgentIdentity`, `Reputation`) for off-chain TypeScript primitives. On-chain wrappers are pure functions taking a viem client — no inheritance, no hidden state. They compose into the class facade if a caller wants both styles.

2. **Three layers of EIP-712 access for `PaymentAuth`.**
   - `PAYMENT_AUTH_TYPES` — exported raw EIP-712 types object. For ecosystems (ethers users, custom signers) that just want the type shape.
   - `paymentAuthTypedData(...)` — builds the full `{ domain, types, primaryType, message }` payload.
   - `signPaymentAuth(walletClient, ...)` — one-call signing for the agent's signing wallet.
   This means downstream users can plug in at whatever level fits their wallet pattern.

3. **Minimal hand-curated ABIs, not full typechain output.** `ENVOY_FACILITATOR_ABI` and the two ERC-8004 ABIs only list functions/events the SDK actually touches. Keeps the bundle small (~5 KB total) and means we can drift independently from the upstream contracts — if Celo's canonical 8004 grows a function we don't use, we simply don't add it here.

4. **`createEnvoyFacilitator(...)` bundles reads + writes + signing.** One object, three responsibilities. `walletClient` is optional — read-only usage works without one. Writes throw a clear error if `walletClient` is missing rather than silently failing.

5. **`pay()` returns the decoded `Settled` event, not just a tx hash.** Off-chain code that submits a payment usually wants the `challengeId` it just settled and the `signer` that authorized it (for receipts / matching against the off-chain queue). Doing the receipt wait + event decode inside `pay()` removes a class of boilerplate from callers.

6. **`registerAgent(...)` picks the right overload by arg shape.** ERC-8004's IdentityRegistry has three `register` overloads (`()`, `(uri)`, `(uri, metadata[])`). Our helper inspects the args and dispatches; callers don't have to know about overload selection.

7. **`makeScoreFeedback(...)` exists because raw `giveFeedback` is awkward.** Eight parameters, mixed types, one of them a signed `int128` with decimals encoding. 95 % of the time a caller wants "this agent scored 85.5 / 100 in category X." The helper covers that and lets advanced callers fall back to raw `giveFeedback`.

8. **EIP-712 helper for `setAgentWallet` rotation, but signing kept caller-side.** `agentWalletRotationTypedData(...)` builds the typed-data payload the new wallet must sign. We deliberately do NOT call `walletClient.signTypedData` inside it — the signing wallet is, by definition, *the new one*, not the one currently on `walletClient`. Callers must sign with the new key separately.

9. **Test focus: cryptographic correctness, not call dispatch.** 6 vitest cases verify the EIP-712 plumbing matches what viem (and by transitive proof, the contract — already proven in the Solidity test suite) computes. Field-by-field sensitivity, chainId-dependent domains, recoverability. No tests of the read/write methods themselves — those land naturally in Task #5 (live deploy) and Task #7 (e2e demo).

10. **vitest config now excludes `**/_legacy/**`** so the archived `agent-registry.test.ts`, `reputation.test.ts`, and `escrow.test.ts` don't break the suite. They remain on disk as reference but are not loaded.

### What did NOT make it (deliberate)

- **No live integration tests against a forked Celo Sepolia.** Possible with viem's test client or anvil-fork, but it adds 30+ seconds to the suite and the contract-level Hardhat tests already cover the on-chain semantics. Task #5 will do the live deploy + smoke test.
- **No top-level `EnvoyAgent` SDK class that ties identity + payment together.** Letting callers compose `registerAgent`, `setLimit`, `signPaymentAuth`, `pay` themselves is more flexible. A higher-level facade can come later if a real consumer asks for one.
- **No automatic IPFS pinning for agent cards.** `agentURI` is a string the caller provides. Pinning is a separate concern (Web3.Storage, Pinata, your own gateway) — out of scope for the SDK.
- **No `@chaoschain/sdk` dependency.** The canonical-contracts repo points at this SDK, but our usage is small enough that ~150 lines of viem wrappers beats taking an upstream dep we don't control.

---

## 2026-05-21 — Task #3 complete: EnvoyFacilitator landed and tested

[`EnvoyFacilitator.sol`](../contracts/src/EnvoyFacilitator.sol) is in. ~250 lines of contract + ~115 lines of mocks + a 23-case test suite, all passing in 758 ms locally. The old `EnvoyEscrow` + `EnvoyPolicyGuard` and their SDK wrappers + the `celo-escrow.ts` example are archived under `contracts/future/` and `_legacy/` paths.

### Design points worth remembering

1. **`PaymentAuth` is the single typed-data primitive.** Off-chain signers (the agent's wallet) sign:

   ```
   PaymentAuth(uint256 agentId,address token,address merchant,uint256 amount,bytes32 challengeId,uint256 nonce,uint64 deadline)
   ```

   `challengeId` is the off-chain x402/MPP challenge identifier the gateway issued — the on-chain `Settled` event re-emits it indexed, so the gateway can correlate without listening on every transaction.

2. **Signer lookup is dynamic, not stored.** `pay()` reads `IDENTITY.getAgentWallet(auth.agentId)` at the moment of settlement. Two consequences:
   - When the canonical 8004 NFT transfers, `agentWallet` clears on the upstream contract, and our next `pay()` reverts `NoAgentWallet()`. No bookkeeping needed on our side.
   - Replacing the operational signer is one tx on the canonical registry — our contract automatically picks up the change next call. No migration story.

3. **Spending policy lives in the Facilitator, keyed by ERC-8004 `agentId` (uint256), not by address.** This is a deliberate departure from `EnvoyPolicyGuard`'s old `address agent`-keyed map: identity in 8004 is the NFT, not the wallet. A wallet rotation does not reset the spend window; an NFT transfer does (effectively, because the new owner sets new limits).

4. **Lazy period rollover.** No keeper. The check is `if (block.timestamp >= periodStart + periodLen) { periodStart = now; spent = 0; }` inline in `_applyLimit`. Off-chain views can re-derive the effective spent without touching state.

5. **Packed `Limit` struct.** Two slots: `(perTx u128, perPeriod u128)` + `(spentInPeriod u128, periodStart u64, periodLen u32, enabled bool)`. `periodLen` is `uint32` (caps at ~136 years) which is generous and saves 4 bytes vs `uint64`.

6. **Zero internal balance.** Two direct `safeTransferFrom`s from the signer (agent's wallet) — one to merchant for `net`, one to treasury for `fee` (skipped when `fee == 0`). The Facilitator address is never a token holder, so an exploit cannot drain it. The attack surface for any single payment is bounded by the agent's outstanding allowance.

7. **ERC-1271 fallback.** `_isValidSig` tries ECDSA first; if that fails AND `signer.code.length != 0`, it calls `IERC1271.isValidSignature(digest, sig)` and checks for the magic value. This means Safe-controlled agents, EIP-7702 delegated EOAs, paymaster-relayed accounts all work without code changes on our side. Tested with a `MockSmartWallet` fixture.

8. **`MAX_FEE_BPS = 200` (2 %) hard ceiling.** Set as a `constant` (not immutable); the constructor reverts if `feeBps > MAX_FEE_BPS`. Even if we redeploy with malicious intent, we cannot exceed 2 % per transaction. Real-world fees start at 25 bps (0.25 %).

9. **No proxy. No upgrade path.** Immutable bytecode. If a bug surfaces, we redeploy and migrate via documentation. We accept the trade-off because: (a) the contract is small and tightly-tested, (b) the canonical 8004 contracts on Celo are themselves UUPS-upgradeable, so we let them absorb the identity-layer evolution while our payment layer stays frozen, and (c) we have no governance to safely operate a proxy.

10. **All errors are custom.** `error PerPeriodExceeded(uint256 attempted, uint128 cap)` etc. — cheaper than revert strings and gives the SDK structured failure modes to surface to agents.

### Test coverage

23 cases, all green:

- Constructor: immutables, fee ceiling, zero-address rejection
- `setLimit`: owner path, operator-approval path, attacker rejection, zero/inverted/zero-period limits
- `disableLimit`: gating
- `pay`: happy path with exact net+fee math, fee-rounds-to-zero edge case (skips the treasury transfer), expired auth, wrong signer, NFT-transferred-out scenario (`NoAgentWallet`), nonce reuse, per-tx exceeded, per-period exceeded across 10 pays, lazy window rollover after `time.increase(DAY + 1)`, limit-not-set
- ERC-1271: a `MockSmartWallet` validates a delegated signature and `pay()` succeeds through it
- `setTreasury`: owner/non-owner/zero
- `paymentAuthHash`: on-chain digest equals `ethers.TypedDataEncoder.hash` for the same domain + types + value

### What did NOT make it (deliberate)

- **No pausability.** Adds storage and audit surface. A hackathon-scale operator pausing a payment rail does not change the threat model meaningfully — agents can stop calling. Skipped.
- **No native CELO support.** cKES is ERC-20; the demo doesn't need native. Native handling would require refund logic on failed forwards (msg.value plumbing).
- **No fee rebates, no per-agent fee overrides.** Universal `feeBps`. Business-model concerns belong off-chain.
- **No reentrancy on internal calls.** `nonReentrant` only on `pay()`. `setLimit` / `setTreasury` don't touch tokens.

---

## 2026-05-21 — Task #1 complete: canonical ERC-8004 interface verified

**Source.** [`erc-8004/erc-8004-contracts`](https://github.com/erc-8004/erc-8004-contracts) — `IdentityRegistryUpgradeable.sol` (v2.0.0, MIT, Solidity ^0.8.20, UUPS proxy on top of OZ `ERC721URIStorageUpgradeable` + `OwnableUpgradeable` + `EIP712Upgradeable`) and `ReputationRegistryUpgradeable.sol` (v2, UUPS proxy on `OwnableUpgradeable`).

**Active testnet: Celo Sepolia, not Alfajores.** The canonical 8004 deployments are on mainnet and Sepolia. Alfajores is not on the deployment list. We commit to Sepolia for testing.

### Identity Registry — interface we'll call from the SDK

```solidity
// Three register overloads. agentId = uint256 NFT tokenId, auto-incremented from 0.
function register() external returns (uint256 agentId);
function register(string memory agentURI) external returns (uint256 agentId);
function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);

// The address authorized to act as the agent's payment wallet.
// Defaults to msg.sender on register(); can be rotated with an EIP-712 signature.
function getAgentWallet(uint256 agentId) external view returns (address);
function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;

function setAgentURI(uint256 agentId, string calldata newURI) external;
function setMetadata(uint256 agentId, string memory key, bytes memory value) external;
function getMetadata(uint256 agentId, string memory key) external view returns (bytes memory);

// Standard ERC-721 surface also available: ownerOf, tokenURI, isApprovedForAll, etc.
function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
```

**Events.** `Registered(uint256 indexed agentId, string agentURI, address indexed owner)`, `URIUpdated`, `MetadataSet`. Plus the standard ERC-721 `Transfer`.

**Key insight for `EnvoyFacilitator.pay()`.** The contract must accept an `agentId` parameter and validate that the EIP-712 payment authorization was signed by `IIdentityRegistry.getAgentWallet(agentId)` (the agent's designated signer), not just any address. This is the canonical 8004 auth model — `agentWallet` is the signing identity; `ownerOf(agentId)` is the controlling NFT holder. They start equal but can diverge.

**Security feature worth knowing.** On NFT transfer, `agentWallet` is cleared (in `_update` override). The new owner must re-register their wallet via `setAgentWallet` with a fresh EIP-712 signature. This means our Facilitator's `getAgentWallet` lookup is always fresh — no carry-over risk.

### Reputation Registry — interface we'll call from the SDK

```solidity
function giveFeedback(
    uint256 agentId,
    int128 value,            // signed, ±1e38 max abs
    uint8 valueDecimals,     // 0..18
    string calldata tag1,
    string calldata tag2,
    string calldata endpoint,
    string calldata feedbackURI,
    bytes32 feedbackHash
) external;

function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;
function readAllFeedback(uint256 agentId, address[] clients, string tag1, string tag2, bool includeRevoked) external view returns (...);
function getSummary(uint256 agentId, address[] clients, string tag1, string tag2) external view returns (...);
```

**Auth model.** `giveFeedback` blocks self-rating — the IdentityRegistry's `isAuthorizedOrOwner(msg.sender, agentId)` check reverts if the caller is the agent's owner or approved operator. Feedback is keyed by `(agentId, clientAddress, feedbackIndex)` with the index 1-indexed per client.

**Events.** `NewFeedback`, `FeedbackRevoked`, `ResponseAppended`.

### Implications for our refactor

1. **Our `EnvoyFacilitator` takes `uint256 agentId` everywhere**, not a string DID. This matches 8004 and is what 8004scan indexes.
2. **EIP-712 signer = `getAgentWallet(agentId)`**, not `ownerOf(agentId)`. We do an `IIdentityRegistry(0x8004A…).getAgentWallet(agentId)` lookup inside `pay()`.
3. **SDK helpers (Task #4) just wrap viem `writeContract` calls** with a tiny ABI subset — no need to depend on `@chaoschain/sdk`. The interface above is the full API surface we need.
4. **Agent card JSON spec.** `register(agentURI)` expects a URI to an agent card describing name, capabilities, endpoints. We'll host the card on IPFS or our own static origin and pass the URL.

---

## 2026-05-21 — Lock the demo: autonomous SMS in cKES via Africa's Talking

**Decision.** The flagship demo is an autonomous AI agent that pays for SMS sent through [Africa's Talking](https://africastalking.com) in cKES (Mento's Kenyan Shilling stablecoin on Celo). We host a thin gateway in front of Africa's Talking that speaks x402 and verifies on-chain settlement before forwarding the SMS request to the underlying telecom API.

**Why.**
- Real-world payments is the hackathon theme; paying for telecom infrastructure in a stablecoin denominated in the destination country's currency is as real-world as it gets.
- cKES on Mento + African telecom + autonomous agent hits every Celo judging signal in a single narrative.
- A real SMS arriving on a real phone in a demo video is the moment a judge stops scrolling.
- Each payment becomes an on-chain transaction attributable to the agent's ERC-8004 identity, generating 8004scan footprint for Track 3.

**Alternatives considered and rejected.**
- Mock SMS service: simpler to ship but the demo loses its punch. The whole point is "real SMS arrives on a real phone."
- cUSD LLM micropayments: clean but Celo judges have seen this exact demo many times and it does not use Mento.

---

## 2026-05-21 — Lock the architecture: one Facilitator + canonical 8004 registries

**Decision.** Envoy ships **one** smart contract: `EnvoyFacilitator.sol` (~300 lines, formed by merging the existing `EnvoyEscrow` and `EnvoyPolicyGuard`). Identity and reputation are delegated to Celo's canonical ERC-8004 registries; we interact with them via TypeScript SDK helpers only. The previously scaffolded `EnvoyAgentRegistry` and `EnvoyReputation` move to `contracts/future/`.

**Why.**
- The canonical Celo ERC-8004 contracts already exist:
  - Identity Registry — `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (mainnet), `0x8004A818BFB912233c491871b3d84c89A494BD9e` (Sepolia)
  - Reputation Registry — `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (mainnet), `0x8004B663056A597Dffe9eCcC1965A193B7388713` (Sepolia)
- Re-inventing them as snowflakes loses Track 3 ($500, stackable) which rewards 8004scan rank — 8004scan only sees agents in the canonical registry.
- One focused contract beats four parallel ones on every axis: smaller audit surface, tighter tests, cleaner pitch ("we ship the missing payment layer between ERC-8004 identity and Mento stablecoins").
- Atomic `checkPolicy + pay + emit Receipt` in one function is the cleanest demo story and avoids the two-call pattern's race conditions.

**Track strategy.**
- Track 1 ($3K/$1K, Best Agent on Celo): primary, won on demo quality + Celo-native integration.
- Track 3 ($500, 8004scan rank, stackable): falls out automatically from canonical 8004 Identity registration + on-chain tx volume.
- Track 2 ($500, most activity): bonus that falls out of the 24–72h live mainnet loop near submission.

**Alternatives considered and rejected.**
- "Refactor `EnvoyAgentRegistry` to be ERC-8004-compatible": still ships our own registry alongside canonical — two registration paths, more code, less clean pitch.
- Keep all four contracts: more surface, more bugs, more for judges to skim past, and the snowflake reputation contract was already dead weight without sybil resistance.

---

## 2026-05-21 — Confirm hackathon scope and posture

**Decision.** Build Envoy for the Celo Onchain Agents Hackathon (May 22 – June 15, 2026). Two-person unfunded team. Production-quality patterns on a narrow surface — don't drop quality just because it is a hackathon.

**Why.**
- $5K prize pool, three tracks, 24 calendar days.
- Submission needs Karma project page, demo video, GitHub repo, pitch deck, tweet tagging @Celo / @CeloDevs / @CeloPG, agentscan agentId, Self Agent ID.
- First-party Celo resources judges expect to see used: ERC-8004, x402 (Thirdweb), celo/skills, Self Agent ID, 8004scan, Mento stablecoins, MiniPay.

**How to apply.**
- Cut surface area aggressively (one chain, one demo use case, one contract) but keep tests, types, and deploy verification production-grade.
- Every architectural decision must serve Track 1 (demo quality), Track 3 (8004scan), or both. Anything else is scope.

---

## 2026-05-XX — Fork from ASGCompute-ows-agent-pay (git history)

Captured for the record from `git log`:

- `de9b442 docs: restructure README for clarity` — narrative oriented around Celo + autonomous agents
- `df6745b chore: scaffold envoy from ows-agent-pay (Celo-first + on-chain layer)` — initial fork, added `contracts/` workspace with the four-contract scaffold
