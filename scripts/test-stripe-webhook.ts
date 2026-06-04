/**
 * End-to-end verification of the Stripe → cUSD settlement webhook
 * (web/app/api/stripe/webhook/route.ts). Exercises the full path the way Stripe
 * does: a signed `checkout.session.completed` event over HTTP.
 *
 * Safe checks run by default (no funds move):
 *   - GET readiness probe (config + treasury balances if AGENT_RUNTIME_SECRET set)
 *   - bad signature            → expect 400
 *   - stale timestamp (replay) → expect 400
 *
 * The live settlement (a REAL cUSD transfer to AGENT_WALLET) and its idempotent
 * replay run only with CONFIRM=send.
 *
 * Env (STRIPE_WEBHOOK_SECRET / AGENT_RUNTIME_SECRET auto-read from web/.env.local):
 *   WEBHOOK_URL=http://localhost:3000/api/stripe/webhook   target (default local)
 *   STRIPE_WEBHOOK_SECRET=whsec_...   signing secret (must match the server's)
 *   AGENT_WALLET=0x...                settlement recipient (required for live test)
 *   AMOUNT=0.01   ASSET=cUSD   CHAIN=sepolia|mainnet   (defaults: 0.01 cUSD mainnet)
 *   AGENT_RUNTIME_SECRET=...          unlocks treasury detail in the GET probe
 *
 *   npx ts-node --transpile-only scripts/test-stripe-webhook.ts                 # safe checks
 *   CONFIRM=send AGENT_WALLET=0x.. npx ts-node --transpile-only scripts/test-stripe-webhook.ts
 */
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEBHOOK_URL =
  process.env.WEBHOOK_URL ?? "http://localhost:3000/api/stripe/webhook";
const CHAIN_ID = process.env.CHAIN === "sepolia" ? 11142220 : 42220;
const AMOUNT = process.env.AMOUNT ?? "0.01";
const ASSET = process.env.ASSET ?? "cUSD";
const CONFIRM = process.env.CONFIRM === "send";

// Convenience: pull secrets from web/.env.local when not already in the shell.
loadEnvLocal(["STRIPE_WEBHOOK_SECRET", "AGENT_RUNTIME_SECRET"]);
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const RUNTIME_SECRET = process.env.AGENT_RUNTIME_SECRET;

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function signHeader(payload: string, secret: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

function buildEvent(sessionId: string) {
  return JSON.stringify({
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        metadata: {
          agentWallet: process.env.AGENT_WALLET ?? "",
          agentId: "test",
          asset: ASSET,
          amount: AMOUNT,
          chainId: String(CHAIN_ID),
        },
      },
    },
  });
}

