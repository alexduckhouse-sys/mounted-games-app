import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import * as framerMotion from 'framer-motion';
import { MotionConfig } from 'framer-motion';
import { useStillMotion } from './useStillMotion';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: vi.fn() };
});

beforeEach(() => { vi.mocked(framerMotion.useReducedMotion).mockReturnValue(false); });

const within = (reducedMotion: 'always' | 'user') => ({ children }: { children: ReactNode }) => <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>;

it('moves by default, and stills for lite mode or the device setting', () => {
  expect(renderHook(() => useStillMotion()).result.current).toBe(false);
  expect(renderHook(() => useStillMotion(), { wrapper: within('user') }).result.current).toBe(false);
  expect(renderHook(() => useStillMotion(), { wrapper: within('always') }).result.current).toBe(true);
  vi.mocked(framerMotion.useReducedMotion).mockReturnValue(true);
  expect(renderHook(() => useStillMotion()).result.current).toBe(true);
  expect(renderHook(() => useStillMotion(), { wrapper: within('user') }).result.current).toBe(true);
});
