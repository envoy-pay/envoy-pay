import { describe, it, expect, vi } from 'vitest';
import { createReputation } from '../contracts/reputation';

describe('ReputationClient', () => {
  const ADDR = '0x6666666666666666666666666666666666666666' as const;
  const CATEGORY = '0xabcdef0000000000000000000000000000000000000000000000000000000001' as `0x${string}`;

  function mockClients() {
    const readContract = vi.fn();
    const writeContract = vi.fn().mockResolvedValue('0xreptx');
    const publicClient = { readContract } as any;
    const walletClient = { writeContract, chain: { id: 42220 } } as any;
    return { readContract, writeContract, publicClient, walletClient };
  }

  it('attest forwards args', async () => {
    const { writeContract, publicClient, walletClient } = mockClients();
    const account = { address: '0x7777777777777777777777777777777777777777' } as any;
    const client = createReputation({ address: ADDR, publicClient, walletClient, account });

    await client.attest('did:envoy:a', CATEGORY, 850, 'ipfs://e');
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'attest',
        args: ['did:envoy:a', CATEGORY, 850, 'ipfs://e'],
      }),
    );
  });

  it('getAttestations maps result correctly', async () => {
    const { readContract, publicClient } = mockClients();
    readContract.mockResolvedValue([
      { attester: '0xaa', category: CATEGORY, score: 700, timestamp: 1700n, evidenceURI: 'a' },
      { attester: '0xbb', category: CATEGORY, score: 900, timestamp: 1800n, evidenceURI: 'b' },
    ]);
    const client = createReputation({ address: ADDR, publicClient });
    const list = await client.getAttestations('did:x');
    expect(list).toHaveLength(2);
    expect(list[0].score).toBe(700);
    expect(list[1].evidenceURI).toBe('b');
  });

  it('averageScore returns number', async () => {
    const { readContract, publicClient } = mockClients();
    readContract.mockResolvedValue(800);
    const client = createReputation({ address: ADDR, publicClient });
    expect(await client.averageScore('did:x', CATEGORY)).toBe(800);
  });
});
