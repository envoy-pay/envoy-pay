import type { PublicClient, WalletClient, Account, Hash } from 'viem';
import { ENVOY_ESCROW_ABI } from './abis/EnvoyEscrow';

export interface DepositRecord {
  payer: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  createdAt: bigint;
  expiresAt: bigint;
  settled: boolean;
}

export interface ReleaseSignaturePayload {
  paymentId: `0x${string}`;
  recipient: `0x${string}`;
  amount: bigint;
  deadline: bigint;
}

export interface EscrowOptions {
  address: `0x${string}`;
  chainId: number;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account;
}

/**
 * EscrowClient — read/write helper around the EnvoyEscrow contract.
 *
 * Off-chain facilitators sign Release messages (EIP-712) via `buildReleaseTypedData`
 * + their signer; on-chain callers submit (paymentId, recipient, amount, deadline, sig)
 * to `release()` to unlock funds.
 */
export class EscrowClient {
  readonly address: `0x${string}`;
  readonly chainId: number;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly account?: Account;

  constructor(options: EscrowOptions) {
    this.address = options.address;
    this.chainId = options.chainId;
    this.publicClient = options.publicClient;
    this.walletClient = options.walletClient;
    this.account = options.account;
  }

  async deposit(token: `0x${string}`, amount: bigint, paymentId: `0x${string}`, expiresAt: bigint): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_ESCROW_ABI,
      functionName: 'deposit',
      args: [token, amount, paymentId, expiresAt],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async release(
    paymentId: `0x${string}`,
    recipient: `0x${string}`,
    amount: bigint,
    deadline: bigint,
    signature: `0x${string}`,
  ): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_ESCROW_ABI,
      functionName: 'release',
      args: [paymentId, recipient, amount, deadline, signature],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async refund(paymentId: `0x${string}`): Promise<Hash> {
    this.requireWriteCapability();
    return this.walletClient!.writeContract({
      address: this.address,
      abi: ENVOY_ESCROW_ABI,
      functionName: 'refund',
      args: [paymentId],
      account: this.account!,
      chain: this.walletClient!.chain,
    });
  }

  async getDeposit(paymentId: `0x${string}`): Promise<DepositRecord> {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: ENVOY_ESCROW_ABI,
      functionName: 'getDeposit',
      args: [paymentId],
    });
    return {
      payer: result[0],
      token: result[1],
      amount: result[2],
      createdAt: result[3],
      expiresAt: result[4],
      settled: result[5],
    };
  }

  /**
   * Build the EIP-712 typed-data payload that the facilitator must sign
   * to authorize a release. Pass the result to `walletClient.signTypedData(...)`
   * (or any EIP-712-aware signer) and submit the signature to `release()`.
   */
  buildReleaseTypedData(payload: ReleaseSignaturePayload) {
    return {
      domain: {
        name: 'EnvoyEscrow',
        version: '1',
        chainId: this.chainId,
        verifyingContract: this.address,
      },
      types: {
        Release: [
          { name: 'paymentId', type: 'bytes32' },
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      } as const,
      primaryType: 'Release' as const,
      message: payload,
    };
  }

  private requireWriteCapability() {
    if (!this.walletClient || !this.account) {
      throw new Error('EscrowClient: walletClient and account are required for write calls');
    }
  }
}

export function createEscrow(options: EscrowOptions): EscrowClient {
  return new EscrowClient(options);
}
