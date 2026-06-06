/**
 * Get a Self Agent ID for your Envoy agent — one command, one passport scan.
 *
 * This is what produces the **Self Agent ID** the hackathon asks for in the
 * submission tweet ("beneficial for submissions") AND what makes the autonomous
 * loop's agent provably human-backed (run the demo with REQUIRE_HUMAN_PROOF=1).
 *
 * Self Agent ID is a soulbound ERC-721 on Celo that binds an agent's key to a
 * human's passport via a zero-knowledge proof — no personal data leaves the
 * owner's phone. It's a Proof-of-Human extension of ERC-8004, so it sits right
 * on top of the standard Envoy already speaks. Note: this is a SEPARATE registry
 * from the canonical ERC-8004 one Envoy mints into at /create — the two share
 * the same agent key but live at different addresses.
 *
 * ── Run ────────────────────────────────────────────────────────────────────
 *   # Testnet (mock passport in the Self app — good for a dry submission):
 *   HUMAN_ADDRESS=0xYourOwnerWallet CHAIN=sepolia npm run register:self
 *
 *   # Mainnet (real passport — the one you put in the tweet):
 *   HUMAN_ADDRESS=0xYourOwnerWallet npm run register:self
 *
 * ── Inputs ───────────────────────────────────────────────────────────────────
 *   HUMAN_ADDRESS   (required) the owner's wallet — the human the agent binds to
 *   CHAIN           sepolia → Self testnet; anything else → Self mainnet (default)
 *   MODE            linked (default) | self-custody | wallet-free | smartwallet
 *   AGENT_NAME      display name for the agent (default "Envoy Agent")
 *   MIN_AGE         18 or 21 to gate the human's age (default: none)
 *   REQUIRE_OFAC=1  request OFAC screening disclosure (default: off)
 *
 * On success it prints your Self Agent ID + the agent's key. Use that key as the
 * Envoy AGENT_PRIVATE_KEY (and as the agent wallet you bind at /create) so ONE
 * key is provable in both registries.
 */
import { SelfAgent, type RegistrationRequest } from '@selfxyz/agent-sdk';

const log = (s = '') => console.log(s);
function banner(title: string) {
  log('');
  log(`── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}
function fail(msg: string): never {
  log('');
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const humanAddress = process.env.HUMAN_ADDRESS;
  if (!humanAddress) {
    fail(
      'Missing HUMAN_ADDRESS (the owner wallet the agent binds to).\n' +
        '  HUMAN_ADDRESS=0xYourOwnerWallet npm run register:self            # mainnet, real passport\n' +
        '  HUMAN_ADDRESS=0xYourOwnerWallet CHAIN=sepolia npm run register:self  # testnet, mock passport',
    );
  }

  const network = process.env.CHAIN === 'sepolia' ? 'testnet' : 'mainnet';
  const mode = (process.env.MODE ?? 'linked') as RegistrationRequest['mode'];
  const agentName = process.env.AGENT_NAME ?? 'Envoy Agent';
  const minimumAge = process.env.MIN_AGE ? Number(process.env.MIN_AGE) : undefined;
  const ofac = process.env.REQUIRE_OFAC === '1' || process.env.REQUIRE_OFAC === 'true';

  banner('envoy · register a Self Agent ID');
  log(`  network:    Self ${network} (Celo ${network === 'mainnet' ? '42220' : 'Sepolia 11142220'})`);
  log(`  mode:       ${mode}`);
  log(`  human:      ${humanAddress}`);
  log(`  agent name: ${agentName}`);
  log(`  disclosures:${minimumAge ? ` age≥${minimumAge}` : ''}${ofac ? ' OFAC' : ''}${!minimumAge && !ofac ? ' none' : ''}`);

  banner('opening a registration session');
  const session = await SelfAgent.requestRegistration({
    mode,
    network,
    humanAddress,
    agentName,
    disclosures: {
      ...(minimumAge ? { minimumAge } : {}),
      ...(ofac ? { ofac: true } : {}),
    },
  });

  log(`  agent address: ${session.agentAddress}`);
  log('');
  log('  Scan this in the Self app (Settings → scan, or open the link on the phone):');
  log(`    ${session.deepLink}`);
  log('');
  for (const line of session.humanInstructions ?? []) log(`    • ${line}`);
  log('');
  log(`  Waiting for the passport proof… (session expires in ~${Math.round((session.timeRemainingMs ?? 0) / 60000)} min)`);

  const result = await session.waitForCompletion({ timeoutMs: 15 * 60_000, pollIntervalMs: 3000 }).catch((err) => {
    fail(`Registration did not complete: ${err?.message ?? err}`);
  });

  const explorer = network === 'mainnet' ? 'https://celoscan.io' : 'https://celo-sepolia.blockscout.com';
  banner('✓ registered — you have a Self Agent ID');
  log(`  Self Agent ID:  ${result!.agentId}      ← put THIS in your submission tweet`);
  log(`  agent address:  ${result!.agentAddress}`);
  if (result!.txHash) log(`  tx:             ${explorer}/tx/${result!.txHash}`);

  // For modes that generated the agent key, reveal it ONCE so it can become the
  // Envoy agent key (same identity in both registries). Self-custody reuses the
  // human wallet, so there's nothing to export.
  try {
    const key = await session.exportKey();
    if (key) {
      banner('agent signing key (shown once — store it now)');
      log('  Use this as the Envoy agent key everywhere:');
      log(`    AGENT_PRIVATE_KEY=${key}`);
      log('');
      log('  Then mint/bind this same address as the agent wallet at /create, and run:');
      log(`    REQUIRE_HUMAN_PROOF=1 CONFIRM=send AGENT_ID=<id> AGENT_PRIVATE_KEY=${key.slice(0, 6)}… npm run demo`);
    }
  } catch {
    log('');
    log('  (No exportable key for this mode — the agent uses your owner wallet to sign.)');
  }
}

main().catch((err) => {
  console.error('\n✗', err?.shortMessage ?? err?.message ?? err);
  process.exit(1);
});
