import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseUnits } from 'viem';
import { PayoutRouter } from '../payouts/router';
import { createFacilitatorSettler } from '../payouts/facilitator-settler';
import { StripeCardPayoutProvider } from '../payouts/providers/stripe-card';
import type {
  PayoutProvider,
  PayoutRail,
  PayoutRequest,
  PayoutQuote,
  PayoutReceipt,
  PayoutTarget,
  SettlementProof,
} from '../payouts/types';

// ─── Fake provider (router tests) ───────────────────────────────────

class FakeProvider implements PayoutProvider {
  constructor(
    public readonly id: string,
    public readonly rail: PayoutRail,
    private readonly kind: PayoutTarget['kind'],
    private readonly ttlSeconds = 300,
  ) {}
  supports(t: PayoutTarget): boolean {
    return t.kind === this.kind;
  }
  async quote(req: PayoutRequest): Promise<PayoutQuote> {
    return {
      rail: this.rail,
      provider: this.id,
      request: req,
      cusdAmount: req.amount,
      fee: '0',
      settleTo: '0xFakeSettle',
      quoteRef: `${this.id}-q`,
      expiresAt: Math.floor(Date.now() / 1000) + this.ttlSeconds,
    };
  }
  async settle(quote: PayoutQuote, proof: SettlementProof): Promise<PayoutReceipt> {
    return {
      rail: this.rail,
      provider: this.id,
      status: 'settled',
      reference: proof.txHash,
      detail: { quoteRef: quote.quoteRef },
    };
  }
}

// ─── Mocked Stripe fetch ────────────────────────────────────────────