async function post(payload: string, sig: string) {
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": sig },
    body: payload,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function now() {
  return Math.floor(Date.now() / 1000);
}

async function main() {
  console.log(`Stripe webhook · ${WEBHOOK_URL}`);
  console.log(`  chain:  ${CHAIN_ID}   asset: ${ASSET}   amount: ${AMOUNT}`);
  console.log(`  mode:   ${CONFIRM ? "LIVE — will trigger a REAL cUSD transfer" : "SAFE — no funds move (set CONFIRM=send for the live test)"}`);

  // ── 1. Readiness probe (GET) ────────────────────────────────────────────────
  console.log("\nReadiness");
  const probe = await fetch(WEBHOOK_URL, {
    headers: RUNTIME_SECRET ? { authorization: `Bearer ${RUNTIME_SECRET}` } : {},
  });
  const cfg = (await probe.json().catch(() => ({}))) as any;
  check("GET reachable", probe.ok, `HTTP ${probe.status}`);
  check("STRIPE_WEBHOOK_SECRET set on server", cfg.stripeWebhookSecret === true);
  check("TREASURY_PRIVATE_KEY set on server", cfg.treasuryKey === true);
  console.log(
    `    idempotency: ${cfg.idempotency?.backend} (durable=${cfg.idempotency?.durable})` +
      (cfg.idempotency?.durable === false
        ? "  ⚠ in-memory — set KV_REST_API_URL/KV_REST_API_TOKEN for production"
        : ""),
  );
  if (cfg.treasury) {
    console.log(`    treasury: ${cfg.treasury.address}`);
    console.log(`              ${cfg.treasury.celo} CELO · ${cfg.treasury.cUSD} cUSD · readyToSettle=${cfg.treasury.readyToSettle}`);
    check("treasury funded (gas + cUSD)", cfg.treasury.readyToSettle === true);
  } else if (RUNTIME_SECRET) {
    console.log("    treasury: (no detail returned — unauthorized or read failed)");
  } else {
    console.log("    treasury: (set AGENT_RUNTIME_SECRET to see address + balances)");
  }

  if (cfg.ok !== true) {
    // Server can't settle — confirm it fails closed, then stop.
    console.log("\nServer reports settlement NOT configured. Verifying it fails closed:");
    const { status } = await post(buildEvent("cs_unconfigured"), signHeader("{}", "x", now()));
    check("unconfigured webhook returns 503", status === 503, `got ${status}`);
    console.log("\nSet STRIPE_WEBHOOK_SECRET + TREASURY_PRIVATE_KEY (web/.env.local) and re-run.");
    return finish();
  }

  // ── 2. Bad signature → 400 (needs no secret) ────────────────────────────────
  console.log("\nSignature verification");
  {
    const payload = buildEvent("cs_badsig");
    const bad = await post(payload, `t=${now()},v1=deadbeef`);
    check("bad signature rejected", bad.status === 400, `got ${bad.status} ${JSON.stringify(bad.json)}`);
  }

  if (!SECRET) {
    console.log("\n⚠ STRIPE_WEBHOOK_SECRET not available to this script — skipping the");
    console.log("  stale-timestamp and live-settlement tests (they require signing).");
    return finish();
  }

  // ── 3. Stale timestamp → 400 (valid v1, but outside the 5-min replay window) ─
  {
    const payload = buildEvent("cs_stale");
    const stale = await post(payload, signHeader(payload, SECRET, now() - 600));
    check("stale timestamp rejected (replay window)", stale.status === 400, `got ${stale.status}`);
  }

  // ── 4. Live settlement + idempotent replay (CONFIRM=send only) ──────────────
  if (!CONFIRM) {
    console.log("\nLive settlement: SKIPPED (set CONFIRM=send + AGENT_WALLET to run).");
    return finish();
  }
  if (!process.env.AGENT_WALLET) {
    check("AGENT_WALLET provided for live test", false, "set AGENT_WALLET=0x…");
    return finish();
  }

  console.log("\nLive settlement");
  const sessionId = `cs_test_${randomBytes(8).toString("hex")}`;
  const payload = buildEvent(sessionId);
  const t = now();
  const sig = signHeader(payload, SECRET, t);

  const first = await post(payload, sig);
  const txHash = first.json.txHash as string | undefined;
  check(
    "valid event settles on-chain",
    first.status === 200 && first.json.settled === true && Boolean(txHash),
    txHash ? `tx ${txHash}` : JSON.stringify(first.json),
  );
  if (first.json.explorerTx) console.log(`    ${first.json.explorerTx}`);

  // Replay the EXACT same signed event — must dedupe, not double-pay.
  const replay = await post(payload, sig);
  check(
    "replay deduped (no double-settle)",
    replay.json.deduped === true && (replay.json.txHash === txHash || !txHash),
    JSON.stringify(replay.json),
  );

  return finish();
}

function finish() {
  if (failures === 0) {
    console.log("\n✔ All run checks passed.");
  } else {
    console.log(`\n✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
}

/** Minimal .env.local reader — no dependency. Only fills vars that are unset. */
function loadEnvLocal(keys: string[]) {
  if (keys.every((k) => process.env[k])) return;
  try {
    const text = readFileSync(join(__dirname, "..", "web", ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (keys.includes(k) && !process.env[k]) {
        process.env[k] = raw.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no web/.env.local — rely on the shell env */
  }
}

main().catch((err) => {
  console.error("\n✗", err?.message ?? err);
  process.exit(1);
});
