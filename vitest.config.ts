import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Tests run in Node where the Workers runtime module is absent.
      'cloudflare:workers': fileURLToPath(new URL('./worker/cloudflare-workers.stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'worker/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
