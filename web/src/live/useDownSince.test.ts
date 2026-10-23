import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDownSince } from './useDownSince';

const START = new Date('2026-10-23T12:00:00Z').getTime();

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useDownSince', () => {
  it('counts from page open until the live link first connects', () => {
    const { result, rerender } = renderHook(({ connected }) => useDownSince(connected), { initialProps: { connected: false } });
    expect(result.current).toEqual({ downSince: START, everConnected: false });
    vi.setSystemTime(START + 2_000);
    rerender({ connected: true });
    expect(result.current).toEqual({ downSince: null, everConnected: true });
  });

  it('starts a new count on each drop and remembers the link has worked', () => {
    const { result, rerender } = renderHook(({ connected }) => useDownSince(connected), { initialProps: { connected: true } });
    expect(result.current).toEqual({ downSince: null, everConnected: true });
    vi.setSystemTime(START + 60_000);
    rerender({ connected: false });
    expect(result.current).toEqual({ downSince: START + 60_000, everConnected: true });
    rerender({ connected: false });
    expect(result.current.downSince).toBe(START + 60_000);
  });

  it('starts the count again when the app comes back to the front while the link is down', () => {
    const { result } = renderHook(() => useDownSince(false));
    vi.setSystemTime(START + 120_000);
    visibility('hidden');
    expect(result.current.downSince).toBe(START);
    visibility('visible');
    expect(result.current.downSince).toBe(START + 120_000);
  });

  it('ignores the app coming back to the front while the link is up', () => {
    const { result } = renderHook(() => useDownSince(true));
    visibility('visible');
    expect(result.current).toEqual({ downSince: null, everConnected: true });
  });
});
