import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

/**
 * Two build targets, selected by mode:
 *  - default (production): the Cloudflare Worker deployment, served from the
 *    site root with a same-origin API.
 *  - pages (`vite build --mode pages`): the GitHub Pages mirror, hosted under
 *    /namegen/, calling the Cloudflare Worker cross-origin via VITE_API_BASE
 *    (see .env.pages).
 */
export default defineConfig(({ mode }) => {
  const isPages = mode === 'pages';
  const base = isPages ? '/namegen/' : '/';
  const asset = (path: string) => `${base}${path}`;

  const pwaOptions: Partial<VitePWAOptions> = {
    strategies: 'generateSW',
    registerType: 'prompt',
    manifest: {
      name: 'Namegen — music naming',
      short_name: 'Namegen',
      description: 'A naming workbench for music producers: names, ideas and a shortlist, on your device.',
      lang: 'en',
      start_url: base,
      scope: base,
      display: 'standalone',
      theme_color: '#121216',
      background_color: '#121216',
      icons: [
        { src: asset('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
        { src: asset('icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
        { src: asset('icons/icon-512-maskable.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      navigateFallback: `${base}index.html`,
      // The API must never be cached or used as an offline navigation fallback.
      navigateFallbackDenylist: [/\/api\//],
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: false,
    },
    devOptions: { enabled: false },
  };

  return {
    base,
    plugins: [react(), VitePWA(pwaOptions)],
    // The Pages mirror is static; API calls go to the Cloudflare Worker, which
    // keeps the DeepSeek key server-side. Value is public (no secret).
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(isPages ? 'https://namegen.whip-blanket.workers.dev' : ''),
    },
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
  };
});
