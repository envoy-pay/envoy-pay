# envoy contracts

Solidity contracts powering envoy's on-chain layer on Celo.

> **Identity and reputation are not in this folder.** Envoy delegates those to the canonical [ERC-8004](https://docs.celo.org/build-on-celo/build-with-ai/8004) Identity and Reputation registries already deployed on Celo. The SDK side (`src/identity/`) calls them directly via viem. See [`docs/BUILD_LOG.md`](../docs/BUILD_LOG.md) for the decision trail.

## Contracts

| Contract | Purpose |
|---|---|
| [`EnvoyFacilitator.sol`](src/EnvoyFacilitator.sol) | Atomic x402 / MPP payment facilitator for ERC-8004-identified agents. One `pay()` call consumes an EIP-712 auth, validates the signer against canonical `getAgentWallet(agentId)`, enforces per-(agent, token) rolling-window limits, and settles directly to the merchant. Never holds funds. |

Archived contracts (superseded by canonical ERC-8004, or merged into Facilitator) live under [`future/`](future/).

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
npx hardhat run scripts/deploy.ts --network celoSepolia  # testnet
npx hardhat run scripts/deploy.ts --network celo         # mainnet
```

After deployment, copy the addresses into `src/contracts/addresses.ts` in the SDK workspace.

## Networks

| Network | Chain ID | RPC |
|---|---|---|
| Celo Mainnet | 42220 | `https://forno.celo.org` |
| Celo Sepolia | 11142220 | `https://forno.celo-sepolia.celo-testnet.org` |

Celo Sepolia replaces Alfajores as the active testnet — the canonical ERC-8004 contracts are deployed on Sepolia, not Alfajores.

### Canonical ERC-8004 addresses on Celo

| Registry | Mainnet | Sepolia |
|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Verifying

```bash
npx hardhat verify --network celoSepolia <address> <constructor-args...>
```
