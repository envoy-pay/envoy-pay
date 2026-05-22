/**
 * Helpers around the canonical Celo ERC-8004 Identity Registry.
 *
 * The Identity Registry is the source of truth for who an agent is:
 *
 *   - Registration mints an ERC-721 NFT to `msg.sender`. The tokenId is the
 *     agentId we use everywhere else.
 *   - `getAgentWallet(agentId)` returns the address authorized to *sign on the
 *     agent's behalf* — separate from `ownerOf(agentId)` which holds the NFT.
 *   - On NFT transfer the canonical contract clears `agentWallet`, so the new
 *     holder must re-register their signing wallet (via `setAgentWallet`).
 *
 * All helpers take a viem `Client` and the canonical Identity Registry
 * `address` for the chain you're targeting. Pull the address from
 * `getEnvoyAddresses(chainId).identityRegistry`.
 */

import {
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
  decodeEventLog,
  encodePacked,
  getAddress,
  hexToBytes,
  keccak256,
  stringToHex,
  toHex,
} from 'viem';

import { ERC8004_IDENTITY_ABI } from './abis';
import type { AgentId, CanonicalAgent, MetadataEntry } from './types';

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RegisterAgentArgs {
  /** Optional URI of the agent card JSON (name, capabilities, endpoints, ...). */
  agentURI?: string;
  /** Optional additional key/value metadata. Reserved key `"agentWallet"` is rejected on-chain. */
  metadata?: MetadataEntry[];
}

/**
 * Register a new agent on the canonical Identity Registry. The caller's address
 * becomes the NFT owner AND the initial `agentWallet`. Returns the minted
 * `agentId` (parsed from the `Registered` event in the receipt).
 *
 * Three overloads are exposed on the contract; this helper picks the one whose
 * input shape matches the arguments you pass (no URI / URI only / URI + metadata).
 */
export async function registerAgent(
  walletClient: WalletClient,
  publicClient: PublicClient,
  registryAddress: Address,
  args: RegisterAgentArgs = {},
): Promise<{ agentId: AgentId; txHash: Hash }> {
  const account = walletClient.account;
  if (!account) throw new Error('registerAgent: walletClient has no account configured');

  let txHash: Hash;
  if (args.metadata && args.metadata.length > 0) {
    txHash = await walletClient.writeContract({
      address: registryAddress,
      abi: ERC8004_IDENTITY_ABI,
      functionName: 'register',
      args: [
        args.agentURI ?? '',
        args.metadata.map((m) => ({ metadataKey: m.key, metadataValue: m.value })),
      ],
      account,
      chain: walletClient.chain,
    });
  } else if (args.agentURI !== undefined) {
    txHash = await walletClient.writeContract({
      address: registryAddress,
      abi: ERC8004_IDENTITY_ABI,
      functionName: 'register',
      args: [args.agentURI],
      account,
      chain: walletClient.chain,
    });
  } else {
    txHash = await walletClient.writeContract({
      address: registryAddress,
      abi: ERC8004_IDENTITY_ABI,
      functionName: 'register',
      args: [],
      account,
      chain: walletClient.chain,
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(registryAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: ERC8004_IDENTITY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'Registered') {
        return { agentId: decoded.args.agentId, txHash };
      }
    } catch {
      // Not the event we wanted — keep scanning.
    }
  }
  throw new Error(
    `registerAgent: no Registered event found in receipt ${txHash}; ` +
      'the transaction succeeded but the agentId could not be parsed.',
  );
}

/**
 * Rotate the agent's operational signing wallet. The new wallet (or its owner, in
 * the ERC-1271 case) must produce a signature over the EIP-712 `AgentWalletSet`
 * struct: `(uint256 agentId, address newWallet, address owner, uint256 deadline)`.
 *
 * The canonical contract verifies both ECDSA (EOA / 7702) and ERC-1271 paths.
 * Build the signature off-chain with `signAgentWalletRotation` below.
 */
export async function setAgentWallet(
  walletClient: WalletClient,
  registryAddress: Address,
  args: { agentId: AgentId; newWallet: Address; deadline: bigint; signature: Hex },
): Promise<Hash> {
  const account = walletClient.account;
  if (!account) throw new Error('setAgentWallet: walletClient has no account configured');

  return walletClient.writeContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'setAgentWallet',
    args: [args.agentId, args.newWallet, args.deadline, args.signature],
    account,
    chain: walletClient.chain,
  });
}

/** Clear the agent's operational signing wallet. Effectively pauses on-chain payments. */
export async function unsetAgentWallet(
  walletClient: WalletClient,
  registryAddress: Address,
  agentId: AgentId,
): Promise<Hash> {
  const account = walletClient.account;
  if (!account) throw new Error('unsetAgentWallet: walletClient has no account configured');

  return walletClient.writeContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'unsetAgentWallet',
    args: [agentId],
    account,
    chain: walletClient.chain,
  });
}

