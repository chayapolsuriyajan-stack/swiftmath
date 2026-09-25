import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: { target: 'es2022' },
  server: { host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'model/*'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,bin}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'SwiftMath',
        short_name: 'SwiftMath',
        description: 'Quick mental arithmetic with handwriting.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
});
