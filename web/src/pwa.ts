/**
 * Service-worker registration with an in-app "new version" prompt so the user
 * can refresh without manually clearing cache. Falls back to silent update on
 * the next navigation if they ignore it.
 */
import { registerSW } from 'virtual:pwa-register';

export function registerPwa(): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      // A new build is waiting in the worker. Ask once; reload on accept.
      if (window.confirm('A new version of the app is ready. Reload now?')) {
        updateSW(true);
      }
    },
    onOfflineReady() {
      // Stash a flag so the UI can show a "you're good offline" toast if we
      // wire one in later. For now this is a no-op.
      try { localStorage.setItem('mg.pwa.offlineReady', '1'); } catch { /* quota */ }
    },
    onRegisteredSW(_swUrl, _registration) {
      // Hook used later by background-push subscription wiring.
    },
  });
}
