/**
 * Self Agent ID — proof-of-human, wired into the autonomous loop.
 *
 * Envoy already proves three things about a payment on-chain:
 *   1. it settled (EnvoyFacilitator `Settled` receipt),
 *   2. under the agent's spending policy (`getLimit`),
 *   3. for an agent that *declares* the capability (ERC-8004 card).
 *
 * Self Agent ID adds the fourth, and the one none of the above can answer:
 *   4. is there a real, sanctions-clean **human** behind this agent?
 *
 * Self answers it in zero-knowledge — the owner scans a passport once in the
 * Self app, a soulbound ERC-721 binds the agent's key to that human proof, and
 * from then on the agent signs every HTTP request with the SAME secp256k1 key it
 * uses to authorize payments. The merchant recovers the signer, looks it up in
 * Self's registry on Celo, and refuses to serve an agent no human stands behind.
 *
 * This module keeps all of that LOCAL to the example — exactly like
 * `facilitator-adapter.ts`. The published `envoy-pay` SDK gains no dependency on
 * `@selfxyz/agent-sdk`; it's a devDependency that only the demo touches.
 *
 * @see https://docs.self.xyz/self-agent-id/overview
 */
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import {
  SelfAgent,
  SelfAgentVerifier,
  HEADERS,
  type VerificationResult,
} from '@selfxyz/agent-sdk';
import { CELO_MAINNET } from '../../src';

/** Self uses two network names; map Envoy's Celo chain id onto them. */
export type SelfNetwork = 'mainnet' | 'testnet';
export function networkForChain(chainId: number): SelfNetwork {
  return chainId === CELO_MAINNET ? 'mainnet' : 'testnet';
}

export interface HumanProofOptions {
  /** Celo chain id (42220 → Self mainnet, anything else → Self testnet). */
  chainId: number;
  /** Require the agent's human to have passed OFAC screening. Default: false. */
  requireOFAC?: boolean;
  /** Require the agent's human to be at least this age (e.g. 18). Default: off. */
  minimumAge?: number;
  /** Override the RPC the verifier reads Self's registry through. */
  rpcUrl?: string;
}

/**
 * Build the service-side verifier the merchant uses to check proof-of-human.
 *
 * Reads Self's own registry on Celo (NOT Envoy's ERC-8004 registry) — the two
 * are distinct on-chain registries that happen to share the same agent key.
 */
export function createHumanProofVerifier(opts: HumanProofOptions): SelfAgentVerifier {
  let builder = SelfAgentVerifier.create().network(networkForChain(opts.chainId));
  if (opts.rpcUrl) builder = builder.rpc(opts.rpcUrl);
  if (opts.requireOFAC) builder = builder.requireOFAC();
  if (opts.minimumAge) builder = builder.requireAge(opts.minimumAge);
  return builder.build();
}

/** The raw shape the merchant hands us — just enough of a Node request. */
export interface SignedRequestParts {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Verify a single signed request against Self's registry.
 *
 * The agent's identity is RECOVERED from the signature, never trusted from a
 * header — you can't claim to be an agent without holding its private key.
 */
export async function verifyHumanProof(
  verifier: SelfAgentVerifier,
  req: SignedRequestParts,
): Promise<VerificationResult> {
  const h = (name: string): string | undefined => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return verifier.verify({
    signature: h(HEADERS.SIGNATURE) ?? '',
    timestamp: h(HEADERS.TIMESTAMP) ?? '',
    method: req.method,
    url: req.url,
    body: req.body || undefined,
    keytype: h(HEADERS.KEYTYPE),
    agentKey: h(HEADERS.KEY),
  });
}

/**
 * Make the agent sign every outbound request with its Self key.
 *
 * Attaches an Axios request interceptor to `EnvoyClient.api` (public). On each
 * request — including the post-payment retry — it serializes the body ONCE,
 * sets it as the data actually sent (so the signed bytes equal the received
 * bytes), and merges Self's `x-self-agent-*` headers in. The published SDK is
 * untouched; this is pure example glue.
 */
export function attachHumanProofSigning(api: AxiosInstance, agent: SelfAgent): void {
  api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    // Serialize the body deterministically and idempotently. On the retry the
    // config object is reused and `data` is already the string — don't re-encode.
    const raw = config.data;
    const body = raw == null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw);
    config.data = body;

    const method = (config.method ?? 'post').toUpperCase();
    // Self canonicalizes to path+query; the merchant verifies against req.url
    // (the path), so signing the path here makes the two sides agree.
    const url = config.url ?? '/';

    const selfHeaders = await agent.signRequest(method, url, body || undefined);
    for (const [k, v] of Object.entries(selfHeaders)) {
      config.headers.set(k, v);
    }
    // Body is a pre-serialized JSON string; say so for honest content negotiation.
    if (body) config.headers.set('content-type', 'application/json');
    return config;
  });
}
