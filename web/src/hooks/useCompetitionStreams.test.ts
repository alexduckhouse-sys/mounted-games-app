import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useCompetitionStreams } from './useCompetitionStreams';
import { deferred, flush, liveStream } from '../test/streamFakes';
vi.mock('../api', () => ({ api: { get: vi.fn() } }));
beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: { enabled: true, streams: [liveStream()] } }); });
it('loads streaming configuration on mount and on every hub-ready change', async () => {
  const { result, rerender } = renderHook(({ ready }) => useCompetitionStreams(1, ready), { initialProps: { ready: 0 } });
  await act(flush); expect(result.current.streams).toHaveLength(1); expect(result.current.streamingEnabled).toBe(true);
  vi.mocked(api.get).mockResolvedValue({ data: { enabled: false, streams: [] } }); rerender({ ready: 1 }); await act(flush);
  expect(result.current.streamingEnabled).toBe(false); expect(result.current.streams).toEqual([]); expect(api.get).toHaveBeenCalledTimes(2);
});
it('merges live events and viewer counts, ignores foreign competitions and removes ended streams', async () => {
  const { result } = renderHook(() => useCompetitionStreams(1, 0)); await act(flush);
  act(() => result.current.onStreamUpdated(liveStream({ competitionId: 2, id: 5 })));
  act(() => result.current.onStreamUpdated(liveStream({ id: 2 })));
  act(() => result.current.onStreamViewers({ streamId: 1, count: 48 })); expect(result.current.streams[0].viewerCount).toBe(48);
  act(() => result.current.onStreamUpdated(liveStream({ status: 2 }))); expect(result.current.streams.map((s) => s.id)).toEqual([2]);
});
it('replays events that arrive during GET and discards an obsolete response', async () => {
  const first = deferred<unknown>(), second = deferred<unknown>();
  vi.mocked(api.get).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result, rerender } = renderHook(({ ready }) => useCompetitionStreams(1, ready), { initialProps: { ready: 0 } });
  rerender({ ready: 1 });
  act(() => result.current.onStreamUpdated(liveStream({ id: 2 })));
  act(() => result.current.onStreamViewers({ streamId: 1, count: 8 }));
  await act(async () => { first.resolve({ data: { enabled: false, streams: [] } }); await flush(); });
  await act(async () => { second.resolve({ data: { enabled: true, streams: [liveStream()] } }); await flush(); });
  expect(result.current.streams).toHaveLength(2); expect(result.current.streams[0].viewerCount).toBe(8);
});
it('keeps the last list on fetch failure', async () => {
  const { result, rerender, unmount } = renderHook(({ ready }) => useCompetitionStreams(1, ready), { initialProps: { ready: 0 } }); await act(flush);
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')); rerender({ ready: 1 }); await act(flush);
  expect(result.current.streams).toHaveLength(1); unmount();
});
