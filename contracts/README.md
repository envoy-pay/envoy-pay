# envoy contracts

Solidity contracts powering envoy's on-chain layer on Celo.

## Contracts

| Contract | Purpose |
|---|---|
| `EnvoyAgentRegistry` | ERC-8004-inspired agent identity registry (DID → owner + metadata) |
| `EnvoyEscrow` | Payment escrow with EIP-712 signed release receipts |
| `EnvoyReputation` | On-chain reputation attestations per agent DID |
| `EnvoyPolicyGuard` | Trust-minimized spending caps for agent wallets |

## Quickstart

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
```

## Deploy

```bash
cp .env.example .env  # fill DEPLOYER_PRIVATE_KEY + CELOSCAN_API_KEY
npx hardhat run scripts/deploy.ts --network alfajores   # testnet
npx hardhat run scripts/deploy.ts --network celo        # mainnet
```

After deployment, copy the addresses into `src/contracts/addresses.ts` in the SDK workspace.

## Networks

| Network | Chain ID | RPC |
|---|---|---|
| Celo Mainnet | 42220 | `https://forno.celo.org` |
| Celo Alfajores | 44787 | `https://alfajores-forno.celo-testnet.org` |

## Verifying

```bash
npx hardhat verify --network alfajores <address> <constructor-args...>
```
