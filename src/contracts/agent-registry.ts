import type { PublicClient, WalletClient, Account, Hash } from 'viem';
import { ENVOY_AGENT_REGISTRY_ABI } from './abis/EnvoyAgentRegistry';

export interface AgentRecord {
  owner: `0x${string}`;
  metadataURI: string;
  revoked: boolean;
  registeredAt: bigint;
  updatedAt: bigint;
}

export interface AgentRegistryOptions {
  address: `0x${string}`;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account;
}

/**
 * AgentRegistryClient — read/write helper around the EnvoyAgentRegistry contract.
 * Writes require both a walletClient and an account; reads only need a publicClient.
 */
export class AgentRegistryClient {
  readonly address: `0x${string}`;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly account?: Account;

  constructor(options: AgentRegistryOptions) {
    this.address = options.address;
    this.publicClient = options.publicClient;
    this.walletClient = options.walletClient;
    this.account = options.account;
  }

  async getAgent(did: string): Promise<AgentRecord> {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: ENVOY_AGENT_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [did],
    });
    return {
      owner: result[0],
      metadataURI: result[1],
      revoked: result[2],
      registeredAt: result[3],
      updatedAt: result[4],
    };
  }

  async isActive(did: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.address,
      abi: ENVOY_AGENT_REGISTRY_ABI,
      functionName: 'isActive',
      args: [did],
    });
  }

  async registerAgent(did: string, owner: `0x${string}`, metadataURI: string): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_AGENT_REGISTRY_ABI,
      functionName: 'registerAgent',
      args: [did, owner, metadataURI],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async updateAgent(did: string, metadataURI: string): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_AGENT_REGISTRY_ABI,
      functionName: 'updateAgent',
      args: [did, metadataURI],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async revokeAgent(did: string): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_AGENT_REGISTRY_ABI,
      functionName: 'revokeAgent',
      args: [did],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async transferAgentOwnership(did: string, newOwner: `0x${string}`): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_AGENT_REGISTRY_ABI,
      functionName: 'transferAgentOwnership',
      args: [did, newOwner],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  private requireWriteCapability() {
    if (!this.walletClient || !this.account) {
      throw new Error('AgentRegistryClient: walletClient and account are required for write calls');
    }
  }
}

export function createAgentRegistry(options: AgentRegistryOptions): AgentRegistryClient {
  return new AgentRegistryClient(options);
}
