// envoy on-chain layer — the EnvoyFacilitator contract on Celo.
//
// Identity and reputation are delegated to the canonical ERC-8004 registries
// on Celo; helpers for those live under `src/identity/erc8004/`.

export {
  ENVOY_CONTRACT_ADDRESSES,
  getEnvoyAddresses,
  CELO_MAINNET,
  CELO_SEPOLIA,
} from './addresses';
export type { EnvoyContractAddresses } from './addresses';

export {
  createEnvoyFacilitator,
  signPaymentAuth,
  paymentAuthDomain,
  paymentAuthTypedData,
  PAYMENT_AUTH_TYPES,
} from './facilitator';
export type {
  PaymentAuth,
  LimitView,
  SettledEvent,
  EnvoyFacilitatorClient,
  EnvoyFacilitatorClientOptions,
} from './facilitator';

export { ENVOY_FACILITATOR_ABI } from './abis/EnvoyFacilitator';
