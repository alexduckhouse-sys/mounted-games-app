import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

describe('useWakeLock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  });

  it('does nothing when disabled or when wakeLock is not supported', () => {
    const { unmount: unmountDisabled } = renderHook(() => useWakeLock(false));
    unmountDisabled();

    const { unmount: unmountUnsupported } = renderHook(() => useWakeLock());
    unmountUnsupported();
  });

  it('requests a screen wake lock on mount, re-acquires on visibilitychange, and releases on unmount', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const sentinel = { released: false, release };
    const request = vi.fn().mockResolvedValue(sentinel);
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
    });

    const { unmount } = renderHook(() => useWakeLock(true));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    await Promise.resolve();

    // Firing visibilitychange while still visible and unreleased does not duplicate request
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(1);

    // Tab goes hidden then visible again -> re-acquires wake lock
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(2);
    await Promise.resolve();

    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the lock immediately if the component unmounts before request resolves', async () => {
    let resolveLock!: (val: { release: () => Promise<void> }) => void;
    const release = vi.fn().mockRejectedValue(new Error('already released'));
    const request = vi.fn().mockImplementation(
      () => new Promise<{ release: () => Promise<void> }>((res) => { resolveLock = res; }),
    );
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
    });

    const { unmount } = renderHook(() => useWakeLock(true));
    expect(request).toHaveBeenCalledTimes(1);
    unmount();

    resolveLock({ release });
    await Promise.resolve();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('swallows rejection when wakeLock.request fails or tab is hidden', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
    });

    const { unmount } = renderHook(() => useWakeLock(true));
    await Promise.resolve();
    unmount();
    expect(request).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const { unmount: unmountHidden } = renderHook(() => useWakeLock(true));
    expect(request).toHaveBeenCalledTimes(1);
    unmountHidden();
  });
});
