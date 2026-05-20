import type { PublicClient, WalletClient, Account, Hash } from 'viem';
import { ENVOY_POLICY_GUARD_ABI } from './abis/EnvoyPolicyGuard';

export interface PolicyState {
  owner: `0x${string}`;
  dailyLimit: bigint;
  spentToday: bigint;
  windowStart: bigint;
  active: boolean;
  remainingToday: bigint;
}

export interface PolicyGuardOptions {
  address: `0x${string}`;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account;
}

export class PolicyGuardClient {
  readonly address: `0x${string}`;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly account?: Account;

  constructor(options: PolicyGuardOptions) {
    this.address = options.address;
    this.publicClient = options.publicClient;
    this.walletClient = options.walletClient;
    this.account = options.account;
  }

  async setPolicy(agent: `0x${string}`, token: `0x${string}`, dailyLimit: bigint): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_POLICY_GUARD_ABI,
      functionName: 'setPolicy',
      args: [agent, token, dailyLimit],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async revokePolicy(agent: `0x${string}`, token: `0x${string}`): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_POLICY_GUARD_ABI,
      functionName: 'revokePolicy',
      args: [agent, token],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async checkAndSpend(
    agent: `0x${string}`,
    token: `0x${string}`,
    amount: bigint,
    recipient: `0x${string}`,
  ): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_POLICY_GUARD_ABI,
      functionName: 'checkAndSpend',
      args: [agent, token, amount, recipient],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async getPolicy(agent: `0x${string}`, token: `0x${string}`): Promise<PolicyState> {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: ENVOY_POLICY_GUARD_ABI,
      functionName: 'getPolicy',
      args: [agent, token],
    });
    return {
      owner: result[0],
      dailyLimit: result[1],
      spentToday: result[2],
      windowStart: result[3],
      active: result[4],
      remainingToday: result[5],
    };
  }

  private requireWriteCapability() {
    if (!this.walletClient || !this.account) {
      throw new Error('PolicyGuardClient: walletClient and account are required for write calls');
    }
  }
}

export function createPolicyGuard(options: PolicyGuardOptions): PolicyGuardClient {
  return new PolicyGuardClient(options);
}
