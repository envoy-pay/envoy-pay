import type { PublicClient, WalletClient, Account, Hash } from 'viem';
import { ENVOY_REPUTATION_ABI } from './abis/EnvoyReputation';

export interface OnChainAttestation {
  attester: `0x${string}`;
  category: `0x${string}`;
  score: number;
  timestamp: bigint;
  evidenceURI: string;
}

export interface ReputationOptions {
  address: `0x${string}`;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account;
}

export class ReputationClient {
  readonly address: `0x${string}`;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly account?: Account;

  constructor(options: ReputationOptions) {
    this.address = options.address;
    this.publicClient = options.publicClient;
    this.walletClient = options.walletClient;
    this.account = options.account;
  }

  async attest(agentDID: string, category: `0x${string}`, score: number, evidenceURI = ''): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_REPUTATION_ABI,
      functionName: 'attest',
      args: [agentDID, category, score, evidenceURI],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async revoke(agentDID: string, category: `0x${string}`): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_REPUTATION_ABI,
      functionName: 'revoke',
      args: [agentDID, category],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async getAttestations(agentDID: string): Promise<OnChainAttestation[]> {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: ENVOY_REPUTATION_ABI,
      functionName: 'getAttestations',
      args: [agentDID],
    });
    return result.map((a) => ({
      attester: a.attester,
      category: a.category,
      score: a.score,
      timestamp: a.timestamp,
      evidenceURI: a.evidenceURI,
    }));
  }

  async getAttestationsByCategory(agentDID: string, category: `0x${string}`): Promise<OnChainAttestation[]> {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: ENVOY_REPUTATION_ABI,
      functionName: 'getAttestationsByCategory',
      args: [agentDID, category],
    });
    return result.map((a) => ({
      attester: a.attester,
      category: a.category,
      score: a.score,
      timestamp: a.timestamp,
      evidenceURI: a.evidenceURI,
    }));
  }

  async averageScore(agentDID: string, category: `0x${string}`): Promise<number> {
    return this.publicClient.readContract({
      address: this.address,
      abi: ENVOY_REPUTATION_ABI,
      functionName: 'averageScore',
      args: [agentDID, category],
    });
  }

  private requireWriteCapability() {
    if (!this.walletClient || !this.account) {
      throw new Error('ReputationClient: walletClient and account are required for write calls');
    }
  }
}

export function createReputation(options: ReputationOptions): ReputationClient {
  return new ReputationClient(options);
}
