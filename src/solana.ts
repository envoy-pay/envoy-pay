// envoy-pay/solana — opt-in Solana rail.
//
// Pulls in @solana/web3.js + @solana/spl-token (declared as optional peer deps),
// so it only loads when you import this subpath — the Celo core stays light.
export { SolanaPaymentAdapter } from './adapters/solana';
export type { SolanaAdapterOptions } from './adapters/solana';
export { createSolanaWatcher } from './monitor/solana-watcher';
export type { SolanaWatcherConfig } from './monitor/solana-watcher';
export { buildSolanaPayUri } from './requests/solana-pay';
export type { SolanaPayOptions } from './requests/solana-pay';
