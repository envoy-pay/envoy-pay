/**
 * celo-agent-identity — register an agent DID in EnvoyAgentRegistry on Celo.
 *
 * Run with:
 *   AGENT_PRIVATE_KEY=0x...
 *   REGISTRY_ADDRESS=0x...
 *   npx ts-node examples/celo-agent-identity.ts
 */
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celoAlfajores } from 'viem/chains';
import { createAgentRegistry } from '../src/contracts/agent-registry';

async function main() {
  const agentKey = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
  const registryAddress = process.env.REGISTRY_ADDRESS as `0x${string}`;
  if (!agentKey || !registryAddress) {
    console.error('Set AGENT_PRIVATE_KEY and REGISTRY_ADDRESS');
    process.exit(1);
  }

  const account = privateKeyToAccount(agentKey);
  const publicClient = createPublicClient({ chain: celoAlfajores, transport: http() });
  const walletClient = createWalletClient({ chain: celoAlfajores, transport: http(), account });

  const registry = createAgentRegistry({
    address: registryAddress,
    publicClient,
    walletClient,
    account,
  });

  const did = `did:envoy:${account.address.toLowerCase()}`;
  const metadataURI = 'ipfs://Qm…example-agent-card';

  console.log(`Registering ${did}…`);
  const tx = await registry.registerAgent(did, account.address, metadataURI);
  console.log(`Tx: ${tx}`);

  const record = await registry.getAgent(did);
  console.log('Registered agent:', record);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
