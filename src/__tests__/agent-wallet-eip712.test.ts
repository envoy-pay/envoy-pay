import { describe, it, expect } from 'vitest';
import { hashTypedData, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { agentWalletRotationTypedData } from '../identity/erc8004/identity';
// The web app vendors its own client-safe copy of this typed-data builder
// (it can't import the SDK — native binary). This test pins the two together:
// if they ever drift, setAgentWallet signatures from /create would be rejected
// on-chain. Import path crosses into the sibling web package on purpose.
import { agentWalletSetTypedData } from '../../web/lib/abi';

describe('AgentWalletSet EIP-712 parity (web ↔ SDK)', () => {
  const chainId = 42220; // Celo Mainnet
  const registry = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`;
  const agentId = 128n;
  const owner = '0x1111111111111111111111111111111111111111' as `0x${string}`;
  const newWallet = '0x2222222222222222222222222222222222222222' as `0x${string}`;
  const deadline = 1_900_000_000n;

  it('hashes identically to the SDK helper', () => {
    const web = agentWalletSetTypedData({ chainId, registry, agentId, newWallet, owner, deadline });
    const sdk = agentWalletRotationTypedData({
      chainId,
      registryAddress: registry,
      agentId,
      newWallet,
      owner,
      deadline,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(hashTypedData(web as any)).toBe(hashTypedData(sdk as any));
  });

  it('pins the domain + struct the canonical registry expects', () => {
    const td = agentWalletSetTypedData({ chainId, registry, agentId, newWallet, owner, deadline });
    expect(td.domain).toEqual({
      name: 'ERC8004IdentityRegistry',
      version: '1',
      chainId,
      verifyingContract: registry,
    });
    expect(td.primaryType).toBe('AgentWalletSet');
    expect(td.types.AgentWalletSet).toEqual([
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ]);
  });

  it('a signature from the agent key recovers to its own address (contract ECDSA path)', async () => {
    const agent = privateKeyToAccount(generatePrivateKey());
    const td = agentWalletSetTypedData({
      chainId,
      registry,
      agentId,
      newWallet: agent.address,
      owner,
      deadline,
    });
    const signature = await agent.signTypedData(td);
    const recovered = await recoverTypedDataAddress({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(td as any),
      signature,
    });
    expect(recovered.toLowerCase()).toBe(agent.address.toLowerCase());
  });
});
