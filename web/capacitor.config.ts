import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone shell (B1 prototype gate in the iOS plan). The app bundles the normal web build from `dist`.
 * Build it for the app with absolute addresses: the app's own origin is `capacitor://localhost`, so a
 * relative `/api` would point back into the bundle.
 *
 *   npx tsc -b
 *   VITE_API_BASE=https://<site>/api VITE_LIVE_HUB_URL=https://<api>/hubs/live npx vite build --mode ios
 *   npx cap sync ios
 *
 * `--mode ios` makes the build stop unless both addresses are absolute https (src/native/buildEnv.ts).
 *
 * `appId` is a placeholder until the Apple account (and its bundle id) is settled. A free Personal Team
 * needs an id nobody else has used, so change it per Mac when signing (see ios/SIGNING-SMOKE-TEST.md).
 */
const config: CapacitorConfig = {
  appId: 'uk.co.mgevents.app',
  appName: 'MG App',
  webDir: 'dist',
  ios: {
    // The app's light background, so there's no white flash before the web view paints.
    backgroundColor: '#F7F7F7',
    // index.html has no `viewport-fit=cover`, so the pages' env(safe-area-inset-*) padding is zero here.
    // Until that changes, keep the web view clear of the status bar and home indicator.
    contentInset: 'always',
  },
};

export default config;
