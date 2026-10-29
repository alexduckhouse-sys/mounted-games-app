import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { scorerApi } from './scorerLink';
import { flushRaceStarts, queueRaceStart, raceStartFor, readRaceStarts, useRaceStart } from './raceStartOutbox';
vi.mock('../api', () => ({ api: { post: vi.fn() } }));
vi.mock('./scorerLink', () => ({ scorerApi: { post: vi.fn() } }));
beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); vi.mocked(api.post).mockReset(); vi.mocked(scorerApi.post).mockReset(); });
it('keeps the first offline tap across reload and repeated taps', async () => {
  const first = new Date().toISOString();
  expect(queueRaceStart(1, true, first)).toBe(true);
  expect(queueRaceStart(1, true, new Date(Date.now() + 1000).toISOString())).toBe(true);
  expect(raceStartFor(1)).toBe(first);
  expect(renderHook(() => useRaceStart(1)).result.current?.at).toBe(first);
  await flushRaceStarts();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(scorerApi.post).mockResolvedValue({ data: {} });
  await flushRaceStarts();
  expect(scorerApi.post).toHaveBeenCalledWith('/scorer/races/1/start', { at: first }, { timeout: 15000 });
  expect(readRaceStarts()[0].sent).toBe(true);
});
it('refuses to unlock if local storage fails', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('full'); });
  expect(queueRaceStart(2)).toBe(false);
  expect(raceStartFor(2)).toBeUndefined();
});
it('invalidates a local start once a confirmed server race has been reset', () => {
  const at = new Date().toISOString(); queueRaceStart(1, false, at);
  const view = renderHook(({ stamp }: { stamp: string | null }) => useRaceStart(1, stamp), { initialProps: { stamp: at as string | null } });
  expect(readRaceStarts()[0].confirmed).toBe(true);
  view.rerender({ stamp: null });
  expect(view.result.current).toBeUndefined();
});
it('keeps a refused start while sending another competition’s start', async () => {
  queueRaceStart(1); queueRaceStart(2); await flushRaceStarts();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ data: {} });
  await flushRaceStarts();
  expect(readRaceStarts().find((q) => q.raceId === 1)?.error).toBeTruthy();
  expect(readRaceStarts().find((q) => q.raceId === 2)?.sent).toBe(true);
});
