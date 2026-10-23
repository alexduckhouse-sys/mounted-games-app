import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSponsorRotation } from './useSponsorRotation';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe('useSponsorRotation', () => {
  it('moves to the next sponsor on the clock', () => {
    const { result } = renderHook(() => useSponsorRotation(3, 8_000, { count: 0, at: 0 }));
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(8_100); });
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersByTime(8_000); });
    expect(result.current).toBe(2);
    act(() => { vi.advanceTimersByTime(8_000); });
    expect(result.current).toBe(0);
  });

  it('shows nobody when there are no sponsors, and starts no timer', () => {
    const { result } = renderHook(() => useSponsorRotation(0, 8_000, { count: 0, at: 0 }));
    expect(result.current).toBe(-1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips on a new instruction but not on one that came before it mounted', () => {
    vi.setSystemTime(10_000);
    const { result, rerender } = renderHook(({ skip }) => useSponsorRotation(3, 8_000, skip), { initialProps: { skip: { count: 4, at: 500 } } });
    expect(result.current).toBe(1);
    vi.setSystemTime(12_000);
    rerender({ skip: { count: 5, at: 12_000 } });
    expect(result.current).toBe(2);
    act(() => { vi.advanceTimersByTime(7_000); });
    expect(result.current).toBe(2);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current).toBe(0);
  });
});
