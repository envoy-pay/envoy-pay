import { describe, it, expect, vi } from 'vitest';
import { createEscrow } from '../contracts/escrow';

describe('EscrowClient', () => {
  const ADDR = '0x3333333333333333333333333333333333333333' as const;
  const TOKEN = '0x765DE816845861e75A25fCA122bb6898B8B1282a' as const; // cUSD
  const RECIPIENT = '0x4444444444444444444444444444444444444444' as const;
  const PAYMENT_ID = '0xaaaa000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;

  function mockClients() {
    const readContract = vi.fn();
    const writeContract = vi.fn().mockResolvedValue('0xescrowtx');
    const publicClient = { readContract } as any;
    const walletClient = { writeContract, chain: { id: 42220 } } as any;
    return { readContract, writeContract, publicClient, walletClient };
  }

  it('deposit forwards args correctly', async () => {
    const { writeContract, publicClient, walletClient } = mockClients();
    const account = { address: '0x5555555555555555555555555555555555555555' } as any;
    const client = createEscrow({ address: ADDR, chainId: 42220, publicClient, walletClient, account });

    await client.deposit(TOKEN, 100n, PAYMENT_ID, 1700000000n);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ADDR,
        functionName: 'deposit',
        args: [TOKEN, 100n, PAYMENT_ID, 1700000000n],
      }),
    );
  });

  it('getDeposit decodes tuple', async () => {
    const { readContract, publicClient } = mockClients();
    readContract.mockResolvedValue([
      '0xpayer000000000000000000000000000000000001',
      TOKEN,
      500n,
      1700000000n,
      1700000600n,
      false,
    ]);
    const client = createEscrow({ address: ADDR, chainId: 42220, publicClient });
    const d = await client.getDeposit(PAYMENT_ID);
    expect(d.amount).toBe(500n);
    expect(d.token).toBe(TOKEN);
    expect(d.settled).toBe(false);
  });

  it('buildReleaseTypedData produces EIP-712 envelope with correct domain and message', () => {
    const { publicClient } = mockClients();
    const client = createEscrow({ address: ADDR, chainId: 42220, publicClient });
    const typed = client.buildReleaseTypedData({
      paymentId: PAYMENT_ID,
      recipient: RECIPIENT,
      amount: 1000n,
      deadline: 1700000600n,
    });

    expect(typed.domain).toEqual({
      name: 'EnvoyEscrow',
      version: '1',
      chainId: 42220,
      verifyingContract: ADDR,
    });
    expect(typed.primaryType).toBe('Release');
    expect(typed.types.Release).toHaveLength(4);
    expect(typed.message).toEqual({
      paymentId: PAYMENT_ID,
      recipient: RECIPIENT,
      amount: 1000n,
      deadline: 1700000600n,
    });
  });

  it('release forwards signature', async () => {
    const { writeContract, publicClient, walletClient } = mockClients();
    const account = { address: '0x5555555555555555555555555555555555555555' } as any;
    const client = createEscrow({ address: ADDR, chainId: 42220, publicClient, walletClient, account });

    const sig = '0xdead' as `0x${string}`;
    await client.release(PAYMENT_ID, RECIPIENT, 1000n, 1700000600n, sig);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'release',
        args: [PAYMENT_ID, RECIPIENT, 1000n, 1700000600n, sig],
      }),
    );
  });
});
