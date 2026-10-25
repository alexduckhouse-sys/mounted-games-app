import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { EXIT_MS, useExitDelay } from './useExitDelay';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('marks itself closing, then calls through once the leave animation has run', () => {
  const done = vi.fn();
  const { result } = renderHook(() => useExitDelay(done));
  expect(result.current.closing).toBe(false);
  act(() => result.current.close('visit'));
  expect(result.current.closing).toBe(true);
  act(() => result.current.close('remember'));
  act(() => { vi.advanceTimersByTime(EXIT_MS - 1); });
  expect(done).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(done).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledWith('visit');
});

it('closes at once when motion is stilled, and leaves no timer behind on unmount', () => {
  const done = vi.fn();
  const still = ({ children }: { children: ReactNode }) => <MotionConfig reducedMotion="always">{children}</MotionConfig>;
  const { result } = renderHook(() => useExitDelay(done), { wrapper: still });
  act(() => result.current.close());
  expect(done).toHaveBeenCalledTimes(1);
  expect(result.current.closing).toBe(false);
  const moving = renderHook(() => useExitDelay(done));
  act(() => moving.result.current.close());
  moving.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
