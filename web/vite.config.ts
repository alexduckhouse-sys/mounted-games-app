import { defineConfig, loadEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { NATIVE_BUILD_MODE, assertNativeBuildEnv } from './src/native/buildEnv';

const config: UserConfig = {
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
        // Admin tools, studio/broadcast views, print views and static country flags are excluded from eager precaching.
        // The link-preview image is only for crawlers; the embed widget's chunk only loads inside a club's page.
        globIgnores: [
          'og/**',
          'flags/*.svg',
          'flags/**/*.svg',
          '**/BroadcastPage-*.{js,css}',
          '**/StreamControlsPage-*.{js,css}',
          '**/ProducePage-*.{js,css}',
          '**/CompetitionEditor-*.{js,css}',
          '**/FormatPage-*.{js,css}',
          '**/RulesPage-*.{js,css}',
          '**/RulesLibraryPage-*.{js,css}',
          '**/DiagramEditor-*.{js,css}',
          '**/AdminPage-*.{js,css}',
          '**/SiteAdminDashboard-*.{js,css}',
          '**/AdminCompetitionsPage-*.{js,css}',
          '**/TrainerRequestsPage-*.{js,css}',
          '**/UsersPage-*.{js,css}',
          '**/BlockedAccountsPage-*.{js,css}',
          '**/EmailPage-*.{js,css}',
          '**/PrintEventPage-*.{js,css}',
          '**/EventToolsPage-*.{js,css}',
          '**/EmbedApp-*.{js,css}',
        ],
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
};

export default defineConfig(({ mode }) => {
  // The iPhone app build (`vite build --mode ios`) must point at the servers by absolute https address.
  if (mode === NATIVE_BUILD_MODE) assertNativeBuildEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  return config;
});
