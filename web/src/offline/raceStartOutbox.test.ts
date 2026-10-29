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
  expect(scorerApi.post).toHaveBeenCalledWith('/scorer/races/1/start', { at: first, expectedProgrammeRevision: 0 }, { timeout: 15000 });
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

it('keeps an old start separate from an approved replacement and sends both revisions', async () => {
  const at = new Date().toISOString();
  queueRaceStart(1, false, at); await flushRaceStarts();
  expect(raceStartFor(1, 1)).toBeUndefined();
  expect(renderHook(() => useRaceStart(1, null, false, 1)).result.current).toBeUndefined();
  queueRaceStart(1, false, at, 1); await flushRaceStarts();
  expect(raceStartFor(1, 1)).toBe(at);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValueOnce({ data: {} });
  await flushRaceStarts();
  expect(api.post).toHaveBeenNthCalledWith(1, '/races/1/start', { at, expectedProgrammeRevision: 0 }, { timeout: 15000 });
  expect(api.post).toHaveBeenNthCalledWith(2, '/races/1/start', { at, expectedProgrammeRevision: 1 }, { timeout: 15000 });
  expect(readRaceStarts().find(q => q.expectedProgrammeRevision === 0)?.error).toBeTruthy();
  expect(readRaceStarts().find(q => q.expectedProgrammeRevision === 1)?.sent).toBe(true);
});

it('rejects damaged stored starts while retaining legacy and valid programme revisions', () => {
  const valid = { raceId: 1, at: '2026-10-29T10:00:00Z', viaLink: false };
  localStorage.setItem('mg.outbox.race-starts', JSON.stringify([
    null, {}, { ...valid, raceId: 0 }, { ...valid, at: 'invalid' }, { ...valid, viaLink: 'false' },
    { ...valid, expectedProgrammeRevision: -1 }, { ...valid, expectedProgrammeRevision: 1.5 },
    { ...valid, expectedProgrammeRevision: '1' }, valid, { ...valid, expectedProgrammeRevision: 2 },
  ]));
  expect(readRaceStarts()).toEqual([valid, { ...valid, expectedProgrammeRevision: 2 }]);
  localStorage.setItem('mg.outbox.race-starts', '{broken');
  expect(readRaceStarts()).toEqual([]);
  localStorage.setItem('mg.outbox.race-starts', '{}');
  expect(readRaceStarts()).toEqual([]);
});

it.each([undefined, 503, 408, 429])('retries temporary start failure %s without marking it refused', async status => {
  const at = '2026-10-29T10:00:00Z';
  queueRaceStart(1, false, at, 2); await flushRaceStarts();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(api.post).mockRejectedValueOnce(status === undefined ? new Error('offline') : { response: { status } });
  await flushRaceStarts();
  expect(readRaceStarts()).toEqual([{ raceId: 1, at, viaLink: false, expectedProgrammeRevision: 2 }]);
  vi.mocked(api.post).mockResolvedValueOnce({ data: {} });
  await flushRaceStarts();
  expect(readRaceStarts()[0].sent).toBe(true);
  expect(api.post).toHaveBeenCalledTimes(2);
});

it('resetting a confirmed replacement keeps the previous programme start and another race', async () => {
  const at = '2026-10-29T10:00:00Z';
  localStorage.setItem('mg.outbox.race-starts', JSON.stringify([
    { raceId: 1, at, viaLink: false, confirmed: true },
    { raceId: 1, at, viaLink: false, confirmed: true, expectedProgrammeRevision: 2 },
    { raceId: 3, at, viaLink: false },
  ]));
  const view = renderHook(({ complete }) => useRaceStart(1, null, complete, 2), { initialProps: { complete: true } });
  expect(view.result.current?.confirmed).toBe(true);
  view.rerender({ complete: false });
  expect(view.result.current).toBeUndefined();
  expect(readRaceStarts().map(q => [q.raceId, q.expectedProgrammeRevision ?? 0])).toEqual([[1, 0], [3, 0]]);
  await flushRaceStarts();
});

it('only expires accepted and server-confirmed starts after seven days', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T12:00:00Z'));
  const old = '2026-10-01T10:00:00Z';
  const recent = '2026-10-28T10:00:00Z';
  localStorage.setItem('mg.outbox.race-starts', JSON.stringify([
    { raceId: 1, at: old, viaLink: false, sent: true, confirmed: true },
    { raceId: 2, at: old, viaLink: false, sent: true },
    { raceId: 3, at: old, viaLink: false },
    { raceId: 4, at: recent, viaLink: false, sent: true, confirmed: true },
  ]));
  expect(queueRaceStart(5, false, recent, 1)).toBe(true);
  expect(readRaceStarts().map(q => q.raceId)).toEqual([2, 3, 4, 5]);
  await flushRaceStarts();
});

it('syncs and deduplicates legacy starts as programme revision zero', async () => {
  const at = '2026-10-29T10:00:00Z';
  const legacy = { raceId: 1, at, viaLink: false };
  localStorage.setItem('mg.outbox.race-starts', JSON.stringify([legacy]));
  expect(queueRaceStart(1, false, '2026-10-29T11:00:00Z', 0)).toBe(true);
  expect(raceStartFor(1)).toBe(at);
  expect(readRaceStarts()).toHaveLength(1);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 409 } });
  await flushRaceStarts();
  expect(api.post).toHaveBeenCalledWith('/races/1/start', { at, expectedProgrammeRevision: 0 }, { timeout: 15000 });
  expect(readRaceStarts()[0].error).toBeTruthy();
  await flushRaceStarts();
  expect(api.post).toHaveBeenCalledTimes(1);
});
