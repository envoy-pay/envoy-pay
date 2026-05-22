/**
 * Typed viem client for `EnvoyFacilitator.sol`.
 *
 * Provides three layers:
 *
 *   1. Pure helpers — `paymentAuthDomain`, `paymentAuthTypes`, the typed-data
 *      builder. Useful for any code that just needs to sign a `PaymentAuth`
 *      without taking a Facilitator client dependency.
 *   2. `signPaymentAuth(...)` — convenience wrapper around
 *      `walletClient.signTypedData(...)` for the agent's signing wallet.
 *   3. `createEnvoyFacilitator(...)` — full client bundling reads + writes +
 *      sign + the contract address.
 *
 * All amounts are bigints in the token's smallest unit. cKES is 18 decimals;
 * USDC is 6.
 */

import {
  type Account,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
  decodeEventLog,
  getAddress,
} from 'viem';

import { ENVOY_FACILITATOR_ABI } from './abis/EnvoyFacilitator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The EIP-712 message the agent's wallet signs to authorize a single payment. */
export interface PaymentAuth {
  agentId: bigint;
  token: Address;
  merchant: Address;
  amount: bigint;
  challengeId: Hex; // bytes32
  nonce: bigint;
  /** Unix seconds. Use a `uint64` value — the contract will revert past this. */
  deadline: bigint;
}

/** Spending policy storage shape, as returned by `getLimit(...)`. */
export interface LimitView {
  perTx: bigint;
  perPeriod: bigint;
  spentInPeriod: bigint;
  periodStart: bigint;
  periodLen: number;
  enabled: boolean;
}

export interface SettledEvent {
  challengeId: Hex;
  agentId: bigint;
  merchant: Address;
  token: Address;
  amount: bigint;
  fee: bigint;
  nonce: bigint;
  signer: Address;
  txHash: Hash;
  blockNumber: bigint;
}

// ---------------------------------------------------------------------------
// EIP-712 — domain + types + builder
// ---------------------------------------------------------------------------

export function paymentAuthDomain(args: { chainId: number; facilitatorAddress: Address }) {
  return {
    name: 'EnvoyFacilitator',
    version: '1',
    chainId: args.chainId,
    verifyingContract: args.facilitatorAddress,
  } as const;
}

