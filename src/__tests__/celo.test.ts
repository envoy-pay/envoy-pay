import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvmPaymentAdapter, listEvmChains } from '../adapters/evm';

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      sendTransaction: vi.fn().mockResolvedValue('0xmock_celo_tx_hash'),
      writeContract: vi.fn().mockResolvedValue('0xmock_cusd_tx_hash'),
    })),
    createPublicClient: vi.fn(() => ({
      getBalance: vi.fn().mockResolvedValue(BigInt('5000000000000000000')), // 5 CELO
      readContract: vi.fn().mockResolvedValue(BigInt('10000000000000000000')), // 10 cUSD (18 decimals)
    })),
  };
});

vi.mock('viem/accounts', async () => {
  const actual = await vi.importActual<typeof import('viem/accounts')>('viem/accounts');
  return { ...actual };
});

describe('EvmPaymentAdapter — Celo', () => {
  describe('chain registry', () => {
    it('exposes celo mainnet and alfajores in listEvmChains', () => {
      const names = listEvmChains().map((c) => c.name);
      expect(names).toContain('celo');
      expect(names).toContain('celo-alfajores');
    });

    it('celo has cUSD, cEUR, cREAL, USDC stablecoins', () => {
      const celo = listEvmChains().find((c) => c.name === 'celo')!;
      expect(celo.chainId).toBe(42220);
      expect(celo.caip2Id).toBe('eip155:42220');
      expect(celo.stablecoins).toEqual(expect.arrayContaining(['USDC', 'cUSD', 'cEUR', 'cREAL', 'USDT']));
    });

    it('celo-alfajores resolves to chainId 44787', () => {
      const alfa = listEvmChains().find((c) => c.name === 'celo-alfajores')!;
      expect(alfa.chainId).toBe(44787);
      expect(alfa.caip2Id).toBe('eip155:44787');
    });
  });

  describe('construction', () => {
    it('builds with default native asset', () => {
      const adapter = new EvmPaymentAdapter({ chain: 'celo' });
      expect(adapter.chainName).toBe('Celo');
      expect(adapter.caip2Id).toBe('eip155:42220');
    });

    it('builds with cUSD asset', () => {
      const adapter = new EvmPaymentAdapter({ chain: 'celo', asset: 'cUSD' });
      expect(adapter.chainName).toBe('Celo');
    });

    it('throws on unsupported stablecoin', () => {
      expect(() => new EvmPaymentAdapter({ chain: 'celo', asset: 'NOPE' })).toThrow(/not available/);
    });

    it('throws on unsupported stablecoin for alfajores (no USDT)', () => {
      expect(() => new EvmPaymentAdapter({ chain: 'celo-alfajores', asset: 'USDT' })).toThrow(/not available/);
    });
  });

  describe('cUSD payments', () => {
    let adapter: EvmPaymentAdapter;
    let logs: string[];

    beforeEach(() => {
      logs = [];
      adapter = new EvmPaymentAdapter({
        chain: 'celo',
        asset: 'cUSD',
        logger: (m) => logs.push(m),
      });
    });

    it('sends cUSD successfully', async () => {
      const dest = '0x1234567890AbcdEF1234567890aBcdef12345678';
      const result = await adapter.pay(dest, '1000000000000000000', 'eip155:42220'); // 1 cUSD
      expect(result).toBe('0xmock_cusd_tx_hash');
      expect(logs.some((l) => l.includes('cUSD'))).toBe(true);
    });

    it('returns null on insufficient cUSD balance', async () => {
      const dest = '0x1234567890AbcdEF1234567890aBcdef12345678';
      // Request 100 cUSD (mock balance is 10 cUSD)
      const result = await adapter.pay(dest, '100000000000000000000', 'eip155:42220');
      expect(result).toBeNull();
      expect(logs.some((l) => l.includes('Insufficient'))).toBe(true);
    });
  });

  describe('balance helpers', () => {
    it('getStablecoinBalance returns formatted cUSD balance', async () => {
      const adapter = new EvmPaymentAdapter({ chain: 'celo', asset: 'cUSD' });
      const balance = await adapter.getStablecoinBalance('cUSD');
      expect(balance).toBe('10'); // 10 cUSD = 10_000000000000000000 atomic / 1e18
    });

    it('listStablecoins returns all symbols available on celo', () => {
      const adapter = new EvmPaymentAdapter({ chain: 'celo' });
      const stables = adapter.listStablecoins();
      expect(stables).toEqual(expect.arrayContaining(['USDC', 'cUSD', 'cEUR', 'cREAL', 'USDT']));
    });

    it('getStablecoinBalance returns 0.00 for unsupported symbol', async () => {
      const adapter = new EvmPaymentAdapter({ chain: 'celo' });
      const balance = await adapter.getStablecoinBalance('DOGE');
      expect(balance).toBe('0.00');
    });
  });
});
