import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsDesktop, useMediaQuery } from './useMediaQuery';

function stubMatchMedia(initial: boolean) {
  let listener: (() => void) | null = null;
  const list = {
    matches: initial,
    addEventListener: vi.fn((_: string, fn: () => void) => { listener = fn; }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => list));
  return { list, fire: (value: boolean) => { list.matches = value; listener?.(); } };
}

describe('useMediaQuery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => useMediaQuery('(min-width: 10px)')).result.current).toBe(false);
  });

  it('reads the query and follows changes', () => {
    const media = stubMatchMedia(true);
    const { result, unmount } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
    act(() => media.fire(false));
    expect(result.current).toBe(false);
    unmount();
    expect(media.list.removeEventListener).toHaveBeenCalled();
  });
});
