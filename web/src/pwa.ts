/**
 * Service-worker registration. A new version applies by itself: as soon as one is waiting, the page asks it to
 * skip waiting and reloads onto it (the worker already claims clients on activation). Asking the user to reload
 * could be answered with the old index.html from the waiting worker, so the tab kept loading deleted chunks.
 * While a broadcast is running the swap is held back until it ends.
 */
import { registerSW } from 'virtual:pwa-register';
import { isNativeApp } from './native/platform';

let broadcasting = false;
let applyUpdate: (() => void) | null = null;
let updatePending = false;

export function setBroadcasting(value: boolean): void {
  broadcasting = value;
  if (!value && updatePending) {
    updatePending = false;
    applyUpdate?.();
  }
}

const RELOAD_KEY = 'mg.pwa.chunkReload';
const RELOAD_GUARD_MS = 30_000;

/** Reloads once onto the new build after a lazy chunk failed to load. Returns false if it already did so recently. */
export function reloadOnceForChunkFailure(reload: () => void = () => window.location.reload()): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false;
    sessionStorage.setItem(RELOAD_KEY, '1');
  } catch {
    // Without session storage a loop can't be ruled out, so don't reload.
    return false;
  }
  // If the tab is still running after a while, the reload worked: allow one more for a later deploy.
  setTimeout(() => { try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ } }, RELOAD_GUARD_MS);
  if (applyUpdate) applyUpdate(); else reload();
  return true;
}

const CHUNK_FAILURE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

function watchChunkFailures(): void {
  // Vite raises this when a lazy chunk or its CSS can't be fetched (the chunk is gone after a deploy).
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnceForChunkFailure();
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string } | string | undefined;
    const message = typeof reason === 'string' ? reason : reason?.message ?? '';
    if (CHUNK_FAILURE.test(message)) reloadOnceForChunkFailure();
  });
}

export function registerPwa(): void {
  // The iPhone app ships the build inside itself and updates with each app release, so it runs no
  // service worker (and WKWebView doesn't offer one for the app's own origin anyway).
  if (isNativeApp()) return;
  watchChunkFailures();
  const updateSW = registerSW({
    onNeedRefresh() {
      // A new build is waiting in the worker: activate it and reload, unless a broadcast is running.
      applyUpdate = () => { void updateSW(true); };
      if (broadcasting) { updatePending = true; return; }
      applyUpdate();
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
