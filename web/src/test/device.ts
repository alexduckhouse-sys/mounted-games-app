import { vi } from 'vitest';

/** User agents for the install tests. Real shapes, trimmed version numbers. */
export const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/520.0.0.0]',
  // iPadOS asks for desktop pages, so Safari on an iPad looks like a Mac apart from the touch screen.
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
} as const;

interface FakeDevice {
  userAgent: string;
  /** 5 on an iPad; 0 (the default) on a desktop. */
  maxTouchPoints?: number;
  /** `matchMedia('(display-mode: standalone)')` matches, as when opened from the Home Screen. */
  displayStandalone?: boolean;
  /** Safari's own `navigator.standalone`, true when opened from the Home Screen. */
  iosStandalone?: boolean;
}

/** Pretends to be a given phone or browser. Call `resetDevice()` after each test. */
export function fakeDevice({ userAgent, maxTouchPoints = 0, displayStandalone = false, iosStandalone }: FakeDevice): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  // jsdom has no maxTouchPoints, so it is added here and taken away again by resetDevice().
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
  const noop = () => {};
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: displayStandalone && query.includes('standalone'), media: query,
    addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop,
  }));
  if (iosStandalone === undefined) Reflect.deleteProperty(navigator, 'standalone');
  else Object.defineProperty(navigator, 'standalone', { configurable: true, value: iosStandalone });
}

/** Removes what `fakeDevice` added to the navigator (the spies and stubs are restored by the Vitest config). */
export function resetDevice(): void {
  if (!globalThis.navigator) return;
  Reflect.deleteProperty(navigator, 'standalone');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
}

/** A fake `beforeinstallprompt` event whose prompt resolves with the given answer. */
export function installPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}
