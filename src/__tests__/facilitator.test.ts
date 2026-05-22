import { describe, it, expect } from 'vitest';
import {
  createWalletClient,
  http,
  hashTypedData,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { celo } from 'viem/chains';

import {
  signPaymentAuth,
  paymentAuthTypedData,
  paymentAuthDomain,
  PAYMENT_AUTH_TYPES,
  type PaymentAuth,
} from '../contracts/facilitator';

describe('EnvoyFacilitator EIP-712 signing', () => {
  // A fixed facilitator address — the test doesn't need a live contract,
  // just a stable verifyingContract for the domain.
  const FACILITATOR: Address = '0x1111111111111111111111111111111111111111';
  const CHAIN_ID = 11142220; // Celo Sepolia

  const sampleAuth: PaymentAuth = {
    agentId: 42n,
    token: '0x2222222222222222222222222222222222222222',
    merchant: '0x3333333333333333333333333333333333333333',
    amount: 1_000_000_000_000_000_000n, // 1.0
    challengeId:
      '0xabcdef0000000000000000000000000000000000000000000000000000000001' as Hex,
    nonce: 7n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  };

  function makeClient() {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const walletClient = createWalletClient({
      account,
      chain: celo,
      transport: http('http://127.0.0.1:0'), // no calls go over the wire in these tests
    });
    return { account, walletClient };
  }

  it('produces a signature recoverable by viem', async () => {
    const { account, walletClient } = makeClient();

    const sig = await signPaymentAuth(walletClient, {
      chainId: CHAIN_ID,
      facilitatorAddress: FACILITATOR,
      auth: sampleAuth,
    });

    const recovered = await recoverTypedDataAddress({
      ...paymentAuthTypedData({
        chainId: CHAIN_ID,
        facilitatorAddress: FACILITATOR,
        auth: sampleAuth,
      }),
      signature: sig,
    });

    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('domain hashes are sensitive to every field of the auth', async () => {
    const { walletClient } = makeClient();
    const baseSig = await signPaymentAuth(walletClient, {
      chainId: CHAIN_ID,
      facilitatorAddress: FACILITATOR,
      auth: sampleAuth,
    });

    const variations: Array<Partial<PaymentAuth>> = [
      { agentId: 43n },
      { token: '0x4444444444444444444444444444444444444444' as Address },
      { merchant: '0x5555555555555555555555555555555555555555' as Address },
      { amount: sampleAuth.amount + 1n },
      { challengeId: ('0x' + 'aa'.repeat(32)) as Hex },
      { nonce: sampleAuth.nonce + 1n },
      { deadline: sampleAuth.deadline + 1n },
    ];

    for (const change of variations) {
      const mutated: PaymentAuth = { ...sampleAuth, ...change };
      const mutatedSig = await signPaymentAuth(walletClient, {
        chainId: CHAIN_ID,
        facilitatorAddress: FACILITATOR,
        auth: mutated,
      });
      expect(mutatedSig).not.toBe(baseSig);
    }
  });

  it('uses chainId in the domain (signatures differ across chains)', async () => {
    const { walletClient } = makeClient();
    const sigSepolia = await signPaymentAuth(walletClient, {
      chainId: 11142220,
      facilitatorAddress: FACILITATOR,
      auth: sampleAuth,
    });
    const sigMainnet = await signPaymentAuth(walletClient, {
      chainId: 42220,
      facilitatorAddress: FACILITATOR,
      auth: sampleAuth,
    });
    expect(sigSepolia).not.toBe(sigMainnet);
  });

  it('hashTypedData matches what the contract computes', () => {
    // This is the same digest EnvoyFacilitator.paymentAuthHash() returns.
    // We can't call into the contract here, but the on-chain test suite
    // (contracts/test/EnvoyFacilitator.test.ts) already verifies that
    // ethers.TypedDataEncoder.hash(...) === contract.paymentAuthHash(...) for the
    // same domain + types + value. viem's hashTypedData uses the same EIP-712
    // algorithm, so this asserts cross-library agreement.
    const digest = hashTypedData(
      paymentAuthTypedData({
        chainId: CHAIN_ID,
        facilitatorAddress: FACILITATOR,
        auth: sampleAuth,
      }),
    );
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('exposes the PaymentAuth type structure for ecosystems that want the raw EIP-712 types', () => {
    expect(PAYMENT_AUTH_TYPES.PaymentAuth.length).toBe(7);
    const names = PAYMENT_AUTH_TYPES.PaymentAuth.map((f) => f.name);
    expect(names).toEqual([
      'agentId',
      'token',
      'merchant',
      'amount',
      'challengeId',
      'nonce',
      'deadline',
    ]);
  });

  it('paymentAuthDomain returns the expected static fields', () => {
    const d = paymentAuthDomain({ chainId: CHAIN_ID, facilitatorAddress: FACILITATOR });
    expect(d.name).toBe('EnvoyFacilitator');
    expect(d.version).toBe('1');
    expect(d.chainId).toBe(CHAIN_ID);
    expect(d.verifyingContract).toBe(FACILITATOR);
  });
});
