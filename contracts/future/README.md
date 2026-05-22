# contracts/future

This folder contains contracts that were scaffolded during early Envoy design but **removed from the active v1 build** before deployment. They remain here as reference for potential v2 work and to document the reasoning trail.

## Why these moved here

The canonical [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) Identity and Reputation registries are already deployed on Celo. Re-implementing them as Envoy-specific snowflakes would have:

1. **Lost Track 3 of the hackathon** (8004scan rank) — 8004scan only indexes agents in the canonical registry at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (mainnet) / `0x8004A818BFB912233c491871b3d84c89A494BD9e` (Sepolia).
2. **Doubled the audit surface** for no functional gain — the canonical contracts are an ERC standard, battle-tested and upgradeable.
3. **Weakened the pitch.** "We ship the missing payment layer on top of Celo's ERC-8004 stack" beats "we ship four parallel contracts that re-invent ERC-8004."

In v1 the SDK calls the canonical 8004 contracts directly via thin viem helpers in `src/identity/`. See [`docs/BUILD_LOG.md`](../../docs/BUILD_LOG.md) for the full decision trail and the captured ERC-8004 interface.

## Files

- [`EnvoyAgentRegistry.sol`](EnvoyAgentRegistry.sol) — snowflake DID registry (`did:envoy:…` → owner + metadata URI). Superseded by canonical ERC-8004 Identity Registry.
- [`EnvoyReputation.sol`](EnvoyReputation.sol) — caller-signed reputation attestations per `(agent DID, category)`. Superseded by canonical ERC-8004 Reputation Registry.
- [`EnvoyEscrow.sol`](EnvoyEscrow.sol) — two-step deposit / EIP-712 release / refund-on-timeout escrow. Logic preserved in the new `EnvoyFacilitator.sol` (with the deposit step removed; the new contract pulls funds directly from the agent's wallet at settle time and never holds them).
- [`EnvoyPolicyGuard.sol`](EnvoyPolicyGuard.sol) — daily spending caps keyed by agent address. Logic preserved in `EnvoyFacilitator.sol` (now keyed by ERC-8004 `agentId`, with configurable period length per (agent, token) instead of a fixed 24h window).
- [`test/`](test/) — original Hardhat tests for all four contracts. They still pass against the moved sources if you compile this folder in isolation.

## If v2 ever resurrects them

Both contracts are kept untouched. The most likely v2 use case is **app-specific metadata that ERC-8004 doesn't carry** — e.g., a category-scoped reputation summary computed off-chain and pinned on-chain for cheap lookups. That would be a different contract from these, but the storage layout here is a useful starting reference.
