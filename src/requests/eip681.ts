/**
 * EIP-681 — Ethereum Payment URI builder.
 *
 * Generates URIs per EIP-681 standard for requesting ETH or ERC-20 payments.
 * These URIs can be embedded in QR codes or shared as links.
 *
 * @see https://eips.ethereum.org/EIPS/eip-681
 *
 * @example
 * ```
 * // Native ETH payment
 * ethereum:0xABC...?value=1e18
 *
 * // ERC-20 USDC transfer
 * ethereum:0xUSDC_CONTRACT/transfer?address=0xABC...&uint256=500000
 * ```
 */

export interface Eip681Options {
  /** Recipient address. */
  to: string;
  /** Amount in human-readable format (e.g., '0.5'). */
  amount: string;
  /** Asset: 'ETH' for native, or ERC-20 contract address. Default: 'ETH'. */
  asset?: string;
  /** Chain ID (decimal). Default: 1 (Ethereum mainnet). */
  chainId?: number;
  /** Number of decimals for the token. Default: 18 for ETH, 6 for USDC. */
  decimals?: number;
}

/**
 * Build an EIP-681 payment URI.
 *
 * @example
 * ```ts
 * // Native ETH
 * buildEip681Uri({ to: '0xABC...', amount: '1.5' });
 * // => 'ethereum:0xABC...?value=1500000000000000000'
 *
 * // USDC on Base
 * buildEip681Uri({
 *   to: '0xABC...',
 *   amount: '10',
 *   asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
 *   chainId: 8453,
 *   decimals: 6,
 * });
 * // => 'ethereum:0x833589.../transfer?address=0xABC...&uint256=10000000&chainId=8453'
 * ```
 */
export function buildEip681Uri(options: Eip681Options): string {
  const { to, amount, asset, chainId, decimals } = options;
  const isNative = !asset || asset === 'ETH' || asset === 'eth';

  // EIP-681 carries the chain id in the PATH as `@<chainId>` (right after the
  // target address) — NOT as a query param. A non-standard `?chainId=` is
  // silently ignored by wallets, which then default to Ethereum mainnet and
  // prompt to send on the WRONG chain. The `@<chainId>` form is what makes a
  // Celo (42220) QR actually open as a Celo payment.
  const chainSuffix = chainId && chainId !== 1 ? `@${chainId}` : '';

  if (isNative) {
    // Native: ethereum:<address>[@<chainId>]?value=<wei>
    const d = decimals ?? 18;
    const weiAmount = toAtomicUnits(amount, d);
    const params = new URLSearchParams();
    params.set('value', weiAmount);
    return `ethereum:${to}${chainSuffix}?${params.toString()}`;
  }

  // ERC-20: ethereum:<token>[@<chainId>]/transfer?address=<recipient>&uint256=<amount>
  const d = decimals ?? 6;
  const atomicAmount = toAtomicUnits(amount, d);
  const params = new URLSearchParams();
  params.set('address', to);
  params.set('uint256', atomicAmount);
  return `ethereum:${asset}${chainSuffix}/transfer?${params.toString()}`;
}

/**
 * Convert a human-readable amount to atomic units.
 */
function toAtomicUnits(amount: string, decimals: number): string {
  const parts = amount.split('.');
  const whole = parts[0] || '0';
  const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
  const combined = whole + frac;
  // Remove leading zeros
  return combined.replace(/^0+/, '') || '0';
}
