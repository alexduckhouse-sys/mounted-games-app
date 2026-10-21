import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLiteMode } from './LiteModeContext';
import { installConnection, liteWrapper, removeConnection } from '../test/lite';

afterEach(removeConnection);

const mount = (saved?: 'auto' | 'on' | 'off') => renderHook(() => useLiteMode(), { wrapper: liteWrapper(saved) });

describe('LiteModeProvider', () => {
  it('is off by default when the browser has no connection API', () => {
    const { result } = mount();
    expect(result.current).toMatchObject({ lite: false, setting: 'auto', reason: null });
    expect(document.documentElement.dataset.lite).toBeUndefined();
  });

  it('is off on a fast connection', () => {
    installConnection({ effectiveType: '4g', rtt: 50 });
    expect(mount().result.current.lite).toBe(false);
  });

  it.each([
    ['Data Saver', { saveData: true }, 'data-saver'],
    ['slow-2g', { effectiveType: 'slow-2g' }, 'slow-connection'],
    ['2g', { effectiveType: '2g' }, 'slow-connection'],
    ['3g with a long round trip', { effectiveType: '3g', rtt: 800 }, 'slow-connection'],
  ] as const)('turns on in Auto for %s', (_name, init, reason) => {
    installConnection(init);
    const { result } = mount();
    expect(result.current).toMatchObject({ lite: true, setting: 'auto', reason });
    expect(document.documentElement.dataset.lite).toBe('true');
  });

  it('stays off in Auto for 3g with a short round trip', () => {
    installConnection({ effectiveType: '3g', rtt: 300 });
    expect(mount().result.current.lite).toBe(false);
  });

  it('follows connection change events in Auto', () => {
    const connection = installConnection({ effectiveType: '4g' });
    const { result } = mount();
    expect(result.current.lite).toBe(false);
    act(() => connection.update({ effectiveType: '2g' }));
    expect(result.current).toMatchObject({ lite: true, reason: 'slow-connection' });
    expect(document.documentElement.dataset.lite).toBe('true');
    act(() => connection.update({ effectiveType: '4g' }));
    expect(result.current.lite).toBe(false);
    expect(document.documentElement.dataset.lite).toBeUndefined();
  });

  it('stops listening when it unmounts', () => {
    const connection = installConnection();
    const remove = vi.spyOn(connection, 'removeEventListener');
    mount().unmount();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('forces lite mode On whatever the connection says', () => {
    installConnection({ effectiveType: '4g' });
    const { result } = mount('on');
    expect(result.current).toMatchObject({ lite: true, setting: 'on', reason: 'chosen' });
  });

  it('forces lite mode Off even on a slow connection', () => {
    installConnection({ saveData: true });
    const { result } = mount('off');
    expect(result.current).toMatchObject({ lite: false, setting: 'off', reason: null });
  });

  it('saves the choice and restores it next time', () => {
    const { result, unmount } = mount();
    act(() => result.current.setSetting('on'));
    expect(result.current.lite).toBe(true);
    expect(localStorage.getItem('mg.liteMode')).toBe('on');
    unmount();
    expect(mount().result.current).toMatchObject({ setting: 'on', lite: true });
  });

  it('still switches when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useLiteMode(), { wrapper: liteWrapper() });
    expect(result.current.setting).toBe('auto');
    act(() => result.current.setSetting('on'));
    expect(result.current).toMatchObject({ setting: 'on', lite: true });
  });

  it('clears the page flag when it unmounts', () => {
    const { unmount } = mount('on');
    expect(document.documentElement.dataset.lite).toBe('true');
    unmount();
    expect(document.documentElement.dataset.lite).toBeUndefined();
  });
});

describe('useLiteMode without a provider', () => {
  it('reports normal mode and ignores changes', () => {
    const { result } = renderHook(() => useLiteMode());
    expect(result.current).toMatchObject({ lite: false, setting: 'auto', reason: null });
    expect(() => result.current.setSetting('on')).not.toThrow();
    expect(result.current.lite).toBe(false);
  });
});
