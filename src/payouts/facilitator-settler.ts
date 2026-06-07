/**
 * The bridge between the payout layer and `EnvoyFacilitator`.
 *
 * {@link PayoutRouter.pay} needs a `settleOnChain` callback that turns a quote into
 * an on-chain cUSD settlement and returns proof. This builds that callback from a
 * facilitator client, so the whole "agent pays the real world" flow is one call:
 *
 * ```ts
 * await router.pay(
 *   { target: { kind: 'card', cardId }, amount: '12.00' },
 *   createFacilitatorSettler({ facilitator, agentId, token: CUSD, decimals: 18 }),
 * );
 * ```
 *
 * The agent signs a `PaymentAuth` paying `quote.cusdAmount` to `quote.settleTo`;
 * the facilitator enforces the agent's per-tx + daily caps on-chain and emits
 * `Settled`. The proof returned is exactly what the provider needs to dispatch the
 * real-world payout.
 */
import { parseUnits, toHex, type Address, type Hex } from 'viem';
import type { EnvoyFacilitatorClient, PaymentAuth } from '../contracts/facilitator';
import type { PayoutQuote, SettlementProof } from './types';
import type { SettleOnChain } from './router';

export interface FacilitatorSettlerOptions {
  /** A facilitator client whose walletClient is the agent's signer. */
  facilitator: EnvoyFacilitatorClient;
  /** The ERC-8004 agent paying. */
  agentId: bigint;
  /** Settlement token (cUSD on Celo). */
  token: Address;
  /** Token decimals (cUSD = 18). */
  decimals: number;
  /** Seconds the signed authorization stays valid. @default 3600 */
  authTtlSeconds?: number;
}

function randHex32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function createFacilitatorSettler(opts: FacilitatorSettlerOptions): SettleOnChain {
  const ttl = BigInt(opts.authTtlSeconds ?? 3600);

  return async (quote: PayoutQuote): Promise<SettlementProof> => {
    const auth: PaymentAuth = {
      agentId: opts.agentId,
      token: opts.token,
      merchant: quote.settleTo as Address,
      amount: parseUnits(quote.cusdAmount, opts.decimals),
      challengeId: randHex32(),
      nonce: BigInt(randHex32()),
      deadline: BigInt(Math.floor(Date.now() / 1000)) + ttl,
    };

    const signature = await opts.facilitator.signPaymentAuth(auth);
    const settled = await opts.facilitator.pay(auth, signature);

    return {
      txHash: settled.txHash,
      chainId: opts.facilitator.chainId,
      agentId: opts.agentId.toString(),
    };
  };
}
