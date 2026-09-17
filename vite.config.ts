import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keep the existing Worker and Pages targets; Sites uses the same naming API.
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/namegen/' : '/',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify(
      mode === 'pages' || mode === 'sites' ? 'https://namegen.whip-blanket.workers.dev' : '',
    ),
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'https://namegen.whip-blanket.workers.dev', changeOrigin: true } },
  },
  build: { sourcemap: false, target: 'es2022' },
}));

