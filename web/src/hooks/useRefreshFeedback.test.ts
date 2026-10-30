import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefreshHandler, RefreshOutcome } from '../lib/refreshOutcome';
import { REFRESH_GIVE_UP_MS, REFRESH_MIN_SPIN_MS, REFRESH_RESULT_MS, useRefreshFeedback } from './useRefreshFeedback';

let vibrate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
});
afterEach(() => {
  vi.useRealTimers();
  delete (navigator as { vibrate?: unknown }).vibrate;
});

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const tapOn = (result: { current: { tap: () => void } }) => act(() => { result.current.tap(); });

function deferred() {
  let resolve!: (value: RefreshOutcome | void) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<RefreshOutcome | void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('useRefreshFeedback', () => {
  it('spins for at least a moment, shows the answer, then goes back to the arrow', async () => {
    const onRefresh = vi.fn(() => Promise.resolve<RefreshOutcome>('same'));
    const { result } = renderHook(() => useRefreshFeedback(onRefresh));
    expect(result.current.phase).toBe('idle');
    tapOn(result);
    expect(result.current.phase).toBe('loading');
    await advance(REFRESH_MIN_SPIN_MS - 1);
    expect(result.current.phase).toBe('loading');
    await advance(1);
    expect(result.current.phase).toBe('same');
    expect(vibrate).toHaveBeenCalledWith(12);
    await advance(REFRESH_RESULT_MS);
    expect(result.current.phase).toBe('idle');
  });

  it('keeps spinning until a slow answer arrives, and ignores taps meanwhile', async () => {
    const pending = deferred();
    const onRefresh = vi.fn(() => pending.promise);
    const { result } = renderHook(() => useRefreshFeedback(onRefresh));
    tapOn(result);
    await advance(3_000);
    tapOn(result);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('loading');
    await act(async () => { pending.resolve('updated'); });
    await advance(0);
    expect(result.current.phase).toBe('updated');
  });

  it('counts a promise with no outcome as updated', async () => {
    const { result } = renderHook(() => useRefreshFeedback(() => Promise.resolve()));
    tapOn(result);
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('updated');
  });

  it('gives a plain function one turn of the arrow and no result', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => useRefreshFeedback(onRefresh));
    tapOn(result);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('loading');
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('idle');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('shows a failure when the refresh rejects, throws or never answers', async () => {
    const rejecting = deferred();
    const { result, rerender } = renderHook(({ handler }: { handler: RefreshHandler }) => useRefreshFeedback(handler), { initialProps: { handler: () => rejecting.promise } });
    tapOn(result);
    await act(async () => { rejecting.reject(new Error('boom')); });
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('failed');
    expect(vibrate).toHaveBeenLastCalledWith([20, 60, 20]);
    await advance(REFRESH_RESULT_MS);

    rerender({ handler: () => { throw new Error('sync'); } });
    tapOn(result);
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('failed');
    await advance(REFRESH_RESULT_MS);

    rerender({ handler: () => new Promise<RefreshOutcome>(() => {}) });
    tapOn(result);
    await advance(REFRESH_GIVE_UP_MS - 1);
    expect(result.current.phase).toBe('loading');
    await advance(1);
    expect(result.current.phase).toBe('failed');
  });

  it('buzzes twice for no signal, and carries on if the phone refuses to buzz', async () => {
    vibrate.mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useRefreshFeedback(() => Promise.resolve<RefreshOutcome>('offline')));
    tapOn(result);
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('offline');
    expect(vibrate).toHaveBeenCalledWith([20, 60, 20]);
  });

  it('works on phones that cannot buzz', async () => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    const { result } = renderHook(() => useRefreshFeedback(() => Promise.resolve<RefreshOutcome>('updated')));
    tapOn(result);
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('updated');
  });

  it('lets a tap during the result start a fresh refresh that the old timer cannot cut short', async () => {
    const onRefresh = vi.fn(() => Promise.resolve<RefreshOutcome>('same'));
    const { result } = renderHook(() => useRefreshFeedback(onRefresh));
    tapOn(result);
    await advance(REFRESH_MIN_SPIN_MS);
    await advance(REFRESH_RESULT_MS - 100);
    tapOn(result);
    expect(result.current.phase).toBe('loading');
    await advance(100);
    expect(result.current.phase).toBe('loading');
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('same');
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('starts again with a plain arrow on a new page, and ignores the old page’s answer', async () => {
    const pending = deferred();
    const { result, rerender } = renderHook(({ page }) => useRefreshFeedback(() => pending.promise, page), { initialProps: { page: '/a' } });
    tapOn(result);
    rerender({ page: '/b' });
    expect(result.current.phase).toBe('idle');
    await act(async () => { pending.resolve('updated'); });
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('idle');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('answers only the latest tap when two refreshes share an answer', async () => {
    const pending = deferred();
    const { result, rerender } = renderHook(({ page }) => useRefreshFeedback(() => pending.promise, page), { initialProps: { page: '/a' } });
    tapOn(result);
    rerender({ page: '/b' });
    tapOn(result);
    await act(async () => { pending.resolve('updated'); });
    await advance(REFRESH_MIN_SPIN_MS);
    expect(result.current.phase).toBe('updated');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a refresh, and clears its timers when it goes', async () => {
    const { result, unmount, rerender } = renderHook(({ handler }: { handler?: RefreshHandler }) => useRefreshFeedback(handler), { initialProps: { handler: undefined as RefreshHandler | undefined } });
    tapOn(result);
    expect(result.current.phase).toBe('idle');
    rerender({ handler: () => Promise.resolve<RefreshOutcome>('updated') });
    tapOn(result);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
