import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

it('moves on with the clock and stops when it goes', () => {
  const { result, unmount } = renderHook(() => useNow(15_000));
  expect(result.current.toISOString()).toBe('2026-10-26T10:00:00.000Z');
  act(() => { vi.advanceTimersByTime(15_000); });
  expect(result.current.toISOString()).toBe('2026-10-26T10:00:15.000Z');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('shares one timer between heat rows and keeps it until the last subscriber leaves', () => {
  const first = renderHook(() => useNow(15_000));
  const second = renderHook(() => useNow(15_000));
  expect(vi.getTimerCount()).toBe(1);
  act(() => { vi.advanceTimersByTime(15_000); });
  expect(first.result.current).toEqual(second.result.current);
  first.unmount();
  expect(vi.getTimerCount()).toBe(1);
  act(() => { vi.advanceTimersByTime(15_000); });
  expect(second.result.current.toISOString()).toBe('2026-10-26T10:00:30.000Z');
  second.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops ticking in a hidden tab and resynchronises when visible', () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  const { result, unmount } = renderHook(() => useNow(15_000));
  try {
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(60_000); });
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.toISOString()).toBe('2026-10-26T10:01:00.000Z');
    expect(vi.getTimerCount()).toBe(1);
  } finally {
    unmount();
    if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor);
    else Reflect.deleteProperty(document, 'visibilityState');
  }
});
