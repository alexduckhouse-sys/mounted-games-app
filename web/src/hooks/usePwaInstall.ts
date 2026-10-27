import { useCallback, useSyncExternalStore } from 'react';
import { installWay, isAndroid, isIosDevice, type BeforeInstallPromptEvent, type InstallWay } from '../lib/pwaInstall';

/** What `promptInstall()` ended with. `unavailable` means there was no prompt to show. */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface InstallState { deferred: BeforeInstallPromptEvent | null; installed: boolean }

// One copy for the whole app: Chromium fires `beforeinstallprompt` once, often before the page that wants it mounts.
let state: InstallState = { deferred: null, installed: false };
let listening = false;
const subscribers = new Set<() => void>();

function set(next: Partial<InstallState>) {
  state = { ...state, ...next };
  subscribers.forEach((notify) => notify());
}

function onBeforeInstallPrompt(event: Event) {
  // Keep Chromium's own mini bar away; we offer it from Settings and the install card instead.
  event.preventDefault();
  set({ deferred: event as BeforeInstallPromptEvent });
}

function onAppInstalled() {
  set({ deferred: null, installed: true });
}

/** Starts listening for Chromium's install prompt and for the app being installed. Safe to call more than once. */
export function listenForInstall(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
}

/** Stops listening and forgets any prompt. For tests. */
export function resetInstallState(): void {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.removeEventListener('appinstalled', onAppInstalled);
  listening = false;
  state = { deferred: null, installed: false };
  subscribers.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listenForInstall();
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}

const snapshot = () => state;

/**
 * Whether and how this browser can install the app, plus `promptInstall()` for Chromium's prompt.
 * `way` is `installed` once running from the Home Screen; `phone` is true on iPhones, iPads and Android.
 */
export function usePwaInstall() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const way: InstallWay = installWay({ installed: current.installed, canPrompt: current.deferred != null });

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const event = state.deferred;
    if (!event) return 'unavailable';
    // A prompt can only be shown once; Chromium fires a fresh event if the person says no and may ask again later.
    set({ deferred: null });
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === 'accepted') set({ installed: true });
      return outcome;
    } catch {
      return 'unavailable';
    }
  }, []);

  return { way, phone: isIosDevice() || isAndroid(), promptInstall };
}
