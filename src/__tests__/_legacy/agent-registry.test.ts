import { describe, it, expect, vi } from 'vitest';
import { createAgentRegistry } from '../contracts/agent-registry';

describe('AgentRegistryClient', () => {
  const ADDR = '0x1111111111111111111111111111111111111111' as const;
  const OWNER = '0x2222222222222222222222222222222222222222' as const;

  function mockClients() {
    const readContract = vi.fn();
    const writeContract = vi.fn().mockResolvedValue('0xtxhash');
    const publicClient = { readContract } as any;
    const walletClient = { writeContract, chain: { id: 42220 } } as any;
    return { readContract, writeContract, publicClient, walletClient };
  }

  it('getAgent decodes tuple result', async () => {
    const { readContract, publicClient } = mockClients();
    readContract.mockResolvedValue([OWNER, 'ipfs://card', false, 1700000000n, 1700000050n]);
    const client = createAgentRegistry({ address: ADDR, publicClient });

    const agent = await client.getAgent('did:envoy:test');
    expect(agent.owner).toBe(OWNER);
    expect(agent.metadataURI).toBe('ipfs://card');
    expect(agent.revoked).toBe(false);
    expect(agent.registeredAt).toBe(1700000000n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: ADDR, functionName: 'getAgent', args: ['did:envoy:test'] }),
    );
  });

  it('isActive returns boolean', async () => {
    const { readContract, publicClient } = mockClients();
    readContract.mockResolvedValue(true);
    const client = createAgentRegistry({ address: ADDR, publicClient });
    expect(await client.isActive('did:x')).toBe(true);
  });

  it('registerAgent sends correct call shape', async () => {
    const { writeContract, publicClient, walletClient } = mockClients();
    const account = { address: OWNER } as any;
    const client = createAgentRegistry({ address: ADDR, publicClient, walletClient, account });

    const hash = await client.registerAgent('did:envoy:a', OWNER, 'ipfs://x');
    expect(hash).toBe('0xtxhash');
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ADDR,
        functionName: 'registerAgent',
        args: ['did:envoy:a', OWNER, 'ipfs://x'],
      }),
    );
  });

  it('write methods throw without walletClient', async () => {
    const { publicClient } = mockClients();
    const client = createAgentRegistry({ address: ADDR, publicClient });
    await expect(client.registerAgent('did:x', OWNER, '')).rejects.toThrow(/walletClient and account/);
  });
});
