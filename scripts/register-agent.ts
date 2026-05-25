/**
 * Register an ERC-8004 agent on Celo Sepolia (or mainnet) and print env
 * snippets to paste into web/.env.local.
 *
 *   DEPLOYER_PRIVATE_KEY=0x... npx ts-node scripts/register-agent.ts
 *
 * Optional:
 *   CHAIN=celo            // default: celoSepolia
 *   AGENT_URI=https://...
 */
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, celoSepolia } from 'viem/chains';
import { erc8004, getEnvoyAddresses } from '../src';

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error('Set DEPLOYER_PRIVATE_KEY (0x-prefixed)');

  const chain = process.env.CHAIN === 'celo' ? celo : celoSepolia;
  const { identityRegistry } = getEnvoyAddresses(chain.id);

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ account, chain, transport: http() });

  console.log(`Registering agent on ${chain.name} (${chain.id})`);
  console.log(`  Identity registry: ${identityRegistry}`);
  console.log(`  Owner / wallet:    ${account.address}`);
  if (process.env.AGENT_URI) console.log(`  URI:               ${process.env.AGENT_URI}`);

  const { agentId, txHash } = await erc8004.registerAgent(
    walletClient,
    publicClient,
    identityRegistry,
    { agentURI: process.env.AGENT_URI },
  );

  console.log(`\n✔ Registered agentId ${agentId}`);
  console.log(`  tx: ${txHash}`);

  console.log('\nPaste into web/.env.local:');
  console.log(`NEXT_PUBLIC_DEFAULT_AGENT_ID=${agentId}`);
  console.log(`NEXT_PUBLIC_DEFAULT_CHAIN_ID=${chain.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
