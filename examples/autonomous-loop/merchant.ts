/**
 * A paid service an agent can hire — the other end of the autonomous loop.
 *
 * It gates a "premium market report" behind HTTP 402 using envoy's own
 * `createX402Gate`. What makes it real (not the loose default) is `verifyPayment`:
 * it doesn't trust the proof, it VERIFIES it on-chain —
 *
 *   1. pull the tx the agent claims to have paid,
 *   2. decode the `Settled` event emitted by the deployed EnvoyFacilitator,
 *   3. confirm it paid THIS merchant, in cUSD, for at least the asking price,
 *   4. replay-guard it (a challengeId is spendable once),
 *   5. read the paying agent's ERC-8004 card and require it to DECLARE the
 *      capability this resource needs — the first thing in the whole product
 *      that actually consumes `capabilities`.
 *
 * Only then does it serve the data. This is what an x402 merchant verifying an
 * Envoy settlement looks like end-to-end.
 */
import http from 'http';
import {
  createPublicClient,
  http as viemHttp,
  decodeEventLog,
  formatUnits,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import {
  createX402Gate,
  getEnvoyAddresses,
  erc8004,
  ENVOY_FACILITATOR_ABI,
  CELO_MAINNET,
  type X402Proof,
} from '../../src';
import { CUSD } from './facilitator-adapter';

const CUSD_DECIMALS = 18;

export interface MerchantOptions {
  /** Address that receives the net payment (the merchant's wallet). */
  payTo: Address;
  /** Price in atomic cUSD (18 decimals). */
  amount: bigint;
  /** Capability the paying agent's ERC-8004 card MUST declare to be served. */
  requiredCapability: string;
  /** Celo chain id. Default 42220 (Mainnet). */
  chainId?: number;
  /** Optional custom RPC. */
  rpcUrl?: string;
  /** Optional logger. */
  logger?: (msg: string) => void;
}

export interface RunningMerchant {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Start the 402-gated merchant on an ephemeral port. */
export function startMerchant(opts: MerchantOptions): Promise<RunningMerchant> {
  const log = opts.logger ?? (() => {});
  const chainId = opts.chainId ?? CELO_MAINNET;
  const chain = chainId === CELO_MAINNET ? celo : celoSepolia;
  const transport = opts.rpcUrl ? viemHttp(opts.rpcUrl) : viemHttp();
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const { facilitator, identityRegistry } = getEnvoyAddresses(chainId);

  // A challengeId is spendable exactly once — guards against a replayed receipt.
  const spent = new Set<string>();

  const gate = createX402Gate({
    payTo: opts.payTo,
    amount: opts.amount.toString(),
    asset: 'cUSD',
    network: `eip155:${chainId}`,
    description: 'Premium market report — settle in cUSD on Celo via EnvoyFacilitator.',
    usdAmount: Number(formatUnits(opts.amount, CUSD_DECIMALS)),
    logger: log,
    // ── The real verification: an on-chain Settled receipt, not a bare claim ──
    verifyPayment: async (proof: X402Proof): Promise<boolean> => {
      const txHash = proof.payload?.transaction as Hex | undefined;
      if (!txHash) return reject('no tx hash in proof');

      // Tolerate brief RPC propagation lag: a legit tx the agent just mined may
      // not be visible on the merchant's node for a beat. A truly-missing tx
      // exhausts the budget and is then rejected.
      const receipt = await receiptWithRetry(publicClient, txHash);
      if (!receipt) return reject(`tx ${txHash} not found on ${chain.name}`);
      if (receipt.status !== 'success') return reject(`tx ${txHash} reverted`);

      // Find + decode the facilitator's Settled event in this tx.
      const settled = decodeSettled(receipt.logs, facilitator);
      if (!settled) return reject(`no EnvoyFacilitator Settled event in ${txHash}`);

      // It must have paid THIS merchant, in cUSD, for at least the asking price.
      if (getAddress(settled.merchant) !== getAddress(opts.payTo)) {
        return reject(`paid the wrong merchant (${settled.merchant})`);
      }
      if (getAddress(settled.token) !== getAddress(CUSD)) {
        return reject(`paid in the wrong token (${settled.token})`);
      }
      if (settled.amount < opts.amount) {
        return reject(`underpaid: ${formatUnits(settled.amount, CUSD_DECIMALS)} < ${formatUnits(opts.amount, CUSD_DECIMALS)} cUSD`);
      }

      // Replay guard — a receipt is good for one purchase.
      if (spent.has(settled.challengeId)) return reject(`receipt already redeemed`);

      // Capability gate — read the paying agent's on-chain card and require the
      // capability this resource needs. THIS is what gives `capabilities` a job.
      const caps = await readCapabilities(publicClient, identityRegistry, settled.agentId);
      if (!caps.includes(opts.requiredCapability.toLowerCase())) {
        return reject(
          `agent #${settled.agentId} doesn't declare "${opts.requiredCapability}" ` +
            `(card lists: ${caps.length ? caps.join(', ') : 'none'})`,
        );
      }

      spent.add(settled.challengeId);
      log(
        `[merchant] ✓ verified on-chain · agent #${settled.agentId} paid ` +
          `${formatUnits(settled.amount, CUSD_DECIMALS)} cUSD · declares "${opts.requiredCapability}" · serving resource`,
      );
      return true;

      function reject(why: string): false {
        log(`[merchant] ✗ payment rejected — ${why}`);
        return false;
      }
    },
  });

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url && req.url.startsWith('/premium')) {
      // Drain the request body (the gate only needs headers) then run the gate.
      req.on('data', () => {});
      req.on('end', () => {
        gate(req as any, res, () => serveResource(res));
      });
      req.on('error', () => endJson(res, 400, { error: 'bad request' }));
      return;
    }
    endJson(res, 404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      log(`[merchant] listening on http://127.0.0.1:${port} · price ${formatUnits(opts.amount, CUSD_DECIMALS)} cUSD · needs "${opts.requiredCapability}"`);
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () =>
          new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
      });
    });
  });
}

