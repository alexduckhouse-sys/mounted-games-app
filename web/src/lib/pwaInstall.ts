/**
 * Working out whether, and how, this browser can put the app on the Home Screen.
 *
 * - Chromium (Android, desktop Chrome and Edge) fires `beforeinstallprompt`; we keep that event and show its prompt
 *   from our own Install button.
 * - Safari on iPhone and iPad has no prompt: people add it from the Share menu. iPadOS asks for desktop pages, so an
 *   iPad says "Macintosh" and is told apart by its touch screen.
 * - Other browsers on iPhone (Chrome, Firefox, in-app browsers in Instagram, Facebook and so on) can't always do it,
 *   so we send people to Safari, which always can.
 *
 * Web push only reaches an iPhone once the app has been opened from the Home Screen, which is why the
 * notification switches send iPhone users here first.
 */

/** The `beforeinstallprompt` event Chromium fires when the app can be installed. Not in the DOM typings yet. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/**
 * How this browser installs the app:
 * - `installed`: already running from the Home Screen (or just installed);
 * - `prompt`: Chromium has offered an install prompt we can show;
 * - `ios-safari`: Safari on an iPhone or iPad (Share, then Add to Home Screen);
 * - `ios-other`: another browser on an iPhone or iPad (open the page in Safari);
 * - `none`: nothing we can offer.
 */
export type InstallWay = 'installed' | 'prompt' | 'ios-safari' | 'ios-other' | 'none';

interface DeviceInfo {
  userAgent: string;
  maxTouchPoints: number;
}

function device(): DeviceInfo {
  if (typeof navigator === 'undefined') return { userAgent: '', maxTouchPoints: 0 };
  return { userAgent: navigator.userAgent ?? '', maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}

/** True on an iPhone, iPod or iPad, including an iPad asking for desktop pages (it says Macintosh but has touch). */
export function isIosDevice(info: DeviceInfo = device()): boolean {
  if (/iPhone|iPad|iPod/.test(info.userAgent)) return true;
  return /Macintosh/.test(info.userAgent) && info.maxTouchPoints > 1;
}

// Browsers and in-app web views on iOS that aren't Safari, even though most of them also say "Safari" somewhere.
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|GSA\/|DuckDuckGo|Brave|FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Snapchat|Twitter|MicroMessenger|TikTok|musical_ly|Pinterest|WhatsApp/;

/** True for Safari itself on an iPhone or iPad: the one browser there that can always add to the Home Screen. */
export function isIosSafari(info: DeviceInfo = device()): boolean {
  if (!isIosDevice(info)) return false;
  // Safari says "Version/x … Safari/y". In-app web views usually leave both out.
  return /Version\/[\d.]+/.test(info.userAgent) && /Safari\//.test(info.userAgent) && !NOT_SAFARI.test(info.userAgent);
}

/** True on an Android phone or tablet. */
export function isAndroid(info: DeviceInfo = device()): boolean {
  return /Android/i.test(info.userAgent);
}

/** True when the app is running from the Home Screen (or as an installed desktop app) rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch { /* old browsers without matchMedia queries for display-mode */ }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** True on an iPhone or iPad that hasn't put the app on its Home Screen, so notifications can't reach it yet. */
export function needsHomeScreenForPush(info: DeviceInfo = device()): boolean {
  return isIosDevice(info) && !isStandalone();
}

/** Picks the way to install from what we know: installed, a waiting prompt, or the device. */
export function installWay(state: { installed: boolean; canPrompt: boolean }, info: DeviceInfo = device()): InstallWay {
  if (state.installed || isStandalone()) return 'installed';
  if (state.canPrompt) return 'prompt';
  if (isIosDevice(info)) return isIosSafari(info) ? 'ios-safari' : 'ios-other';
  return 'none';
}
