import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'generateSW',
  registerType: 'prompt',
  includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'],
  manifest: {
    name: 'Namegen — music naming',
    short_name: 'Namegen',
    description: 'A naming workbench for music producers: names, ideas and a shortlist, on your device.',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#121216',
    background_color: '#121216',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    navigateFallback: '/index.html',
    // The API must never be cached or used as an offline navigation fallback.
    navigateFallbackDenylist: [/^\/api\//],
    globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
  },
  devOptions: { enabled: false },
};

export default defineConfig({
  plugins: [react(), VitePWA(pwaOptions)],
  server: {
    port: 5173,
    proxy: {
      // Local dev: PWA on Vite, same-origin API proxied to `wrangler dev`.
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
  },
});
