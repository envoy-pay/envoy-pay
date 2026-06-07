/**
 * On-chain settlement verification for x402 gates.
 *
 * `createX402Gate`'s default does NOT confirm a payment settled on-chain — it
 * only checks that the `X-PAYMENT` header is well-formed and self-consistent.
 * That's fine for a demo, but unsafe for real value: a client could present a
 * fabricated proof and be served for free. This helper closes that gap.
 *
 * It returns a `verifyPayment` function you pass straight into `createX402Gate`,
 * which, given the proof a paying agent presents:
 *
 *   1. pulls the transaction the proof references (tolerating brief RPC lag),
 *   2. confirms it succeeded and emitted the deployed `EnvoyFacilitator`'s
 *      `Settled` event,
 *   3. checks it paid THIS merchant, in the expected token, for at least the
 *      asking amount,
 *   4. replay-guards it — a `challengeId` is redeemable exactly once,
 *   5. (optionally) reads the paying agent's ERC-8004 card and requires it to
 *      declare a given capability.
 *
 * This is the same verification the autonomous-loop example performs, lifted
 * into the SDK so production gates don't have to re-implement it.
 *
 * @example
 * ```ts
 * import { createX402Gate, createOnchainVerifier } from 'envoy-pay/server';
 * import { CELO_MAINNET } from 'envoy-pay';
 *
 * const verifyPayment = createOnchainVerifier({
 *   chainId: CELO_MAINNET,
 *   payTo: '0xYourTreasury',
 *   token: '0x765DE816845861e75A25fCA122bb6898B8B1282a', // cUSD on Celo
 *   minAmount: 500000000000000000n,                       // 0.5 cUSD (18 decimals)
 *   rpcUrl: process.env.CELO_RPC_URL,                     // or pass a viem publicClient
 * });
 *
 * app.post('/api/premium', createX402Gate({
 *   payTo: '0xYourTreasury',
 *   amount: '500000000000000000',
 *   asset: 'cUSD',
 *   network: 'eip155:42220',
 *   verifyPayment,
 * }), handler);
 * ```
 */

import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http as viemHttp,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { getEnvoyAddresses, ENVOY_FACILITATOR_ABI } from '../contracts';
import { erc8004 } from '../identity';
import { type Logger, noopLogger } from '../logger';
import type { X402Proof } from './x402-gate';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * A redeemed-receipt store. A `challengeId` is honored exactly once. The default
 * is an in-process `Set` — fine for a single instance, but NOT safe across a
 * horizontally-scaled deployment, where two nodes could each redeem the same
 * receipt. Pass a shared (e.g. Redis-backed) implementation in production.
 */
export interface ReplayStore {
  has(challengeId: string): boolean | Promise<boolean>;
  add(challengeId: string): void | Promise<void>;
}

export interface OnchainVerifierConfig {
  /** EIP-155 chain id the payment settles on (e.g. 42220 — Celo Mainnet). */
  chainId: number;
  /** Merchant wallet that must be the `merchant` in the `Settled` event. */
  payTo: Address;
  /** Token the payment must be denominated in (e.g. cUSD on Celo). */
  token: Address;
  /** Minimum settled amount required to pass, in the token's smallest unit. */
  minAmount: bigint;
  /** A viem `PublicClient` for reads. Provide this OR `rpcUrl`. */
  publicClient?: PublicClient;
  /** RPC URL used to build a read-only client when `publicClient` is omitted. */
  rpcUrl?: string;
  /** `EnvoyFacilitator` address. Defaults to the deployed one for `chainId`. */
  facilitator?: Address;
  /**
   * Optional ERC-8004 capability the paying agent's on-chain card must declare.
   * When set, the agent's card is read and the request is rejected if it's absent.
   */
  requiredCapability?: string;
  /** ERC-8004 Identity registry, for the capability read. Defaults to deployed. */
  identityRegistry?: Address;
  /** Replay store. Defaults to an in-process `Set` (see {@link ReplayStore}). */
  seen?: ReplayStore;
  /** Receipt-fetch retries, to tolerate RPC propagation lag. Default 5. */
  receiptRetries?: number;
  /** Delay between receipt retries, in ms. Default 2000. */
  receiptRetryDelayMs?: number;
  /** Optional logger. Surfaces the reason a payment was rejected. */
  logger?: Logger;
}

function memoryStore(): ReplayStore {
  const set = new Set<string>();
  return { has: (id) => set.has(id), add: (id) => void set.add(id) };
}

/**
 * Build a `verifyPayment` function that confirms an x402 proof corresponds to a
 * real `EnvoyFacilitator` settlement on-chain. Pass the result to
 * `createX402Gate({ verifyPayment })`.
 */
