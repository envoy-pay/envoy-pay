// envoy-pay/stellar — opt-in Stellar rail.
//
// Pulls in @stellar/stellar-sdk (declared as an optional peer dep), so it only
// loads when you import this subpath — the Celo core stays light.
export { StellarPaymentAdapter } from './adapters/stellar';
export type { StellarPaymentAdapterOptions } from './adapters/stellar';
export { createStellarWatcher } from './monitor/stellar-watcher';
export type { StellarWatcherConfig } from './monitor/stellar-watcher';
export { buildSep7Uri } from './requests/sep7';
export type { Sep7Options } from './requests/sep7';