/** The "premium" payload — only served after a verified on-chain settlement. */
function serveResource(res: http.ServerResponse) {
  endJson(res, 200, {
    report: 'CELO/USD 24h',
    asOf: new Date().toISOString(),
    signal: 'neutral',
    note: 'You are reading paid data because an autonomous agent settled for it on-chain.',
  });
}

interface DecodedSettled {
  challengeId: string;
  agentId: bigint;
  merchant: Address;
  token: Address;
  amount: bigint;
  fee: bigint;
}

/** Find + decode the EnvoyFacilitator `Settled` event among a tx's logs. */
function decodeSettled(logs: readonly { address: string; data: Hex; topics: Hex[] }[], facilitator: Address): DecodedSettled | null {
  for (const lg of logs) {
    if (getAddress(lg.address) !== getAddress(facilitator)) continue;
    try {
      const d = decodeEventLog({ abi: ENVOY_FACILITATOR_ABI, data: lg.data, topics: lg.topics as any });
      if (d.eventName === 'Settled') {
        const a = d.args as any;
        return {
          challengeId: a.challengeId as string,
          agentId: a.agentId as bigint,
          merchant: a.merchant as Address,
          token: a.token as Address,
          amount: a.amount as bigint,
          fee: a.fee as bigint,
        };
      }
    } catch {
      /* not the Settled event */
    }
  }
  return null;
}

/** Fetch a receipt, tolerating brief RPC propagation lag. Returns null if the tx
 *  never shows up within the budget (legit txs resolve on the first or second try). */
async function receiptWithRetry(client: PublicClient, hash: Hex, tries = 5, delayMs = 2000) {
  for (let i = 0; i < tries; i++) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch {
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

/** Read an agent's capabilities from its on-chain ERC-8004 card (a data: URI). */
async function readCapabilities(client: PublicClient, registry: Address, agentId: bigint): Promise<string[]> {
  const { tokenURI } = await erc8004.getAgent(client, registry, agentId);
  if (!tokenURI || !tokenURI.startsWith('data:')) return [];
  try {
    const comma = tokenURI.indexOf(',');
    const meta = tokenURI.slice(5, comma);
    const payload = tokenURI.slice(comma + 1);
    const json = /;base64/i.test(meta)
      ? Buffer.from(payload, 'base64').toString('utf-8')
      : decodeURIComponent(payload);
    const card = JSON.parse(json);
    return Array.isArray(card?.capabilities)
      ? card.capabilities.filter((c: unknown) => typeof c === 'string').map((c: string) => c.toLowerCase())
      : [];
  } catch {
    return [];
  }
}

function endJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
