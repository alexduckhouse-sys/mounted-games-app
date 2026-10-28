import { Capacitor } from '@capacitor/core';

/**
 * True inside the iPhone app (the Capacitor shell), false in any browser, including the installed PWA.
 * The native runtime is injected before the page's scripts run, so this is safe to call at start-up.
 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** True only inside the iPhone app; Live Activities and other iOS-only features check this. */
export function isIosApp(): boolean {
  return isNativeApp() && Capacitor.getPlatform() === 'ios';
}
