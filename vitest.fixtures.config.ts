import { defineConfig } from 'vitest/config';

/**
 * Opt-in configuration for the live creative-fixture evaluation. Ordinary
 * `npm test` never includes scripts/**; this config exists so that running the
 * fixtures is an explicit action (npm run fixtures), and the live test still
 * self-skips when no DeepSeek key is configured.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.live.test.ts'],
    environment: 'node',
    testTimeout: 130_000,
    hookTimeout: 130_000,
  },
});
