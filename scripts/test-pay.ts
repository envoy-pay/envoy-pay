/**
 * End-to-end test of the deployed EnvoyFacilitator `pay()` path — REAL cUSD + gas.
 *
 * Flow: the agent's signing wallet (= owner = payer) signs an EIP-712 PaymentAuth;
 * pay() pulls `amount` cUSD from that wallet, sends net → merchant and fee → treasury.
 *
 * Requirements:
 *   - PRIVATE_KEY      the agent's signing wallet. Must equal getAgentWallet(AGENT_ID),
 *                      and must hold cUSD + a little CELO for gas.
 *   - AGENT_ID         a registered ERC-8004 agent id (see scripts/register-agent.ts).
 *
 * Optional:
 *   - AMOUNT=0.01      cUSD to move (default 0.01)
 *   - MERCHANT=0x...   recipient of `net` (default: self — you only lose the 0.25% fee)
 *   - CHAIN=sepolia    (default: celo mainnet, where the facilitator is deployed)
 *   - CONFIRM=send     actually broadcast. Without it the script DRY-RUNS (reads only).
 *
 *   npx ts-node --transpile-only scripts/test-pay.ts                    # dry run
 *   CONFIRM=send PRIVATE_KEY=0x.. AGENT_ID=1 npx ts-node --transpile-only scripts/test-pay.ts
 */
import { randomBytes } from 'crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo, celoSepolia } from 'viem/chains';
import {
  createEnvoyFacilitator,
  getEnvoyAddresses,
  signPaymentAuth,
  erc8004,
  type PaymentAuth,
} from '../src';

const ZERO = '0x0000000000000000000000000000000000000000';
const CUSD: Record<number, Address> = {
  42220: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
  11142220: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
};
const DECIMALS = 18;

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

const fmt = (v: bigint) => formatUnits(v, DECIMALS);

async function main() {
  const pk = process.env.PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error('Set PRIVATE_KEY (the agent signing wallet = owner = payer).');
  if (process.env.AGENT_ID === undefined) throw new Error('Set AGENT_ID (a registered ERC-8004 agent id).');

  const agentId = BigInt(process.env.AGENT_ID);
  const chain = process.env.CHAIN === 'sepolia' ? celoSepolia : celo;
  const amount = parseUnits(process.env.AMOUNT ?? '0.01', DECIMALS);
  const confirm = process.env.CONFIRM === 'send';

  const account = privateKeyToAccount(pk);
  const me = account.address;
  const merchant = getAddress((process.env.MERCHANT as Hex) ?? me);
  const token = CUSD[chain.id];
  if (!token) throw new Error(`No cUSD address for chain ${chain.id}`);

  const { facilitator, identityRegistry } = getEnvoyAddresses(chain.id);
  if (facilitator === ZERO) throw new Error(`No EnvoyFacilitator recorded for chain ${chain.id}.`);

  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ account, chain, transport: http() });

  console.log(`pay() test · ${chain.name} (${chain.id})`);
  console.log(`  facilitator:  ${facilitator}`);
  console.log(`  agentId:      ${agentId}`);
  console.log(`  wallet/payer: ${me}`);
  console.log(`  merchant:     ${merchant}${merchant.toLowerCase() === me.toLowerCase() ? '  (self — only the fee leaves you)' : ''}`);
  console.log(`  amount:       ${fmt(amount)} cUSD`);
  console.log(`  mode:         ${confirm ? 'LIVE — will broadcast real txs' : 'DRY-RUN — reads only (set CONFIRM=send to broadcast)'}`);

  // 1. The signing wallet must match getAgentWallet(agentId), or pay() reverts BadSigner.
  const agentWallet = await erc8004.getAgentWallet(publicClient, identityRegistry, agentId);
  console.log(`\n  getAgentWallet(${agentId}) = ${agentWallet}`);
  if (agentWallet === ZERO) throw new Error(`Agent ${agentId} has no signing wallet set (NoAgentWallet).`);
  if (agentWallet.toLowerCase() !== me.toLowerCase()) {
    throw new Error(`PRIVATE_KEY (${me}) is not the agent's signing wallet (${agentWallet}). pay() would revert.`);
  }

  const fac = createEnvoyFacilitator({ address: facilitator, publicClient, walletClient, chainId: chain.id });

  // 2. Read balance, allowance, current limit.
  const [bal, allowance, limit] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [me] }) as Promise<bigint>,
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [me, facilitator] }) as Promise<bigint>,
    fac.getLimit(agentId, token),
  ]);
  console.log(`  cUSD balance:   ${fmt(bal)}`);
  console.log(`  allowance→fac:  ${fmt(allowance)}`);
  console.log(`  limit:          enabled=${limit.enabled} perTx=${fmt(limit.perTx)} perPeriod=${fmt(limit.perPeriod)} spent=${fmt(limit.spentInPeriod)}`);

  if (bal < amount) throw new Error(`Insufficient cUSD: have ${fmt(bal)}, need ${fmt(amount)}.`);

  const remaining = limit.perPeriod - limit.spentInPeriod;
  const needsLimit = !limit.enabled || limit.perTx < amount || remaining < amount;
  const needsApprove = allowance < amount;
  console.log(`\n  will set limit: ${needsLimit ? 'yes' : 'no'} · will approve: ${needsApprove ? 'yes' : 'no'}`);

  if (!confirm) {
    console.log('\nDRY-RUN complete — nothing broadcast. Re-run with CONFIRM=send to execute.');
    return;
  }

  // 3. Set spending limit (caller must be the agent NFT owner/operator).
  if (needsLimit) {
    console.log('\n  setLimit…');
    const tx = await fac.setLimit({ agentId, token, perTx: amount * 10n, perPeriod: amount * 100n, periodLen: 86400 });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`  ✓ limit set · ${tx}`);
  }

  // 4. Approve the facilitator to move cUSD on the payer's behalf.
  if (needsApprove) {
    console.log('  approve cUSD → facilitator…');
    const tx = await walletClient.sendTransaction({
      to: token,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [facilitator, amount * 100n] }),
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`  ✓ approved · ${tx}`);
  }

  // 5. Build + sign the PaymentAuth.
  const auth: PaymentAuth = {
    agentId,
    token,
    merchant,
    amount,
    challengeId: (`0x${randomBytes(32).toString('hex')}`) as Hex,
    nonce: BigInt(Date.now()),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };
  const signature = await signPaymentAuth(walletClient, { chainId: chain.id, facilitatorAddress: facilitator, auth });
  console.log('\n  signed PaymentAuth · calling pay()…');

  // 6. Settle.
  const settled = await fac.pay(auth, signature);
  console.log('\n✔ Settled on-chain:');
  console.log(`    amount: ${fmt(settled.amount)} cUSD`);
  console.log(`    fee:    ${fmt(settled.fee)} cUSD → treasury`);
  console.log(`    net:    ${fmt(settled.amount - settled.fee)} cUSD → ${settled.merchant}`);
  console.log(`    signer: ${settled.signer}`);
  console.log(`    nonce:  ${settled.nonce}`);
}

main().catch((err) => {
  console.error('\n✗', err.shortMessage || err.message);
  process.exit(1);
});
