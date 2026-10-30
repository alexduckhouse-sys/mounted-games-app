import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useRefreshWaiters } from './useRefreshWaiters';

it('hands every waiter the next outcome, once, and keeps the same functions across renders', async () => {
  const { result, rerender } = renderHook(() => useRefreshWaiters());
  const first = result.current;
  expect(first.pending()).toBe(false);
  const a = first.wait();
  const b = first.wait();
  expect(first.pending()).toBe(true);
  first.settle('same');
  expect(first.pending()).toBe(false);
  await expect(a).resolves.toBe('same');
  await expect(b).resolves.toBe('same');
  const c = first.wait();
  first.settle('failed');
  first.settle('updated');
  await expect(c).resolves.toBe('failed');
  rerender();
  expect(result.current).toBe(first);
});
