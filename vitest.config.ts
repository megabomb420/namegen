import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'worker/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.live.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
