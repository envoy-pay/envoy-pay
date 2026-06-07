/**
 * Tests for createOnchainVerifier — the production verifyPayment helper that
 * confirms an x402 proof maps to a real EnvoyFacilitator `Settled` event.
 *
 * We craft a genuine ABI-encoded Settled log and mock only the RPC client, so
 * the verifier's real decode + checks run against real bytes.
 */

import {
  encodeEventTopics,
  encodeAbiParameters,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { createOnchainVerifier } from '../server/verify-onchain';
import { ENVOY_FACILITATOR_ABI } from '../contracts/abis/EnvoyFacilitator';
import { getEnvoyAddresses, CELO_MAINNET, CELO_SEPOLIA } from '../contracts';
import type { X402Proof } from '../server/x402-gate';

const { facilitator } = getEnvoyAddresses(CELO_MAINNET);
const MERCHANT = getAddress('0x1111111111111111111111111111111111111111');
const TOKEN = getAddress('0x2222222222222222222222222222222222222222');
const SIGNER = getAddress('0x3333333333333333333333333333333333333333');
const CHALLENGE = `0x${'ab'.repeat(32)}` as Hex;
const TX = `0x${'cd'.repeat(32)}` as Hex;

/** Build a real, ABI-encoded EnvoyFacilitator `Settled` log. */
function settledLog(over: Partial<{
  challengeId: Hex;
  agentId: bigint;
  merchant: Address;
  token: Address;
  amount: bigint;
}> = {}) {
  const args = {
    challengeId: CHALLENGE,
    agentId: 7n,
    merchant: MERCHANT,
    token: TOKEN,
    amount: 1000n,
    ...over,
  };
  const topics = encodeEventTopics({
    abi: ENVOY_FACILITATOR_ABI,
    eventName: 'Settled',
    args: { challengeId: args.challengeId, agentId: args.agentId, merchant: args.merchant },
  });
  const data = encodeAbiParameters(
    [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'signer', type: 'address' },
    ],
    [args.token, args.amount, 0n, 0n, SIGNER],
  );
  return { address: facilitator, data, topics };
}

const okReceipt = () => ({ status: 'success', blockNumber: 1n, logs: [settledLog()] });

/** Minimal PublicClient mock — only what the verifier touches. */
function client(receipt: any) {
  return {
    getTransactionReceipt: async () => {
      if (!receipt) throw new Error('not found');
      return receipt;
    },
  } as any;
}

const proof = (tx: Hex | undefined = TX): X402Proof => ({
  x402Version: 2,
  accepted: { scheme: 'exact', network: 'eip155:42220', amount: '0', payTo: MERCHANT, asset: 'cUSD' },
  payload: { transaction: tx as string, chain: 'eip155:42220' },
});

const base = () => ({
  chainId: CELO_MAINNET,
  payTo: MERCHANT,
  token: TOKEN,
  minAmount: 1000n,
  publicClient: client(okReceipt()),
});

describe('createOnchainVerifier', () => {
  it('accepts a valid on-chain settlement', async () => {
    const verify = createOnchainVerifier(base());
    expect(await verify(proof())).toBe(true);
  });

  it('rejects a proof with no transaction hash', async () => {
    const verify = createOnchainVerifier(base());
    const p = proof();
    (p.payload as any).transaction = undefined;
    expect(await verify(p)).toBe(false);
  });

  it('rejects when the transaction is not found', async () => {
    const verify = createOnchainVerifier({
      ...base(),
      publicClient: client(null),
      receiptRetries: 1,
      receiptRetryDelayMs: 0,
    });
    expect(await verify(proof())).toBe(false);
  });

  it('rejects a reverted transaction', async () => {
    const verify = createOnchainVerifier({
      ...base(),
      publicClient: client({ ...okReceipt(), status: 'reverted' }),
    });
    expect(await verify(proof())).toBe(false);
  });

  it('rejects when there is no Settled event', async () => {
    const verify = createOnchainVerifier({
      ...base(),
      publicClient: client({ status: 'success', blockNumber: 1n, logs: [] }),
    });
    expect(await verify(proof())).toBe(false);
  });

  it('rejects payment to the wrong merchant', async () => {
    const verify = createOnchainVerifier({
      ...base(),
      publicClient: client({ status: 'success', blockNumber: 1n, logs: [settledLog({ merchant: TOKEN })] }),
    });
    expect(await verify(proof())).toBe(false);
  });

  it('rejects payment in the wrong token', async () => {
    const verify = createOnchainVerifier({
      ...base(),
      publicClient: client({ status: 'success', blockNumber: 1n, logs: [settledLog({ token: MERCHANT })] }),
    });
    expect(await verify(proof())).toBe(false);
  });

  it('rejects underpayment', async () => {
    const verify = createOnchainVerifier({ ...base(), minAmount: 5000n });
    expect(await verify(proof())).toBe(false);
  });

  it('replay-guards a redeemed challengeId', async () => {
    const verify = createOnchainVerifier(base());
    expect(await verify(proof())).toBe(true);
    expect(await verify(proof())).toBe(false);
  });

  it('throws when no facilitator is deployed for the chain', () => {
    // Celo Sepolia ships a ZERO facilitator address (mainnet-only contract).
    expect(() =>
      createOnchainVerifier({ ...base(), chainId: CELO_SEPOLIA }),
    ).toThrow();
  });

  it('requires a publicClient or rpcUrl', () => {
    expect(() =>
      createOnchainVerifier({ chainId: CELO_MAINNET, payTo: MERCHANT, token: TOKEN, minAmount: 1n }),
    ).toThrow();
  });

  it('enforces requiredCapability from the on-chain ERC-8004 card', async () => {
    const cap = 'x402-payments';
    const dataUri = `data:application/json,${encodeURIComponent(JSON.stringify({ capabilities: [cap] }))}`;
    const capClient = {
      getTransactionReceipt: async () => okReceipt(),
      // erc8004.getAgent reads ownerOf / agentWallet / tokenURI; return the card
      // for the URI read and an address for the rest.
      readContract: async ({ functionName }: any) =>
        String(functionName).toLowerCase().includes('uri') ? dataUri : MERCHANT,
    } as any;

    const ok = createOnchainVerifier({ ...base(), publicClient: capClient, requiredCapability: cap });
    expect(await ok(proof())).toBe(true);

    const missing = createOnchainVerifier({
      ...base(),
      publicClient: capClient,
      requiredCapability: 'unlisted-capability',
    });
    expect(await missing(proof())).toBe(false);
  });
});