export const PAYMENT_AUTH_TYPES = {
  PaymentAuth: [
    { name: 'agentId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'challengeId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

/** Build a viem-compatible typed-data payload for `walletClient.signTypedData`. */
export function paymentAuthTypedData(args: {
  chainId: number;
  facilitatorAddress: Address;
  auth: PaymentAuth;
}) {
  return {
    domain: paymentAuthDomain(args),
    types: PAYMENT_AUTH_TYPES,
    primaryType: 'PaymentAuth' as const,
    message: args.auth,
  };
}

/** Sign a `PaymentAuth` with the agent's signing wallet. */
export async function signPaymentAuth(
  walletClient: WalletClient,
  args: { chainId: number; facilitatorAddress: Address; auth: PaymentAuth },
): Promise<Hex> {
  const account = walletClient.account;
  if (!account) throw new Error('signPaymentAuth: walletClient has no account configured');

  return walletClient.signTypedData({
    account,
    ...paymentAuthTypedData(args),
  });
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export interface EnvoyFacilitatorClientOptions {
  /** Address of the deployed `EnvoyFacilitator`. */
  address: Address;
  /** Public client for reads + receipt waiting. */
  publicClient: PublicClient;
  /** Optional wallet client for writes. Omit for read-only usage. */
  walletClient?: WalletClient;
  /** EIP-155 chainId. If omitted, the publicClient's chain is used. */
  chainId?: number;
}

export interface EnvoyFacilitatorClient {
  /** Resolved address of the deployed Facilitator. */
  readonly address: Address;
  /** Resolved chain id used for EIP-712 binding. */
  readonly chainId: number;

  // ---- reads ----
  getFeeBps(): Promise<number>;
  getMaxFeeBps(): Promise<number>;
  getTreasury(): Promise<Address>;
  getIdentityRegistry(): Promise<Address>;
  getLimit(agentId: bigint, token: Address): Promise<LimitView>;
  isNonceUsed(agentId: bigint, nonce: bigint): Promise<boolean>;
  /** Returns the on-chain digest the agent's wallet must sign. */
  paymentAuthHash(auth: PaymentAuth): Promise<Hex>;
  domainSeparator(): Promise<Hex>;

  // ---- writes (require walletClient) ----
  setLimit(args: {
    agentId: bigint;
    token: Address;
    perTx: bigint;
    perPeriod: bigint;
    periodLen: number;
    account?: Account | Address;
  }): Promise<Hash>;
  disableLimit(args: { agentId: bigint; token: Address; account?: Account | Address }): Promise<Hash>;
  setTreasury(newTreasury: Address, account?: Account | Address): Promise<Hash>;

  // ---- the hot path ----
  pay(auth: PaymentAuth, signature: Hex, opts?: { account?: Account | Address }): Promise<SettledEvent>;

  // ---- signing convenience ----
  signPaymentAuth(auth: PaymentAuth): Promise<Hex>;
}

export function createEnvoyFacilitator(opts: EnvoyFacilitatorClientOptions): EnvoyFacilitatorClient {
  const { address, publicClient, walletClient } = opts;
  const chainId = opts.chainId ?? publicClient.chain?.id;
  if (chainId === undefined) {
    throw new Error('createEnvoyFacilitator: chainId could not be inferred — pass it explicitly');
  }

  const requireWallet = (): WalletClient => {
    if (!walletClient) {
      throw new Error('createEnvoyFacilitator: this operation needs a walletClient');
    }
    return walletClient;
  };

  const resolveAccount = (override?: Account | Address): Account | Address => {
    if (override) return override;
    const account = walletClient?.account;
    if (!account) {
      throw new Error('createEnvoyFacilitator: no account on walletClient and none provided');
    }
    return account;
  };

  return {
    address,
    chainId,

    // ---- reads ----
    getFeeBps: () =>
      publicClient.readContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'feeBps',
      }),
    getMaxFeeBps: () =>
      publicClient.readContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'MAX_FEE_BPS',
      }),
    getTreasury: () =>
      publicClient.readContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'treasury',
      }),
    getIdentityRegistry: () =>
      publicClient.readContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'IDENTITY',
      }),
    getLimit: async (agentId, token) => {
      const raw = await publicClient.readContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'getLimit',
        args: [agentId, token],
      });
      return {
        perTx: raw.perTx,
        perPeriod: raw.perPeriod,
        spentInPeriod: raw.spentInPeriod,
        periodStart: raw.periodStart,
        periodLen: raw.periodLen,
        enabled: raw.enabled,
      };
    },
    isNonceUsed: (agentId, nonce) =>
      publicClient.readContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'isNonceUsed',
        args: [agentId, nonce],
      }),
    paymentAuthHash: (auth) =>
      publicClient.readContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'paymentAuthHash',
        args: [auth],
      }),
    domainSeparator: () =>
      publicClient.readContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'domainSeparator',
      }),

    // ---- writes ----
    setLimit: ({ agentId, token, perTx, perPeriod, periodLen, account }) => {
      const wc = requireWallet();
      return wc.writeContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'setLimit',
        args: [agentId, token, perTx, perPeriod, periodLen],
        account: resolveAccount(account),
        chain: wc.chain,
      });
    },
    disableLimit: ({ agentId, token, account }) => {
      const wc = requireWallet();
      return wc.writeContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'disableLimit',
        args: [agentId, token],
        account: resolveAccount(account),
        chain: wc.chain,
      });
    },
    setTreasury: (newTreasury, account) => {
      const wc = requireWallet();
      return wc.writeContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'setTreasury',
        args: [newTreasury],
        account: resolveAccount(account),
        chain: wc.chain,
      });
    },

    // ---- hot path ----
    pay: async (auth, signature, payOpts) => {
      const wc = requireWallet();
      const txHash = await wc.writeContract({
        address,
        abi: ENVOY_FACILITATOR_ABI,
        functionName: 'pay',
        args: [auth, signature],
        account: resolveAccount(payOpts?.account),
        chain: wc.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== getAddress(address)) continue;
        try {
          const decoded = decodeEventLog({
            abi: ENVOY_FACILITATOR_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'Settled') {
            return {
              challengeId: decoded.args.challengeId,
              agentId: decoded.args.agentId,
              merchant: decoded.args.merchant,
              token: decoded.args.token,
              amount: decoded.args.amount,
              fee: decoded.args.fee,
              nonce: decoded.args.nonce,
              signer: decoded.args.signer,
              txHash,
              blockNumber: receipt.blockNumber,
            };
          }
        } catch {
          // Not the event we wanted.
        }
      }
      throw new Error(`pay: no Settled event in receipt ${txHash}`);
    },

    // ---- signing ----
    signPaymentAuth: (auth) =>
      signPaymentAuth(requireWallet(), { chainId, facilitatorAddress: address, auth }),
  };
}
