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
