/**
 * Service-worker registration. A new version applies by itself, but never under someone's hands: once one is waiting,
 * the page asks it to skip waiting and reloads onto it (the worker already claims clients on activation) at the next
 * in-app navigation or when the tab is hidden, whichever comes first. Asking the user to reload could be answered
 * with the old index.html from the waiting worker, so the tab kept loading deleted chunks. While a broadcast is
 * running the swap is held back.
 */
import { registerSW } from 'virtual:pwa-register';
import { isNativeApp } from './native/platform';

let broadcasting = false;
let applyUpdate: (() => void) | null = null;
let updatePending = false;

export function setBroadcasting(value: boolean): void {
  broadcasting = value;
}

/** Applies a waiting update if one is queued and it is safe to reload (called on navigation and when the tab hides). */
export function applyPendingUpdate(): boolean {
  if (!updatePending || broadcasting || !applyUpdate) return false;
  updatePending = false;
  applyUpdate();
  return true;
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
  updatePending = false;
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

function watchSafeMoments(): void {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') applyPendingUpdate(); });
  window.addEventListener('popstate', () => { applyPendingUpdate(); });
  // The router changes pages with history.pushState/replaceState; the page has just changed when they return.
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History['pushState']>) => { original(...args); applyPendingUpdate(); };
  }
}

export function registerPwa(): void {
  // The iPhone app ships the build inside itself and updates with each app release, so it runs no
  // service worker (and WKWebView doesn't offer one for the app's own origin anyway).
  if (isNativeApp()) return;
  watchChunkFailures();
  watchSafeMoments();
  const updateSW = registerSW({
    onNeedRefresh() {
      // A new build is waiting in the worker: activate it and reload at the next safe moment.
      applyUpdate = () => { void updateSW(true); };
      updatePending = true;
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
