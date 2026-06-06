import { describe, it, expect } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { agentWalletRotationTypedData } from '../identity/erc8004/identity';

// Pins the SDK's AgentWalletSet EIP-712 builder to the exact domain + struct the
// canonical ERC-8004 Identity Registry expects — if this drifts, setAgentWallet
// signatures get rejected on-chain.
//
// The web↔SDK parity check (that the envoy-app web client's vendored, client-safe
// copy matches this builder) lives in the envoy-app repo, which owns that copy and
// imports the SDK from the published `envoy-pay` package.
describe('AgentWalletSet EIP-712 (SDK)', () => {
  const chainId = 42220; // Celo Mainnet
  const registry = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`;
  const agentId = 128n;
  const owner = '0x1111111111111111111111111111111111111111' as `0x${string}`;
  const newWallet = '0x2222222222222222222222222222222222222222' as `0x${string}`;
  const deadline = 1_900_000_000n;

  it('pins the domain + struct the canonical registry expects', () => {
    const td = agentWalletRotationTypedData({
      chainId,
      registryAddress: registry,
      agentId,
      newWallet,
      owner,
      deadline,
    });
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
    const td = agentWalletRotationTypedData({
      chainId,
      registryAddress: registry,
      agentId,
      newWallet: agent.address,
      owner,
      deadline,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signature = await agent.signTypedData(td as any);
    const recovered = await recoverTypedDataAddress({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(td as any),
      signature,
    });
    expect(recovered.toLowerCase()).toBe(agent.address.toLowerCase());
  });
});
