/**
 * The autonomous loop, closed — one command.
 *
 *   agent calls a paid API → gets 402 → pays for it ITSELF through the
 *   EnvoyFacilitator on Celo → retries → the merchant verifies the on-chain
 *   receipt + the agent's declared capability → serves the data.
 *
 * No human co-signs a single step. This is the sentence on the landing page,
 * finally runnable.
 *
 * ── Run ────────────────────────────────────────────────────────────────────
 *   # 1) Dry run — narrates the whole loop + checks readiness, spends NOTHING:
 *   AGENT_ID=128 AGENT_PRIVATE_KEY=0x… npx ts-node --transpile-only examples/autonomous-loop/demo.ts
 *
 *   # 2) For real — a genuine sub-cent settlement on Celo Mainnet:
 *   CONFIRM=send AGENT_ID=128 AGENT_PRIVATE_KEY=0x… npx ts-node --transpile-only examples/autonomous-loop/demo.ts
 *
 * ── Prerequisites (the agent must be a real, fundable ERC-8004 agent) ────────
 *   AGENT_ID            a registered ERC-8004 agent id (mint one at /create)
 *   AGENT_PRIVATE_KEY   its signing wallet — MUST equal getAgentWallet(AGENT_ID)
 *   …and that wallet must hold a little cUSD + a little CELO for gas. The agent's
 *   on-chain card must declare the capability the merchant asks for (default
 *   "x402-payments"). The owner sets the spending limit (done here if missing
 *   and this key is the owner).
 *
 * Optional: MERCHANT=0x… (default: self — only the ~0.25% fee leaves you),
 *           AMOUNT=0.001, CAPABILITY=x402-payments, RPC_URL=…, CHAIN=sepolia.
 */
