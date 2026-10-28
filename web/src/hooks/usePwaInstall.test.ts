import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeDevice, installPromptEvent, resetDevice, UA } from '../test/device';
import { listenForInstall, resetInstallState, usePwaInstall } from './usePwaInstall';

afterEach(() => {
  resetInstallState();
  resetDevice();
});

describe('usePwaInstall', () => {
  it('offers nothing on a desktop browser until Chromium sends its prompt', () => {
    fakeDevice({ userAgent: UA.desktopChrome });
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current).toMatchObject({ way: 'none', phone: false });
    const event = installPromptEvent();
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.way).toBe('prompt');
  });

  it('keeps a prompt that arrived before any page asked for it', () => {
    fakeDevice({ userAgent: UA.android });
    listenForInstall();
    listenForInstall();
    window.dispatchEvent(installPromptEvent());
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current).toMatchObject({ way: 'prompt', phone: true });
  });

  it('shows the prompt and counts the app as installed when accepted', async () => {
    fakeDevice({ userAgent: UA.android });
    const { result } = renderHook(() => usePwaInstall());
    const event = installPromptEvent('accepted');
    act(() => { window.dispatchEvent(event); });
    let outcome = '';
    await act(async () => { outcome = await result.current.promptInstall(); });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('accepted');
    expect(result.current.way).toBe('installed');
  });

  it('drops a used prompt when it is turned down', async () => {
    fakeDevice({ userAgent: UA.android });
    const { result } = renderHook(() => usePwaInstall());
    act(() => { window.dispatchEvent(installPromptEvent('dismissed')); });
    let outcome = '';
    await act(async () => { outcome = await result.current.promptInstall(); });
    expect(outcome).toBe('dismissed');
    expect(result.current.way).toBe('none');
    await act(async () => { outcome = await result.current.promptInstall(); });
    expect(outcome).toBe('unavailable');
  });

  it('reports unavailable when the prompt fails', async () => {
    fakeDevice({ userAgent: UA.android });
    const { result } = renderHook(() => usePwaInstall());
    const event = installPromptEvent();
    event.prompt.mockRejectedValue(new Error('already shown'));
    act(() => { window.dispatchEvent(event); });
    let outcome = '';
    await act(async () => { outcome = await result.current.promptInstall(); });
    expect(outcome).toBe('unavailable');
  });

  it('notices the app being installed from the browser menu', () => {
    fakeDevice({ userAgent: UA.android });
    const { result } = renderHook(() => usePwaInstall());
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(result.current.way).toBe('installed');
  });

  it('gives Safari on an iPhone the Home Screen steps, and other iPhone browsers Safari', () => {
    fakeDevice({ userAgent: UA.iphoneSafari });
    expect(renderHook(() => usePwaInstall()).result.current).toMatchObject({ way: 'ios-safari', phone: true });
    fakeDevice({ userAgent: UA.iphoneChrome });
    expect(renderHook(() => usePwaInstall()).result.current.way).toBe('ios-other');
  });

  it('is installed when opened from the Home Screen', () => {
    fakeDevice({ userAgent: UA.iphoneSafari, iosStandalone: true });
    expect(renderHook(() => usePwaInstall()).result.current.way).toBe('installed');
  });

  it('stops listening once unmounted', () => {
    fakeDevice({ userAgent: UA.desktopChrome });
    const { result, unmount } = renderHook(() => usePwaInstall());
    unmount();
    window.dispatchEvent(installPromptEvent());
    expect(result.current.way).toBe('none');
  });
});
