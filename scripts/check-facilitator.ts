/**
 * Health check for the deployed EnvoyFacilitator — read-only, no gas.
 * Doubles as a test that the SDK's read path works against the live contract.
 *
 *   npx ts-node --transpile-only scripts/check-facilitator.ts            # Celo mainnet (default)
 *   CHAIN=sepolia npx ts-node --transpile-only scripts/check-facilitator.ts
 */
import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { createEnvoyFacilitator, getEnvoyAddresses } from '../src';

const ZERO = '0x0000000000000000000000000000000000000000';

async function main() {
  const chain = process.env.CHAIN === 'sepolia' ? celoSepolia : celo;
  const { facilitator, identityRegistry, reputationRegistry } = getEnvoyAddresses(chain.id);

  if (facilitator === ZERO) {
    throw new Error(`No EnvoyFacilitator recorded for ${chain.name} (${chain.id}).`);
  }

  const publicClient = createPublicClient({ chain, transport: http() });

  // Confirm there is actually bytecode at the address.
  const code = await publicClient.getCode({ address: facilitator });
  if (!code || code === '0x') {
    throw new Error(`No contract code at ${facilitator} on ${chain.name}.`);
  }

  const fac = createEnvoyFacilitator({ address: facilitator, publicClient, chainId: chain.id });
  const [feeBps, maxFeeBps, treasury, onchainRegistry, domain] = await Promise.all([
    fac.getFeeBps(),
    fac.getMaxFeeBps(),
    fac.getTreasury(),
    fac.getIdentityRegistry(),
    fac.domainSeparator(),
  ]);

  console.log(`EnvoyFacilitator · ${chain.name} (${chain.id})`);
  console.log(`  address:           ${facilitator}`);
  console.log(`  bytecode:          ${code.length} chars  ✓ deployed`);
  console.log(`  feeBps:            ${feeBps}  (${(feeBps / 100).toFixed(2)}%, max ${maxFeeBps})`);
  console.log(`  treasury:          ${treasury}`);
  console.log(`  identityRegistry:  ${onchainRegistry}`);
  console.log(`  domainSeparator:   ${domain}`);
  console.log(`  reputationRegistry:${reputationRegistry}  (canonical, read-only)`);

  const registryOk = onchainRegistry.toLowerCase() === identityRegistry.toLowerCase();
  const feeOk = feeBps <= maxFeeBps;

  console.log('\nChecks');
  console.log(`  identity registry matches canonical: ${registryOk ? 'YES ✓' : `NO ✗ (expected ${identityRegistry})`}`);
  console.log(`  fee within bounds:                   ${feeOk ? 'YES ✓' : 'NO ✗'}`);

  if (registryOk && feeOk) {
    console.log(`\n✔ Facilitator is live, configured correctly, and responding on ${chain.name}.`);
  } else {
    console.log('\n✗ Facilitator responded but configuration looks off (see above).');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗', err.shortMessage || err.message);
  process.exit(1);
});