/** Update the agent's URI (e.g. when the agent card moves IPFS gateways). */
export async function setAgentURI(
  walletClient: WalletClient,
  registryAddress: Address,
  agentId: AgentId,
  newURI: string,
): Promise<Hash> {
  const account = walletClient.account;
  if (!account) throw new Error('setAgentURI: walletClient has no account configured');

  return walletClient.writeContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'setAgentURI',
    args: [agentId, newURI],
    account,
    chain: walletClient.chain,
  });
}

/** Set a single metadata key/value pair. Reserved key `"agentWallet"` is rejected on-chain. */
export async function setMetadata(
  walletClient: WalletClient,
  registryAddress: Address,
  agentId: AgentId,
  key: string,
  value: Hex,
): Promise<Hash> {
  const account = walletClient.account;
  if (!account) throw new Error('setMetadata: walletClient has no account configured');

  return walletClient.writeContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'setMetadata',
    args: [agentId, key, value],
    account,
    chain: walletClient.chain,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getAgentWallet(
  publicClient: PublicClient,
  registryAddress: Address,
  agentId: AgentId,
): Promise<Address> {
  return publicClient.readContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'getAgentWallet',
    args: [agentId],
  });
}

export async function getAgentOwner(
  publicClient: PublicClient,
  registryAddress: Address,
  agentId: AgentId,
): Promise<Address> {
  return publicClient.readContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'ownerOf',
    args: [agentId],
  });
}

export async function getAgentURI(
  publicClient: PublicClient,
  registryAddress: Address,
  agentId: AgentId,
): Promise<string> {
  return publicClient.readContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'tokenURI',
    args: [agentId],
  });
}

export async function getMetadata(
  publicClient: PublicClient,
  registryAddress: Address,
  agentId: AgentId,
  key: string,
): Promise<Hex> {
  return publicClient.readContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'getMetadata',
    args: [agentId, key],
  });
}

export async function isAuthorizedOrOwner(
  publicClient: PublicClient,
  registryAddress: Address,
  spender: Address,
  agentId: AgentId,
): Promise<boolean> {
  return publicClient.readContract({
    address: registryAddress,
    abi: ERC8004_IDENTITY_ABI,
    functionName: 'isAuthorizedOrOwner',
    args: [spender, agentId],
  });
}

/** Aggregate read — one round-trip per field. Convenience wrapper. */
export async function getAgent(
  publicClient: PublicClient,
  registryAddress: Address,
  agentId: AgentId,
): Promise<CanonicalAgent> {
  const [owner, agentWallet, tokenURI] = await Promise.all([
    getAgentOwner(publicClient, registryAddress, agentId),
    getAgentWallet(publicClient, registryAddress, agentId),
    getAgentURI(publicClient, registryAddress, agentId).catch(() => ''),
  ]);
  return { agentId, owner, agentWallet, tokenURI };
}

// ---------------------------------------------------------------------------
// EIP-712 helpers for setAgentWallet
// ---------------------------------------------------------------------------

/**
 * EIP-712 typed-data payload the new wallet must sign before `setAgentWallet`
 * can be called. The canonical contract's domain is
 * `EIP712Domain("ERC8004IdentityRegistry","1",chainId,verifyingContract)`.
 *
 * Pass the result to `walletClient.signTypedData(...)` from the *new* wallet (or
 * its ERC-1271 owner), then pass the signature into `setAgentWallet`.
 */
export function agentWalletRotationTypedData(args: {
  chainId: number;
  registryAddress: Address;
  agentId: AgentId;
  newWallet: Address;
  /** Current ERC-721 owner of the agent NFT. */
  owner: Address;
  deadline: bigint;
}) {
  return {
    domain: {
      name: 'ERC8004IdentityRegistry',
      version: '1',
      chainId: args.chainId,
      verifyingContract: args.registryAddress,
    },
    types: {
      AgentWalletSet: [
        { name: 'agentId', type: 'uint256' },
        { name: 'newWallet', type: 'address' },
        { name: 'owner', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'AgentWalletSet' as const,
    message: {
      agentId: args.agentId,
      newWallet: args.newWallet,
      owner: args.owner,
      deadline: args.deadline,
    },
  };
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Encode a UTF-8 string as a metadata value. Use for `setMetadata(...)`. */
export const encodeStringMetadata = (s: string): Hex => stringToHex(s);

/** Encode raw bytes as a metadata value. */
export const encodeBytesMetadata = (b: Uint8Array): Hex => toHex(b);

/** Compute the keccak256 hash an agent card URI's contents would have. Useful for `feedbackHash` etc. */
export function contentHash(bytes: Uint8Array): Hex {
  return keccak256(bytes);
}

/** Re-export viem encoder so callers don't have to import viem directly for trivial work. */
export { encodePacked, hexToBytes };
