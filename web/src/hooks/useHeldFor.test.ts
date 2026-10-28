import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHeldFor } from './useHeldFor';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useHeldFor', () => {
  it('turns true only once the state has lasted the whole time', () => {
    const { result } = renderHook(({ on }) => useHeldFor(on, 30_000), { initialProps: { on: true } });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it('starts again after a break, and is false straight away when the state ends', () => {
    const { result, rerender } = renderHook(({ on }) => useHeldFor(on, 30_000), { initialProps: { on: true } });
    act(() => { vi.advanceTimersByTime(20_000); });
    rerender({ on: false });
    expect(result.current).toBe(false);
    rerender({ on: true });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
  });
});
