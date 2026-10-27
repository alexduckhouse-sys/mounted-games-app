// Unused in web UI yet — reserved for iOS / upcoming wiring
import { useEffect } from 'react';

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

/**
 * Keeps the screen awake while an official is scoring, managing an arena or filming.
 * Re-acquires the lock when the tab becomes visible again and releases it cleanly on unmount.
 */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const nav = navigator as unknown as NavigatorWithWakeLock;
    if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') return;

    let active = true;
    let sentinel: WakeLockSentinelLike | null = null;

    async function acquire() {
      if (!active || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const lock = await nav.wakeLock!.request('screen');
        if (!active) {
          await lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
      } catch {
        // Unsupported, low battery, or denied by browser policy — ignore safely.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void acquire();
      } else {
        sentinel = null;
      }
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const current = sentinel;
      sentinel = null;
      if (current) {
        void current.release().catch(() => undefined);
      }
    };
  }, [enabled]);
}
