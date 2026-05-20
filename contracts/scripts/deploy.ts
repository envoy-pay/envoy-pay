import { ethers, network } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying envoy contracts to ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const facilitator = process.env.FACILITATOR_ADDRESS ?? deployer.address;
  console.log(`Facilitator authority: ${facilitator}`);

  const Registry = await ethers.getContractFactory('EnvoyAgentRegistry');
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  console.log(`EnvoyAgentRegistry → ${await registry.getAddress()}`);

  const Escrow = await ethers.getContractFactory('EnvoyEscrow');
  const escrow = await Escrow.deploy(deployer.address, facilitator);
  await escrow.waitForDeployment();
  console.log(`EnvoyEscrow         → ${await escrow.getAddress()}`);

  const Reputation = await ethers.getContractFactory('EnvoyReputation');
  const reputation = await Reputation.deploy();
  await reputation.waitForDeployment();
  console.log(`EnvoyReputation     → ${await reputation.getAddress()}`);

  const PolicyGuard = await ethers.getContractFactory('EnvoyPolicyGuard');
  const policyGuard = await PolicyGuard.deploy();
  await policyGuard.waitForDeployment();
  console.log(`EnvoyPolicyGuard    → ${await policyGuard.getAddress()}`);

  console.log('\nPaste these into src/contracts/addresses.ts:');
  console.log(JSON.stringify(
    {
      [network.config.chainId!]: {
        registry: await registry.getAddress(),
        escrow: await escrow.getAddress(),
        reputation: await reputation.getAddress(),
        policyGuard: await policyGuard.getAddress(),
      },
    },
    null,
    2,
  ));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
