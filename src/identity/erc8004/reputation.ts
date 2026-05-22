/**
 * Helpers around the canonical Celo ERC-8004 Reputation Registry.
 *
 * Each `giveFeedback` call attaches a signed value (with explicit decimals),
 * two free-form tags, an endpoint string, and an optional URI+hash of a richer
 * feedback document. The canonical contract:
 *
 *   - REJECTS self-feedback (where `msg.sender` is the agent's owner or an
 *     approved operator) — see the source's `isAuthorizedOrOwner` check.
 *   - Indexes feedback by `(agentId, clientAddress, feedbackIndex)`. The index
 *     is 1-based per client; the first call returns 1, the second returns 2, etc.
 *
 * 8004scan reads these contracts directly, so any feedback attributed to your
 * agentId here counts toward the Celo hackathon's Track 3 rank.
 */

import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
  decodeEventLog,
  getAddress,
} from 'viem';

import { ERC8004_REPUTATION_ABI } from './abis';
import type { AgentId, FeedbackArgs } from './types';

/**
 * Submit feedback on an agent. Returns the `feedbackIndex` (1-based per caller)
 * parsed from the `NewFeedback` event in the receipt.
 *
 * The caller (`walletClient.account.address`) must NOT be authorized for the
 * agent — i.e. an agent cannot rate itself. The contract reverts with
 * "Self-feedback not allowed" if you try.
 */
export async function giveFeedback(
  walletClient: WalletClient,
  publicClient: PublicClient,
  registryAddress: Address,
  args: FeedbackArgs,
): Promise<{ feedbackIndex: bigint; txHash: Hash }> {
  const account = walletClient.account;
  if (!account) throw new Error('giveFeedback: walletClient has no account configured');

  const txHash = await walletClient.writeContract({
    address: registryAddress,
    abi: ERC8004_REPUTATION_ABI,
    functionName: 'giveFeedback',
    args: [
      args.agentId,
      args.value,
      args.valueDecimals,
      args.tag1,
      args.tag2,
      args.endpoint,
      args.feedbackURI,
      args.feedbackHash,
    ],
    account,
    chain: walletClient.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(registryAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: ERC8004_REPUTATION_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'NewFeedback') {
        return { feedbackIndex: BigInt(decoded.args.feedbackIndex), txHash };
      }
    } catch {
      // Different event — keep scanning.
    }
  }
  throw new Error(`giveFeedback: no NewFeedback event in receipt ${txHash}`);
}

/**
 * Revoke a previously-submitted feedback. Only the original `clientAddress`
 * (i.e. the same wallet that called `giveFeedback`) can revoke.
 */
export async function revokeFeedback(
  walletClient: WalletClient,
  registryAddress: Address,
  agentId: AgentId,
  feedbackIndex: bigint,
): Promise<Hash> {
  const account = walletClient.account;
  if (!account) throw new Error('revokeFeedback: walletClient has no account configured');

  return walletClient.writeContract({
    address: registryAddress,
    abi: ERC8004_REPUTATION_ABI,
    functionName: 'revokeFeedback',
    args: [agentId, feedbackIndex],
    account,
    chain: walletClient.chain,
  });
}

/**
 * Build a `FeedbackArgs` object with the most common shape:
 *   - a percentage-style score in [0, 100] with one decimal,
 *   - two tags (category, sub-category),
 *   - an endpoint string for which deployment the feedback applies to.
 *
 * `value=850, valueDecimals=1` means "85.0 / 100".
 */
export function makeScoreFeedback(args: {
  agentId: AgentId;
  scoreOutOf100: number; // e.g. 87.5
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackURI?: string;
  feedbackHash?: Hex;
}): FeedbackArgs {
  const value = BigInt(Math.round(args.scoreOutOf100 * 10));
  return {
    agentId: args.agentId,
    value,
    valueDecimals: 1,
    tag1: args.tag1,
    tag2: args.tag2,
    endpoint: args.endpoint,
    feedbackURI: args.feedbackURI ?? '',
    feedbackHash: args.feedbackHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
  };
}
