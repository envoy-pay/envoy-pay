/**
 * celo-escrow — deposit cUSD into EnvoyEscrow and release on a facilitator signature.
 *
 * Demonstrates the on-chain settlement flow:
 *   1. Agent deposits funds against a paymentId
 *   2. Facilitator signs an EIP-712 Release message off-chain
 *   3. Anyone submits (paymentId, recipient, amount, deadline, sig) → release
 *
 * Run with:
 *   AGENT_PRIVATE_KEY=0x...
 *   FACILITATOR_PRIVATE_KEY=0x...
 *   ESCROW_ADDRESS=0x...
 *   npx ts-node examples/celo-escrow.ts
 */
import { createPublicClient, createWalletClient, http, parseEther, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celoAlfajores } from 'viem/chains';
import { createEscrow } from '../src/contracts/escrow';

async function main() {
  const agentKey = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
  const facilitatorKey = process.env.FACILITATOR_PRIVATE_KEY as `0x${string}`;
  const escrowAddress = process.env.ESCROW_ADDRESS as `0x${string}`;
  const cusdAddress = '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1' as `0x${string}`; // Alfajores cUSD
  const recipient = '0x000000000000000000000000000000000000dEaD' as `0x${string}`;

  if (!agentKey || !facilitatorKey || !escrowAddress) {
    console.error('Set AGENT_PRIVATE_KEY, FACILITATOR_PRIVATE_KEY, ESCROW_ADDRESS');
    process.exit(1);
  }

  const agentAccount = privateKeyToAccount(agentKey);
  const facilitatorAccount = privateKeyToAccount(facilitatorKey);

  const publicClient = createPublicClient({ chain: celoAlfajores, transport: http() });
  const walletClient = createWalletClient({ chain: celoAlfajores, transport: http(), account: agentAccount });

  const escrow = createEscrow({
    address: escrowAddress,
    chainId: celoAlfajores.id,
    publicClient,
    walletClient,
    account: agentAccount,
  });

  // 1. Deposit 1 cUSD
  const paymentId = keccak256(toHex(`payment-${Date.now()}`));
  const amount = parseEther('1');
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log(`Depositing 1 cUSD against paymentId ${paymentId}…`);
  // NOTE: assumes the agent has already approved escrowAddress to spend cUSD.
  const depositTx = await escrow.deposit(cusdAddress, amount, paymentId, expiresAt);
  console.log(`Deposit tx: ${depositTx}`);

  // 2. Facilitator signs a Release off-chain
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const typed = escrow.buildReleaseTypedData({ paymentId, recipient, amount, deadline });

  const signature = await facilitatorAccount.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });
  console.log(`Facilitator signature: ${signature}`);

  // 3. Release
  const releaseTx = await escrow.release(paymentId, recipient, amount, deadline, signature);
  console.log(`Release tx: ${releaseTx}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
