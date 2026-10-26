import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPwa, setBroadcasting } from './pwa';

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

  it('reloads into the new version when the user accepts the prompt', async () => {
    options.onNeedRefresh();
    const dialog = await screen.findByRole('alertdialog', { name: 'Update ready' });
    expect(dialog).toHaveTextContent('A new version of the app is ready.');
    await userEvent.click(screen.getByRole('button', { name: 'Reload now' }));
    await waitFor(() => expect(updateSW).toHaveBeenCalledWith(true));
  });

  it('leaves the new version waiting when the user declines', async () => {
    options.onNeedRefresh();
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
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

it('defers the update prompt and reload while broadcasting', async () => {
  setBroadcasting(true);
  options.onNeedRefresh();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(updateSW).not.toHaveBeenCalled();
  setBroadcasting(false);
  options.onNeedRefresh();
  await userEvent.click(await screen.findByRole('button', { name: 'Reload now' }));
  await waitFor(() => expect(updateSW).toHaveBeenCalledWith(true));
});
