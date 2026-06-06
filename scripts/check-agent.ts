/**
 * Read-only agent readiness check — no private key, nothing broadcast.
 * Verifies an ERC-8004 agent is ready for the autonomous-loop demo:
 * binding, declared capability, on-chain spending policy, and funding.
 *
 *   AGENT_ID=9207 npx ts-node --transpile-only scripts/check-agent.ts
 *   AGENT_ID=9207 CAPABILITY=x402-payments CHAIN=celo npx ts-node --transpile-only scripts/check-agent.ts
 */
import { createPublicClient, http, formatUnits, getAddress, type Address } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { erc8004, getEnvoyAddresses, createEnvoyFacilitator } from '../src';

const CUSD: Address = '0x765DE816845861e75A25fCA122bb6898B8B1282a';
const BAL_ABI = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
const ZERO = '0x0000000000000000000000000000000000000000';

const AGENT_ID = BigInt(process.env.AGENT_ID ?? (() => { throw new Error('Set AGENT_ID'); })());
const WANT_CAP = (process.env.CAPABILITY ?? 'x402-payments').toLowerCase();
const NEED = Number(process.env.AMOUNT ?? '0.001');
const chain = process.env.CHAIN === 'sepolia' ? celoSepolia : celo;

const ok = (b: boolean, label: string, detail: string) => console.log(`  ${b ? '✓' : '✗'} ${label}  ·  ${detail}`);

function capsFromUri(uri?: string): string[] {
  if (!uri || !uri.startsWith('data:')) return [];
  try {
    const comma = uri.indexOf(',');
    const json = /;base64/i.test(uri.slice(5, comma))
      ? Buffer.from(uri.slice(comma + 1), 'base64').toString('utf-8')
      : decodeURIComponent(uri.slice(comma + 1));
    const c = JSON.parse(json)?.capabilities;
    return Array.isArray(c) ? c.filter((x: unknown) => typeof x === 'string').map((s: string) => s.toLowerCase()) : [];
  } catch { return []; }
}

async function main() {
  const { identityRegistry, facilitator } = getEnvoyAddresses(chain.id);
  const pc = createPublicClient({ chain, transport: http() });
  const fac = createEnvoyFacilitator({ address: facilitator, publicClient: pc, chainId: chain.id });

  console.log(`\nagent #${AGENT_ID} · ${chain.name} · wants capability "${WANT_CAP}"\n`);
  const { owner, agentWallet, tokenURI } = await erc8004.getAgent(pc, identityRegistry, AGENT_ID);
  const caps = capsFromUri(tokenURI);
  const [limit, cusdBal, celoBal] = await Promise.all([
    fac.getLimit(AGENT_ID, CUSD),
    pc.readContract({ address: CUSD, abi: BAL_ABI, functionName: 'balanceOf', args: [agentWallet] }) as Promise<bigint>,
    pc.getBalance({ address: agentWallet }),
  ]);

  console.log(`  owner          ${owner}`);
  console.log(`  signing wallet ${agentWallet}\n`);

  const bound = agentWallet !== ZERO && getAddress(agentWallet) !== getAddress(owner);
  ok(bound, 'signing wallet bound (≠ owner)', bound ? 'rotation succeeded' : 'still the owner — bind did not take');
  ok(caps.includes(WANT_CAP), `card declares "${WANT_CAP}"`, caps.length ? caps.join(', ') : 'no capabilities on card');
  const remaining = limit.perPeriod - limit.spentInPeriod;
  const limitOk = limit.enabled && Number(formatUnits(limit.perTx, 18)) >= NEED && remaining >= limit.perTx;
  ok(limitOk, 'spending policy set', limit.enabled ? `perTx ${formatUnits(limit.perTx, 18)} · daily ${formatUnits(limit.perPeriod, 18)} cUSD` : 'no limit set (owner sets it at /create)');
  ok(Number(formatUnits(cusdBal, 18)) >= NEED, `funded with cUSD (≥ ${NEED})`, `${formatUnits(cusdBal, 18)} cUSD`);
  ok(celoBal > 0n, 'has CELO for gas', `${formatUnits(celoBal, 18)} CELO`);

  const ready = bound && caps.includes(WANT_CAP) && limitOk && Number(formatUnits(cusdBal, 18)) >= NEED && celoBal > 0n;
  console.log(`\n  ${ready ? '✓ READY for: CONFIRM=send AGENT_ID=' + AGENT_ID + ' …' : 'fund the signing wallet: ' + agentWallet}`);
}
main().catch((e) => { console.error('✗', e?.shortMessage ?? e?.message ?? e); process.exit(1); });
