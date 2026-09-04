import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Reset + migrate + seed once when RUN_DB_IT=1 (no-op otherwise).
    globalSetup: ['./vitest.globalsetup.ts'],
    // Integration specs share one database — run files serially.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
