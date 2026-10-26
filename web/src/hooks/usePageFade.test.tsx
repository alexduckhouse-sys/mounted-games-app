import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { expect, it, vi } from 'vitest';
import { PAGE_FADE_MS, usePageFade } from './usePageFade';

function element() {
  const node = document.createElement('main');
  const animate = vi.fn();
  Object.assign(node, { animate });
  return { ref: { current: node }, animate };
}

it('fades the page in when the page changes, but not when it first shows', () => {
  const { ref, animate } = element();
  const { rerender } = renderHook(({ page }) => usePageFade(ref, page), { initialProps: { page: '/events' } });
  expect(animate).not.toHaveBeenCalled();
  rerender({ page: '/events' });
  expect(animate).not.toHaveBeenCalled();
  rerender({ page: '/settings' });
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate).toHaveBeenCalledWith([{ opacity: 0.4 }, { opacity: 1 }], expect.objectContaining({ duration: PAGE_FADE_MS }));
});

it('stays still in lite mode or with reduced motion, and copes with no element or no animation support', () => {
  const { ref, animate } = element();
  const still = ({ children }: { children: ReactNode }) => <MotionConfig reducedMotion="always">{children}</MotionConfig>;
  const quiet = renderHook(({ page }) => usePageFade(ref, page), { initialProps: { page: '/a' }, wrapper: still });
  quiet.rerender({ page: '/b' });
  expect(animate).not.toHaveBeenCalled();

  const empty = renderHook(({ page }) => usePageFade({ current: null }, page), { initialProps: { page: '/a' } });
  expect(() => empty.rerender({ page: '/b' })).not.toThrow();
  const old = renderHook(({ page }) => usePageFade({ current: document.createElement('main') }, page), { initialProps: { page: '/a' } });
  expect(() => old.rerender({ page: '/b' })).not.toThrow();
});
