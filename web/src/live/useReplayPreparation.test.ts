import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useReplayPreparation } from './useReplayPreparation';
import type { ReplayEncodingOptions } from './replayEncoding';
import type { SavedReplayClip } from './replayBuffer';
import { deferred } from '../test/streamFakes';
const clip = { id: 'synthetic' } as SavedReplayClip;
it('reports progress and delivers a completed clip', async () => {
  const { result } = renderHook(useReplayPreparation); const done = vi.fn(); const pending = deferred<SavedReplayClip>(); let options!: ReplayEncodingOptions;
  let work!: Promise<void>;
  act(() => { work = result.current.prepare((next) => { options = next; return pending.promise; }, done); });
  act(() => options.onProgress?.(0.5)); expect(result.current.progress).toBe(0.5);
  await act(async () => { pending.resolve(clip); await work; }); expect(done).toHaveBeenCalledWith(clip); expect(result.current.progress).toBeNull();
});
it('cancels, ignores late progress and prevents duplicate encoders', async () => {
  const { result } = renderHook(useReplayPreparation); const done = vi.fn(); const pending = deferred<SavedReplayClip>(); let options!: ReplayEncodingOptions; let work!: Promise<void>;
  act(() => { work = result.current.prepare((next) => { options = next; return pending.promise; }, done); });
  const duplicate = vi.fn(); await act(async () => { await result.current.prepare(duplicate, done); }); expect(duplicate).not.toHaveBeenCalled();
  act(() => { result.current.cancel(); options.onProgress?.(0.75); }); expect(options.signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(clip); await work; }); expect(done).not.toHaveBeenCalled(); expect(result.current.error).toBe('');
});
it('aborts on unmount and does not report a late failure', async () => {
  const { result, unmount } = renderHook(useReplayPreparation); const pending = deferred<SavedReplayClip>(); let options!: ReplayEncodingOptions; let work!: Promise<void>; const done = vi.fn();
  act(() => { work = result.current.prepare((next) => { options = next; return pending.promise; }, done); });
  unmount(); expect(options.signal?.aborted).toBe(true); pending.reject(new Error('late')); await work; expect(done).not.toHaveBeenCalled();
});
it.each([new Error('Storage is full'), 'unknown'])('reports export failure: %s', async (failure) => {
  const { result } = renderHook(useReplayPreparation);
  await act(async () => { await result.current.prepare(async () => { throw failure; }, vi.fn()); });
  expect(result.current.error).toBe(failure instanceof Error ? failure.message : 'Could not prepare the replay. Try again.');
});
it('explains when no replay has been recorded yet', async () => {
  const { result } = renderHook(useReplayPreparation);
  await act(async () => { await result.current.prepare(async () => null, vi.fn()); }); expect(result.current.error).toMatch(/No replay/);
  act(() => result.current.cancel());
});
