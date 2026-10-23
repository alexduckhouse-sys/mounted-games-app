import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest lets us add custom code (push handler) to the SW while
      // Workbox still injects the precache manifest.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Mounted Games — Live',
        short_name: 'Mounted Games',
        description: 'Live scoring, timetable and team management for Pony Club Mounted Games competitions.',
        theme_color: '#17385F',
        background_color: '#F7F7F7',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Admin tools need a connection; don't download them for every spectator.
        // The link-preview image is only for crawlers; the embed widget's chunk only loads inside a club's page.
        globIgnores: ['og/**', '**/BroadcastPage-*.js', '**/CompetitionEditor-*.js', '**/FormatPage-*.js', '**/RulesPage-*.js', '**/AdminPage-*.js', '**/EmbedApp-*.{js,css}'],
      },
      devOptions: {
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