import {
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { EnvoyClient, CELO_MAINNET, CELO_SEPOLIA } from '../../src';
import { FacilitatorAdapter } from './facilitator-adapter';
import { startMerchant } from './merchant';
import { SelfAgent, type AgentInfo } from '@selfxyz/agent-sdk';
import {
  createHumanProofVerifier,
  attachHumanProofSigning,
  networkForChain,
} from './self-identity';

const DECIMALS = 18;
const fmt = (v: bigint) => formatUnits(v, DECIMALS);
const log = (s = '') => console.log(s);

async function main() {
  // ── Inputs ────────────────────────────────────────────────────────────────
  const agentIdRaw = process.env.AGENT_ID;
  const pk = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!agentIdRaw || !pk) {
    fail(
      'Missing AGENT_ID and/or AGENT_PRIVATE_KEY.\n' +
        '  Mint an agent at the /create page (it reveals the signing key once), then:\n' +
        '  AGENT_ID=<id> AGENT_PRIVATE_KEY=0x… npx ts-node --transpile-only examples/autonomous-loop/demo.ts',
    );
  }
  const agentId = BigInt(agentIdRaw!);
  const chainId = process.env.CHAIN === 'sepolia' ? CELO_SEPOLIA : CELO_MAINNET;
  const chain = chainId === CELO_MAINNET ? celo : celoSepolia;
  const rpcUrl = process.env.RPC_URL;
  const amount = parseUnits(process.env.AMOUNT ?? '0.001', DECIMALS);
  const requiredCapability = (process.env.CAPABILITY ?? 'x402-payments').toLowerCase();
  const confirm = process.env.CONFIRM === 'send';
  const explorer = chainId === CELO_MAINNET ? 'https://celoscan.io' : 'https://celo-sepolia.blockscout.com';

  // ── Self Agent ID — optional proof-of-human layer (off by default) ──────────
  const requireHumanProof = process.env.REQUIRE_HUMAN_PROOF === '1' || process.env.REQUIRE_HUMAN_PROOF === 'true';
  const selfNetwork = networkForChain(chainId);
  const selfRequireOFAC = process.env.REQUIRE_OFAC === '1' || process.env.REQUIRE_OFAC === 'true';
  const selfMinAge = process.env.MIN_AGE ? Number(process.env.MIN_AGE) : undefined;
  // The agent's Envoy signing key IS its Self key — one identity, both registries.
  const selfAgent = requireHumanProof
    ? new SelfAgent({ privateKey: pk!, network: selfNetwork, ...(rpcUrl ? { rpcUrl } : {}) })
    : null;

  const adapter = new FacilitatorAdapter({ agentId, privateKey: pk!, chainId, rpcUrl, logger: log });
  const agentWallet = adapter.getAddress() as Address;
  const merchant = getAddress((process.env.MERCHANT as Hex) ?? agentWallet);
  const selfPay = merchant.toLowerCase() === agentWallet.toLowerCase();

  banner('envoy · autonomous payment loop');
  log(`  chain:      ${chain.name} (${chainId})`);
  log(`  agent:      #${agentId}  ·  signing wallet ${agentWallet}`);
  log(`  merchant:   ${merchant}${selfPay ? '  (self — only the fee leaves you)' : ''}`);
  log(`  price:      ${fmt(amount)} cUSD  ·  resource needs capability "${requiredCapability}"`);
  if (requireHumanProof) {
    log(`  identity:   proof-of-human REQUIRED · Self Agent ID (${selfNetwork})` +
      `${selfRequireOFAC ? ' · OFAC' : ''}${selfMinAge ? ` · age≥${selfMinAge}` : ''}`);
  }
  log(`  mode:       ${confirm ? 'LIVE — will broadcast a real settlement' : 'DRY-RUN — reads only (set CONFIRM=send to execute)'}`);

  // ── Preflight — everything the loop needs, checked before any spend ─────────
  banner('preflight');
  const [onchainWallet, cusd, celoBal, limit, caps] = await Promise.all([
    adapter.resolveAgentWallet(),
    adapter.cusdBalance(),
    adapter.celoBalance(),
    adapter.getLimit(),
    adapter.capabilities(),
  ]);

  const walletOk = onchainWallet !== '0x0000000000000000000000000000000000000000' &&
    onchainWallet.toLowerCase() === agentWallet.toLowerCase();
  check(walletOk, `signing key is agent #${agentId}'s wallet`,
    walletOk ? onchainWallet : `on-chain wallet is ${onchainWallet} — your key doesn't match (pay() would revert BadSigner)`);

  const hasFunds = parseUnits(cusd, DECIMALS) >= amount;
  check(hasFunds, `cUSD balance covers the price`, `${cusd} cUSD${hasFunds ? '' : ` — need ≥ ${fmt(amount)}; fund the agent at /fund/${agentId}`}`);

  const hasGas = Number(celoBal) > 0;
  check(hasGas, `CELO for gas`, `${celoBal} CELO${hasGas ? '' : ' — the agent pays its own gas; send it a little CELO'}`);

  const remaining = limit.perPeriod - limit.spentInPeriod;
  const limitOk = limit.enabled && limit.perTx >= amount && remaining >= amount;
  check(limitOk, `on-chain spending policy covers it`,
    limit.enabled
      ? `perTx ${fmt(limit.perTx)} · ${fmt(remaining)} left today${limitOk ? '' : ' — too low for this amount'}`
      : 'no policy set — the owner sets one (auto-set below if this key is the owner)');

  const capOk = caps.includes(requiredCapability);
  check(capOk, `card declares "${requiredCapability}"`,
    caps.length ? `card lists: ${caps.join(', ')}${capOk ? '' : ' — merchant will reject; add it to the agent card'}` : 'card lists no capabilities — merchant will reject');

  // Proof-of-human: is this signing key registered + verified on Self's registry?
  let selfInfo: AgentInfo | null = null;
  let humanOk = true;
  if (selfAgent) {
    try {
      selfInfo = await selfAgent.getInfo();
    } catch {
      selfInfo = null;
    }
    humanOk = !!selfInfo?.isVerified && selfInfo.isProofFresh;
    check(humanOk, `agent is human-backed (Self Agent ID)`,
      selfInfo?.isVerified
        ? `Self Agent #${selfInfo.agentId}${selfInfo.isProofFresh ? ` · proof valid` : ' · proof STALE — refresh it'}`
        : 'this key has no Self Agent ID — run `npm run register:self` (owner scans a passport once)');
  }

  // ── How the loop will run (always shown — this is the teaching moment) ──────
  banner('the loop');
  if (requireHumanProof) {
    log('  0. agent  → signs every request with its Self key                  (proof-of-human)');
    log('     server → recovers the signer, checks Self\'s Celo registry      (human-backed? OFAC?)');
  }
  log('  1. agent  → POST /premium/market-report           (no payment yet)');
  log('  2. server → 402 Payment Required                   (x402 challenge, asks cUSD on Celo)');
  log('  3. agent  → EnvoyClient intercepts the 402, checks its budget policy');
  log('  4. agent  → signs an EIP-712 PaymentAuth with ITS OWN key — no human co-signs');
  log('  5. chain  → EnvoyFacilitator.pay() splits net→merchant, fee→treasury, emits Settled');
  log('  6. agent  → retries the request with the Settled tx hash as the X-PAYMENT proof');
  log('  7. server → verifies the receipt on-chain + the agent\'s capability, returns the data');

  if (!confirm) {
    banner('dry-run complete');
    if (walletOk && hasFunds && hasGas && capOk && humanOk) {
      log('  ✓ Ready. Re-run with CONFIRM=send to execute the real (sub-cent) loop:');
      log(`      CONFIRM=send AGENT_ID=${agentId} AGENT_PRIVATE_KEY=0x… npx ts-node --transpile-only examples/autonomous-loop/demo.ts`);
    } else {
      log('  Fix the ✗ items above, then re-run. Nothing was broadcast.');
    }
    return;
  }

  // ── Hard stops before spending real money ───────────────────────────────────
  if (!walletOk) fail('AGENT_PRIVATE_KEY is not the agent\'s signing wallet — aborting before spend.');
  if (!hasFunds) fail(`Agent has ${cusd} cUSD but needs ≥ ${fmt(amount)} — fund it at /fund/${agentId}.`);
  if (!hasGas) fail('Agent wallet has no CELO for gas — send it a little CELO.');
  if (!capOk) fail(`Agent #${agentId}'s card doesn't declare "${requiredCapability}" — the merchant will reject it.`);
  if (requireHumanProof && !humanOk) fail('REQUIRE_HUMAN_PROOF is set but this key has no fresh Self Agent ID — run `npm run register:self` first.');

  // Owner sets the policy if it's missing/too low (the agent can't raise its own cap).
  if (!limitOk) {
    const isOwner = await adapter.isOwnerOrOperator();
    if (!isOwner) fail('Spending policy is too low and this key is not the agent owner — set the limit at /create.');
    banner('set spending policy');
    const tx = await adapter.setLimit(amount * 10n, amount * 100n);
    log(`  ✓ policy set (perTx ${fmt(amount * 10n)} · daily ${fmt(amount * 100n)} cUSD) · ${tx}`);
  }

  // ── Run it for real ─────────────────────────────────────────────────────────
  banner('running');
  const merchantSrv = await startMerchant({
    payTo: merchant,
    amount,
    requiredCapability,
    chainId,
    rpcUrl,
    logger: log,
    humanProofVerifier: requireHumanProof
      ? createHumanProofVerifier({ chainId, requireOFAC: selfRequireOFAC, minimumAge: selfMinAge, rpcUrl })
      : undefined,
  });

  try {
    // This is the whole agent. The interceptor does payment + retry transparently.
    const agent = new EnvoyClient({
      baseURL: merchantSrv.url,
      policy: { monthlyBudget: 100, maxAmountPerTransaction: 5 },
      adapter,
      logger: log,
    });

    // Sign every outbound request with the agent's Self key (proof-of-human).
    if (selfAgent) attachHumanProofSigning(agent.api, selfAgent);

    log('');
    const data = await agent.performTask('/premium/market-report', { ask: 'CELO/USD 24h' });

    banner('done ✓ — paid data received, no human in the loop');
    log('  merchant response:');
    log('  ' + JSON.stringify(data));
    if (adapter.lastSettled) {
      const s = adapter.lastSettled;
      log('');
      log(`  settled:    ${fmt(s.amount)} cUSD  ·  fee ${fmt(s.fee)} → treasury  ·  net ${fmt(s.amount - s.fee)} → merchant`);
      log(`  receipt:    ${explorer}/tx/${s.txHash}`);
    }
  } finally {
    await merchantSrv.close();
  }
}

// ── tiny console helpers ──────────────────────────────────────────────────────
function banner(title: string) {
  log('');
  log(`── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}
function check(ok: boolean, label: string, detail: string) {
  log(`  ${ok ? '✓' : '✗'} ${label}  ·  ${detail}`);
}
function fail(msg: string): never {
  log('');
  console.error(`✗ ${msg}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\n✗', err?.shortMessage ?? err?.message ?? err);
  process.exit(1);
});
