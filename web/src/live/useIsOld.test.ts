import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_SAVED_COPY_NOTICE_AFTER_MS as LIMIT } from '../offline/savedCopies';
import { useIsOld } from './useIsOld';

const NOW = new Date('2026-10-21T12:00:00Z').getTime();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('useIsOld', () => {
  it('stays false for recent data, then turns true by itself once it is old enough to mention', () => {
    const { result } = renderHook(() => useIsOld(new Date(NOW - 60_000)));
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(LIMIT - 60_000 - 1); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it('is true straight away for data that was already old', () => {
    const { result } = renderHook(() => useIsOld(new Date(NOW - LIMIT - 1)));
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current).toBe(true);
  });

  it('takes a date string or a number and an own limit', () => {
    const text = renderHook(() => useIsOld(new Date(NOW - 5_000).toISOString(), 1_000));
    act(() => { vi.advanceTimersByTime(0); });
    expect(text.result.current).toBe(true);
    const number = renderHook(() => useIsOld(NOW, 10_000));
    expect(number.result.current).toBe(false);
  });

  it('counts an unknown or unreadable time as old', () => {
    expect(renderHook(() => useIsOld(null)).result.current).toBe(true);
    expect(renderHook(() => useIsOld(undefined)).result.current).toBe(true);
    expect(renderHook(() => useIsOld('')).result.current).toBe(true);
    expect(renderHook(() => useIsOld('nonsense')).result.current).toBe(true);
  });

  it('starts again when newer data arrives', () => {
    const { result, rerender } = renderHook(({ at }) => useIsOld(at), { initialProps: { at: new Date(NOW - LIMIT) } });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current).toBe(true);
    rerender({ at: new Date(NOW) });
    expect(result.current).toBe(false);
  });
});
