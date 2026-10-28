import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVEAL_MS, useReveal } from './useReveal';

const still = vi.hoisted(() => ({ value: false }));
vi.mock('../lite/useStillMotion', () => ({ useStillMotion: () => still.value }));

describe('useReveal', () => {
  beforeEach(() => { vi.useFakeTimers(); still.value = false; });
  afterEach(() => { vi.useRealTimers(); });

  it('mounts at once when opened and keeps the panel until it has folded away', () => {
    const { result, rerender } = renderHook(({ open }) => useReveal(open), { initialProps: { open: false } });
    expect(result.current).toEqual({ mounted: false, leaving: false });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, leaving: false });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, leaving: true });
    act(() => { vi.advanceTimersByTime(REVEAL_MS + 1); });
    expect(result.current).toEqual({ mounted: false, leaving: false });
  });

  it('stays if it is opened again while folding', () => {
    const { result, rerender } = renderHook(({ open }) => useReveal(open), { initialProps: { open: true } });
    rerender({ open: false });
    rerender({ open: true });
    act(() => { vi.advanceTimersByTime(REVEAL_MS * 2); });
    expect(result.current).toEqual({ mounted: true, leaving: false });
  });

  it('goes at once with reduced motion', () => {
    still.value = true;
    const { result, rerender } = renderHook(({ open }) => useReveal(open), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: false, leaving: false });
  });
});
