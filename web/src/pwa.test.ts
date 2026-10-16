import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPwa } from './pwa';

type Options = { onNeedRefresh: () => void; onOfflineReady: () => void; onRegisteredSW: (url: string, registration?: unknown) => void };
const registerSW = vi.hoisted(() => vi.fn());
vi.mock('virtual:pwa-register', () => ({ registerSW }));

let options: Options;
const updateSW = vi.fn();

beforeEach(() => {
  registerSW.mockImplementation((given: Options) => { options = given; return updateSW; });
  registerPwa();
});

describe('registerPwa', () => {
  it('registers the service worker once', () => {
    expect(registerSW).toHaveBeenCalledTimes(1);
  });

  it('reloads into the new version when the user accepts the prompt', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    options.onNeedRefresh();
    expect(confirm).toHaveBeenCalledWith('A new version of the app is ready. Reload now?');
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('leaves the new version waiting when the user declines', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    options.onNeedRefresh();
    expect(updateSW).not.toHaveBeenCalled();
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