function queueFetch(responses: Array<{ ok?: boolean; data: unknown }>) {
  let i = 0;
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fn = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.ok ?? true,
      status: r.ok === false ? 400 : 200,
      statusText: 'OK',
      json: async () => r.data,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Router ─────────────────────────────────────────────────────────

describe('PayoutRouter', () => {
  it('routes a target to the first supporting provider', () => {
    const card = new FakeProvider('card-x', 'card', 'card');
    const bill = new FakeProvider('bill-x', 'bill', 'bill');
    const router = new PayoutRouter().register(card).register(bill);

    expect(router.route({ kind: 'card' })).toBe(card);
    expect(router.route({ kind: 'bill', biller: 'kplc', account: '1' })).toBe(bill);
    expect(router.list()).toHaveLength(2);
  });

  it('throws a helpful error when no provider supports the target', () => {
    const router = new PayoutRouter().register(new FakeProvider('card-x', 'card', 'card'));
    expect(() => router.route({ kind: 'giftcard', brand: 'netflix' })).toThrow(/No payout provider/);
  });

  it('providersFor returns all matches', () => {
    const a = new FakeProvider('a', 'card', 'card');
    const b = new FakeProvider('b', 'card', 'card');
    const router = new PayoutRouter().register(a).register(b);
    expect(router.providersFor({ kind: 'card' })).toEqual([a, b]);
  });

  it('quote() delegates to the routed provider', async () => {
    const router = new PayoutRouter().register(new FakeProvider('card-x', 'card', 'card'));
    const quote = await router.quote({ target: { kind: 'card' }, amount: '12.00' });
    expect(quote.provider).toBe('card-x');
    expect(quote.cusdAmount).toBe('12.00');
  });

  it('settle() uses the provider named in the quote', async () => {
    const router = new PayoutRouter().register(new FakeProvider('card-x', 'card', 'card'));
    const quote = await router.quote({ target: { kind: 'card' }, amount: '5' });
    const receipt = await router.settle(quote, { txHash: '0xabc', chainId: 42220 });
    expect(receipt.status).toBe('settled');
    expect(receipt.reference).toBe('0xabc');
  });

  it('settle() throws if the quote names an unregistered provider', async () => {
    const router = new PayoutRouter();
    const orphan: PayoutQuote = {
      rail: 'card',
      provider: 'ghost',
      request: { target: { kind: 'card' }, amount: '1' },
      cusdAmount: '1',
      fee: '0',
      settleTo: '0x0',
      quoteRef: 'q',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };
    await expect(router.settle(orphan, { txHash: '0x1', chainId: 42220 })).rejects.toThrow(/not registered/);
  });

  it('pay() runs quote → settleOnChain → dispatch end-to-end', async () => {
    const router = new PayoutRouter().register(new FakeProvider('card-x', 'card', 'card'));
    const seen: PayoutQuote[] = [];
    const receipt = await router.pay({ target: { kind: 'card' }, amount: '9.20' }, async (q) => {
      seen.push(q);
      return { txHash: '0xdeadbeef', chainId: 42220, agentId: '128' };
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].cusdAmount).toBe('9.20');
    expect(receipt.reference).toBe('0xdeadbeef');
    expect(receipt.status).toBe('settled');
  });

  it('pay() rejects an expired quote before settling', async () => {
    const router = new PayoutRouter().register(new FakeProvider('card-x', 'card', 'card', -10));
    const onChain = vi.fn();
    await expect(
      router.pay({ target: { kind: 'card' }, amount: '1' }, onChain as never),
    ).rejects.toThrow(/expired/);
    expect(onChain).not.toHaveBeenCalled();
  });
});

// ─── StripeCardPayoutProvider ───────────────────────────────────────

describe('StripeCardPayoutProvider', () => {
  const KEY = 'sk_test_abc123';

  it('rejects an empty secret key', () => {
    expect(() => new StripeCardPayoutProvider({ stripeSecretKey: '' })).toThrow(/stripeSecretKey/);
  });

  it('supports card targets only', () => {
    const p = new StripeCardPayoutProvider({ stripeSecretKey: KEY });
    expect(p.supports({ kind: 'card' })).toBe(true);
    expect(p.supports({ kind: 'bill', biller: 'x', account: '1' })).toBe(false);
    expect(p.rail).toBe('card');
    expect(p.id).toBe('stripe-card');
  });

  it('quote() requires a fundingAddress (custodial top-up)', async () => {
    const p = new StripeCardPayoutProvider({ stripeSecretKey: KEY });
    await expect(p.quote({ target: { kind: 'card' }, amount: '10' })).rejects.toThrow(/fundingAddress/);
  });

  it('quote() applies the fee and returns the settle address', async () => {
    const p = new StripeCardPayoutProvider({
      stripeSecretKey: KEY,
      fundingAddress: '0xFund',
      feeBps: 100, // 1%
    });
    const quote = await p.quote({ target: { kind: 'card', cardId: 'ic_1' }, amount: '100' });
    expect(quote.provider).toBe('stripe-card');
    expect(quote.cusdAmount).toBe('101.000000');
    expect(quote.fee).toBe('1.000000');
    expect(quote.settleTo).toBe('0xFund');
    expect(quote.fiat).toEqual({ amount: '100.00', currency: 'usd' });
  });

  it('settle() requires a txHash and returns a receipt', async () => {
    const p = new StripeCardPayoutProvider({ stripeSecretKey: KEY, fundingAddress: '0xFund' });
    const quote = await p.quote({ target: { kind: 'card' }, amount: '10' });
    await expect(p.settle(quote, { txHash: '', chainId: 42220 })).rejects.toThrow(/txHash/);
    const receipt = await p.settle(quote, { txHash: '0xfeed', chainId: 42220 });
    expect(receipt).toMatchObject({ provider: 'stripe-card', status: 'settled', reference: '0xfeed' });
  });

  it('provisionCard() creates a cardholder then a crypto_wallet card with spending controls', async () => {
    const { calls } = queueFetch([
      { data: { id: 'ich_123' } },
      { data: { id: 'ic_123', last4: '4242', brand: 'Visa', status: 'active' } },
    ]);
    const p = new StripeCardPayoutProvider({ stripeSecretKey: KEY, chain: 'celo', stablecoin: 'cusd' });

    const card = await p.provisionCard({
      agentId: '128',
      walletAddress: '0xAgentWallet',
      spendingControls: { perAuthorization: '50', daily: '200' },
    });

    expect(card).toMatchObject({ id: 'ic_123', last4: '4242', status: 'active', walletAddress: '0xAgentWallet' });

    // 1st call → cardholder, 2nd → card
    expect(calls[0].url).toMatch(/\/v1\/issuing\/cardholders$/);
    expect(calls[1].url).toMatch(/\/v1\/issuing\/cards$/);

    const body = new URLSearchParams(calls[1].body);
    expect(body.get('cardholder')).toBe('ich_123');
    expect(body.get('type')).toBe('virtual');
    expect(body.get('currency')).toBe('usd');
    expect(body.get('crypto_wallet[chain]')).toBe('celo');
    expect(body.get('crypto_wallet[currency]')).toBe('cusd');
    expect(body.get('crypto_wallet[type]')).toBe('standard');
    expect(body.get('crypto_wallet[address]')).toBe('0xAgentWallet');
    expect(body.get('metadata[agentId]')).toBe('128');
    // spending controls → minor units + intervals
    expect(body.get('spending_controls[spending_limits][0][amount]')).toBe('5000');
    expect(body.get('spending_controls[spending_limits][0][interval]')).toBe('per_authorization');
    expect(body.get('spending_controls[spending_limits][1][amount]')).toBe('20000');
    expect(body.get('spending_controls[spending_limits][1][interval]')).toBe('daily');
  });

  it('provisionCard() skips cardholder creation when cardholderId is given', async () => {
    const { calls } = queueFetch([{ data: { id: 'ic_9', status: 'active' } }]);
    const p = new StripeCardPayoutProvider({ stripeSecretKey: KEY });
    await p.provisionCard({ cardholderId: 'ich_existing', walletAddress: '0xW' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/v1\/issuing\/cards$/);
    expect(new URLSearchParams(calls[0].body).get('cardholder')).toBe('ich_existing');
  });

  it('getCardSecrets() expands number + cvc', async () => {
    const { calls } = queueFetch([
      { data: { id: 'ic_1', number: '4242424242424242', cvc: '123', exp_month: 12, exp_year: 2030 } },
    ]);
    const p = new StripeCardPayoutProvider({ stripeSecretKey: KEY });
    const secrets = await p.getCardSecrets('ic_1');
    expect(secrets).toEqual({ number: '4242424242424242', cvc: '123', expMonth: 12, expYear: 2030 });
    expect(calls[0].method).toBe('GET');
    expect(decodeURIComponent(calls[0].url)).toContain('expand[0]=number');
  });

  it('surfaces Stripe API errors', async () => {
    queueFetch([{ ok: false, data: { error: { message: 'No such cardholder' } } }]);
    const p = new StripeCardPayoutProvider({ stripeSecretKey: KEY });
    await expect(p.getCard('ic_missing')).rejects.toThrow(/No such cardholder/);
  });

  it('approvalRequirement() needs a bridge issuer address', () => {
    const noBridge = new StripeCardPayoutProvider({ stripeSecretKey: KEY });
    expect(() => noBridge.approvalRequirement({ token: '0xcUSD', amount: '50' })).toThrow(/bridgeIssuerAddress/);

    const p = new StripeCardPayoutProvider({ stripeSecretKey: KEY, bridgeIssuerAddress: '0xBridge' });
    expect(p.approvalRequirement({ token: '0xcUSD', amount: '50' })).toEqual({
      token: '0xcUSD',
      spender: '0xBridge',
      amount: '50',
    });
  });
});

// ─── createFacilitatorSettler ───────────────────────────────────────

describe('createFacilitatorSettler', () => {
  const CUSD = '0x765DE816845861e75A25fCA122bb6898B8B1282a';

  it('builds a PaymentAuth from the quote and returns settlement proof', async () => {
    const captured: Array<{ merchant: string; amount: bigint; agentId: bigint; token: string; challengeId: string; nonce: bigint; deadline: bigint }> = [];
    const fakeFacilitator = {
      chainId: 42220,
      async signPaymentAuth(auth: (typeof captured)[number]) {
        captured.push(auth);
        return '0xsig';
      },
      async pay(auth: (typeof captured)[number]) {
        return { txHash: '0xTX', merchant: auth.merchant, amount: auth.amount, fee: 0n };
      },
    };

    const settle = createFacilitatorSettler({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      facilitator: fakeFacilitator as any,
      agentId: 128n,
      token: CUSD,
      decimals: 18,
    });

    const quote = {
      rail: 'card' as const,
      provider: 'stripe-card',
      request: { target: { kind: 'card' as const }, amount: '12' },
      cusdAmount: '12.000000',
      fee: '0',
      settleTo: '0x000000000000000000000000000000000000dEaD',
      quoteRef: 'q',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };

    const proof = await settle(quote);
    expect(proof).toEqual({ txHash: '0xTX', chainId: 42220, agentId: '128' });

    const auth = captured[0];
    expect(auth.agentId).toBe(128n);
    expect(auth.token).toBe(CUSD);
    expect(auth.merchant).toBe('0x000000000000000000000000000000000000dEaD');
    expect(auth.amount).toBe(parseUnits('12.000000', 18));
    expect(typeof auth.challengeId).toBe('string');
    expect(typeof auth.nonce).toBe('bigint');
    expect(auth.deadline).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
  });
});