export function createOnchainVerifier(
  config: OnchainVerifierConfig,
): (proof: X402Proof) => Promise<boolean> {
  const log = config.logger ?? noopLogger;
  const deployed = getEnvoyAddresses(config.chainId);
  const facilitator = getAddress(config.facilitator ?? deployed.facilitator);
  const identityRegistry = getAddress(config.identityRegistry ?? deployed.identityRegistry);
  const token = getAddress(config.token);
  const payTo = getAddress(config.payTo);
  const tries = config.receiptRetries ?? 5;
  const delayMs = config.receiptRetryDelayMs ?? 2000;
  const seen = config.seen ?? memoryStore();

  if (facilitator === getAddress(ZERO_ADDRESS)) {
    throw new Error(
      `createOnchainVerifier: no EnvoyFacilitator is deployed for chainId ${config.chainId} ` +
        `(the facilitator is currently Celo Mainnet only). Pass an explicit \`facilitator\` if you have one.`,
    );
  }

  const client = resolveClient(config);

  return async function verifyPayment(proof: X402Proof): Promise<boolean> {
    const reject = (why: string): false => {
      log(`[verify-onchain] ✗ payment rejected — ${why}`);
      return false;
    };

    const txHash = proof?.payload?.transaction as Hex | undefined;
    if (!txHash) return reject('proof has no payload.transaction (tx hash)');

    const receipt = await receiptWithRetry(client, txHash, tries, delayMs);
    if (!receipt) return reject(`tx ${txHash} not found on chain ${config.chainId}`);
    if (receipt.status !== 'success') return reject(`tx ${txHash} reverted`);

    const settled = decodeSettled(receipt.logs, facilitator);
    if (!settled) return reject(`no EnvoyFacilitator Settled event in ${txHash}`);

    if (getAddress(settled.merchant) !== payTo) {
      return reject(`paid the wrong merchant (${settled.merchant}, expected ${payTo})`);
    }
    if (getAddress(settled.token) !== token) {
      return reject(`paid in the wrong token (${settled.token}, expected ${token})`);
    }
    if (settled.amount < config.minAmount) {
      return reject(`underpaid (${settled.amount} < ${config.minAmount})`);
    }
    if (await seen.has(settled.challengeId)) {
      return reject(`receipt already redeemed (challengeId ${settled.challengeId})`);
    }

    if (config.requiredCapability) {
      const caps = await readCapabilities(client, identityRegistry, settled.agentId);
      if (!caps.includes(config.requiredCapability.toLowerCase())) {
        return reject(
          `agent #${settled.agentId} does not declare capability "${config.requiredCapability}" ` +
            `(card lists: ${caps.length ? caps.join(', ') : 'none'})`,
        );
      }
    }

    await seen.add(settled.challengeId);
    log(
      `[verify-onchain] ✓ agent #${settled.agentId} settled ${settled.amount} to ${payTo} (tx ${txHash})`,
    );
    return true;
  };
}

function resolveClient(config: OnchainVerifierConfig): PublicClient {
  if (config.publicClient) return config.publicClient;
  if (config.rpcUrl) {
    return createPublicClient({ transport: viemHttp(config.rpcUrl) }) as PublicClient;
  }
  throw new Error('createOnchainVerifier: pass either a `publicClient` or an `rpcUrl`.');
}

interface DecodedSettled {
  challengeId: string;
  agentId: bigint;
  merchant: Address;
  token: Address;
  amount: bigint;
}

/** Find + decode the `EnvoyFacilitator` `Settled` event among a receipt's logs. */
function decodeSettled(
  logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[],
  facilitator: Address,
): DecodedSettled | null {
  for (const lg of logs) {
    if (getAddress(lg.address) !== facilitator) continue;
    try {
      const decoded = decodeEventLog({
        abi: ENVOY_FACILITATOR_ABI,
        data: lg.data,
        topics: lg.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === 'Settled') {
        const a = decoded.args as unknown as {
          challengeId: Hex;
          agentId: bigint;
          merchant: Address;
          token: Address;
          amount: bigint;
        };
        return {
          challengeId: a.challengeId,
          agentId: a.agentId,
          merchant: a.merchant,
          token: a.token,
          amount: a.amount,
        };
      }
    } catch {
      /* not the Settled event — keep scanning */
    }
  }
  return null;
}

/** Fetch a receipt, tolerating brief RPC propagation lag. Null if never seen. */
async function receiptWithRetry(
  client: PublicClient,
  hash: Hex,
  tries: number,
  delayMs: number,
): Promise<TransactionReceipt | null> {
  for (let i = 0; i < tries; i++) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch {
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

/** Read an agent's declared capabilities from its on-chain ERC-8004 card. */
async function readCapabilities(
  client: PublicClient,
  registry: Address,
  agentId: bigint,
): Promise<string[]> {
  try {
    const { tokenURI } = await erc8004.getAgent(client, registry, agentId);
    if (!tokenURI || !tokenURI.startsWith('data:')) return [];
    const comma = tokenURI.indexOf(',');
    const meta = tokenURI.slice(5, comma);
    const payload = tokenURI.slice(comma + 1);
    const json = /;base64/i.test(meta)
      ? Buffer.from(payload, 'base64').toString('utf-8')
      : decodeURIComponent(payload);
    const card = JSON.parse(json);
    return Array.isArray(card?.capabilities)
      ? card.capabilities
          .filter((c: unknown): c is string => typeof c === 'string')
          .map((c: string) => c.toLowerCase())
      : [];
  } catch {
    return [];
  }
}
