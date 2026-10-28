/**
 * Service-worker registration with an in-app "new version" prompt so the user
 * can refresh without manually clearing cache. Falls back to silent update on
 * the next navigation if they ignore it.
 */
import { registerSW } from 'virtual:pwa-register';
import { confirmDialog } from './components/ConfirmDialog';
import { isNativeApp } from './native/platform';

let broadcasting = false;
export function setBroadcasting(value: boolean): void { broadcasting = value; }

export function registerPwa(): void {
  // The iPhone app ships the build inside itself and updates with each app release, so it runs no
  // service worker (and WKWebView doesn't offer one for the app's own origin anyway).
  if (isNativeApp()) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      if (broadcasting) return;
      // A new build is waiting in the worker. Ask once; reload on accept.
      void confirmDialog({ title: 'Update ready', message: 'A new version of the app is ready.', confirmLabel: 'Reload now', cancelLabel: 'Not now' }).then((reload) => {
        if (reload) updateSW(true);
      });
    },
    onOfflineReady() {
      // Stash a flag so the UI can show a "you're good offline" toast if we
      // wire one in later. For now this is a no-op.
      try { localStorage.setItem('mg.pwa.offlineReady', '1'); } catch { /* quota */ }
    },
    onRegisteredSW() {
      // Hook used later by background-push subscription wiring.
    },
  });
}
