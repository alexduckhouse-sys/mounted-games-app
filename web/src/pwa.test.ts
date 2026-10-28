import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPendingUpdate, registerPwa, reloadOnceForChunkFailure, setBroadcasting } from './pwa';

type Options = { onNeedRefresh: () => void; onOfflineReady: () => void; onRegisteredSW: (url: string, registration?: unknown) => void };
const registerSW = vi.hoisted(() => vi.fn());
vi.mock('virtual:pwa-register', () => ({ registerSW }));

let options: Options;
const updateSW = vi.fn();

beforeEach(() => {
  registerSW.mockImplementation((given: Options) => { options = given; return updateSW; });
  setBroadcasting(false);
  registerPwa();
});

describe('registerPwa', () => {
  it('registers the service worker once', () => {
    expect(registerSW).toHaveBeenCalledTimes(1);
  });

  it('does not reload under the user when an update is waiting', () => {
    options.onNeedRefresh();
    expect(updateSW).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(applyPendingUpdate()).toBe(true);
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(applyPendingUpdate()).toBe(false);
  });

  it('applies the update at the next in-app route change', () => {
    options.onNeedRefresh();
    history.pushState({}, '', '/somewhere');
    expect(updateSW).toHaveBeenCalledTimes(1);
    updateSW.mockClear();
    options.onNeedRefresh();
    history.replaceState({}, '', '/elsewhere');
    expect(updateSW).toHaveBeenCalledTimes(1);
    updateSW.mockClear();
    options.onNeedRefresh();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(updateSW).toHaveBeenCalledTimes(1);
  });

  it('applies the update when the tab is hidden, not when it is shown', () => {
    options.onNeedRefresh();
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(updateSW).not.toHaveBeenCalled();
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(updateSW).toHaveBeenCalledTimes(1);
    state.mockRestore();
  });

  it('remembers that the app is ready to work offline', () => {
    options.onOfflineReady();
    expect(localStorage.getItem('mg.pwa.offlineReady')).toBe('1');
  });

  it('carries on when the offline flag cannot be stored', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => options.onOfflineReady()).not.toThrow();
  });

  it('accepts the registration callback without doing anything yet', () => {
    expect(() => options.onRegisteredSW('/sw.js', {})).not.toThrow();
  });
});

it('holds the update back while broadcasting, then applies it at the next safe moment', () => {
  setBroadcasting(true);
  options.onNeedRefresh();
  history.pushState({}, '', '/live');
  expect(updateSW).not.toHaveBeenCalled();
  setBroadcasting(false);
  history.pushState({}, '', '/after');
  expect(updateSW).toHaveBeenCalledWith(true);
});

describe('chunk load failures', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('reloads once onto the new version on a preload error, then not again', () => {
    options.onNeedRefresh(); // gives the page its update hook
    updateSW.mockClear();
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(updateSW).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(updateSW).toHaveBeenCalledTimes(1);
  });

  it('reloads the page directly when no update is waiting', async () => {
    vi.resetModules();
    const fresh = await import('./pwa');
    const reload = vi.fn();
    expect(fresh.reloadOnceForChunkFailure(reload)).toBe(true);
    expect(fresh.reloadOnceForChunkFailure(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const reload = vi.fn();
    expect(reloadOnceForChunkFailure(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('treats a rejected dynamic import as a chunk failure and ignores other rejections', () => {
    options.onNeedRefresh();
    updateSW.mockClear();
    const reject = (reason: unknown) => {
      const e = new Event('unhandledrejection') as Event & { reason: unknown };
      e.reason = reason;
      window.dispatchEvent(e);
    };
    reject(new Error('network down'));
    reject(undefined);
    expect(updateSW).not.toHaveBeenCalled();
    reject(new Error('Failed to fetch dynamically imported module: /assets/x.js'));
    expect(updateSW).toHaveBeenCalledTimes(1);
    reject('error loading dynamically imported module');
    expect(updateSW).toHaveBeenCalledTimes(1);
  });
});

it('registers no service worker inside the iPhone app', async () => {
  vi.resetModules();
  vi.doMock('./native/platform', () => ({ isNativeApp: () => true }));
  registerSW.mockClear();
  const { registerPwa: registerInApp } = await import('./pwa');
  registerInApp();
  expect(registerSW).not.toHaveBeenCalled();
  vi.doUnmock('./native/platform');
});
