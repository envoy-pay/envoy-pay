/**
 * celo-quickstart — pay 1 cUSD on Celo via the envoy EvmPaymentAdapter.
 *
 * Run with: AGENT_PRIVATE_KEY=0x... npx ts-node examples/celo-quickstart.ts
 */
import { EnvoyClient, EvmPaymentAdapter } from '../src';

async function main() {
  const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.error('Set AGENT_PRIVATE_KEY in env (0x-prefixed hex)');
    process.exit(1);
  }

  const adapter = new EvmPaymentAdapter({
    chain: 'celo',
    asset: 'cUSD',
    privateKey,
    logger: console.log,
  });

  console.log(`Agent address: ${adapter.getAddress()}`);
  console.log(`cUSD balance:  ${await adapter.getStablecoinBalance('cUSD')}`);

  const client = new EnvoyClient({
    baseURL: process.env.X402_API ?? 'https://api.example.com',
    policy: { monthlyBudget: 100, maxAmountPerTransaction: 5 },
    adapter,
    logger: console.log,
  });

  // The remote endpoint should return 402 with an x402 challenge in cUSD.
  // EnvoyClient will detect, settle on Celo, and retry transparently.
  const data = await client.performTask('/expensive-resource', {});
  console.log('Response:', data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
