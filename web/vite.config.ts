import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // We register the SW ourselves so we can show update prompts.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Mounted Games — Live',
        short_name: 'Mounted Games',
        description: 'Live scoring, timetable and team management for Pony Club Mounted Games competitions.',
        theme_color: '#0ea5e9',
        background_color: '#fef3c7',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Cache the shell + chunks for offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // API responses (timetable, comp detail, race templates, weather…) are
        // network-first with a cached fallback. Lets the timetable open offline
        // showing whatever was last seen.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mg-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/hubs/'),
            handler: 'NetworkOnly',
          },
        ],
        // Don't pre-cache the index — let NetworkFirst handle navigations so
        // updates always win when online.
        navigateFallback: '/index.html',
      },
      devOptions: {
        // Run the SW in dev too so the user can test offline behaviour.
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5050',
        changeOrigin: true,
      },
      '/hubs': {
        target: 'http://localhost:5050',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
