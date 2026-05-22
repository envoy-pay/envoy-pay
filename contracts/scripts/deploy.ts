import { ethers, network } from 'hardhat';

// Canonical ERC-8004 Identity Registry on Celo.
// Source: https://docs.celo.org/build-on-celo/build-with-ai/8004
const IDENTITY_REGISTRY: Record<number, string> = {
  42220: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',   // Celo mainnet
  11142220: '0x8004A818BFB912233c491871b3d84c89A494BD9e', // Celo Sepolia
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(network.config.chainId);

  const identityRegistry =
    process.env.IDENTITY_REGISTRY_ADDRESS ?? IDENTITY_REGISTRY[chainId];
  if (!identityRegistry) {
    throw new Error(
      `No canonical ERC-8004 Identity Registry mapped for chainId ${chainId}. ` +
        `Set IDENTITY_REGISTRY_ADDRESS env var to override.`,
    );
  }

  const feeBps = Number(process.env.FACILITATOR_FEE_BPS ?? 25); // 0.25 %
  const treasury = process.env.TREASURY_ADDRESS ?? deployer.address;
  const owner = process.env.OWNER_ADDRESS ?? deployer.address;

  console.log(`Deploying EnvoyFacilitator to ${network.name} (chainId ${chainId})`);
  console.log(`  Deployer:           ${deployer.address}`);
  console.log(`  Identity registry:  ${identityRegistry}`);
  console.log(`  Fee:                ${feeBps} bps`);
  console.log(`  Treasury:           ${treasury}`);
  console.log(`  Owner:              ${owner}`);

  const Facilitator = await ethers.getContractFactory('EnvoyFacilitator');
  const facilitator = await Facilitator.deploy(identityRegistry, feeBps, treasury, owner);
  await facilitator.waitForDeployment();

  const address = await facilitator.getAddress();
  console.log(`\nEnvoyFacilitator → ${address}`);

  console.log('\nPaste this entry into src/contracts/addresses.ts:');
  console.log(
    JSON.stringify(
      { [chainId]: { facilitator: address, identityRegistry } },
      null,
      2,
    ),
  );

  console.log('\nNext: verify on Celoscan with');
  console.log(
    `  npx hardhat verify --network ${network.name} ${address} ${identityRegistry} ${feeBps} ${treasury} ${owner}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
