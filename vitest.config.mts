import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    // _legacy/ paths hold archived SDK tests whose target modules have been
    // moved or removed. They remain on disk for reference but must not run.
    exclude: ['**/_legacy/**', '**/node_modules/**'],
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        // Re-export barrels — no executable logic, just `export … from`.
        '**/index.ts',
        // Type-only declaration files — compile to nothing, so v8 reports them
        // as 0% and skews the aggregate. (facilitator/types.ts is NOT listed:
        // it ships runtime constants — PRICING_TIERS/CARD_TIERS — that ARE covered.)
        'src/identity/types.ts',
        'src/identity/erc8004/types.ts',
        'src/adapters/types.ts',
        'src/wallet/types.ts',
        '**/_legacy/**',
      ],
      // Coverage gate. The pure identity modules (reputation, owner-registry,
      // agent-identity) are now unit-tested, so the suite genuinely clears 80%
      // lines/statements — see src/__tests__/{owner-registry,reputation,
      // agent-identity}.test.ts. Remaining headroom is in the on-chain ERC-8004
      // wrappers (erc8004/identity.ts, erc8004/reputation.ts), which need a
      // mocked viem client to cover.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
