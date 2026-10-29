import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { scorerApi } from './scorerLink';
import { flushOutbox, readOutbox, sendScoreWithoutTiming } from './useScoreOutbox';
import { parseOutboxBackup, serializeOutboxBackup, type QueuedScore } from './scoreOutbox';
import { heat } from '../test/factories';
vi.mock('../api', () => ({ api: { post: vi.fn() } }));
vi.mock('./scorerLink', () => ({ scorerApi: { post: vi.fn() } }));
beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); vi.mocked(api.post).mockReset(); vi.mocked(scorerApi.post).mockReset(); });
const item = (viaLink: boolean): QueuedScore => ({ saveId: 'first-save', raceId: 1, sessionId: 2, competitionId: 3, label: 'Heat 1 · Bending',
  places: [{ teamId: 1, place: 1, eliminated: false }], expected: [], teamNames: { 1: 'Test team' }, queuedAt: '2026-10-29T09:03:00Z',
  startedAt: '2026-10-29T09:00:00Z', finishedAt: '2026-10-29T09:03:00Z', arenaName: 'Main', sessionName: 'Session 1', lanes: { 1: 2 }, viaLink, state: 'waiting' });
it.each([false, true])('sends durable timing before the score with the same credentials (link=%s)', async (viaLink) => {
  const q = item(viaLink), client = viaLink ? scorerApi : api;
  localStorage.setItem('mg.outbox.scores', JSON.stringify([q]));
  vi.mocked(client.post).mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: heat(1) });
  await flushOutbox();
  const prefix = viaLink ? '/scorer' : '';
  expect(client.post).toHaveBeenNthCalledWith(1, `${prefix}/races/1/start`, { at: q.startedAt, expectedProgrammeRevision: 0 }, { timeout: 15000 });
  expect(client.post).toHaveBeenNthCalledWith(2, `${prefix}/races/1/results`, expect.objectContaining({ finishedAt: q.finishedAt }), { timeout: 15000 });
  expect(readOutbox()).toEqual([]);
});
it('keeps scores on the phone when the start cannot reach the server', async () => {
  localStorage.setItem('mg.outbox.scores', JSON.stringify([item(false)]));
  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
  await flushOutbox();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(readOutbox()[0].state).toBe('waiting');
});
it('preserves timing and lane context through a transferred backup', () => {
  const q = item(false);
  const restored = parseOutboxBackup(serializeOutboxBackup([q], 3), 3, true);
  expect(restored?.[0]).toMatchObject({ startedAt: q.startedAt, finishedAt: q.finishedAt, arenaName: 'Main', sessionName: 'Session 1', lanes: { 1: 2 }, viaLink: true });
});

it('lets the scorer send rejected timing separately without losing placings', async () => {
  localStorage.setItem('mg.outbox.scores', JSON.stringify([item(false)]));
  vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { message: 'That time is outside this event.' } } });
  await flushOutbox();
  expect(readOutbox()[0].state).toBe('failed');
  vi.mocked(api.post).mockResolvedValueOnce({ data: heat(1) });
  expect(sendScoreWithoutTiming(1)).toBe(true);
  await flushOutbox();
  expect(api.post).toHaveBeenLastCalledWith('/races/1/results', { places: item(false).places, expected: [], finishedAt: undefined }, { timeout: 15000 });
  expect(readOutbox()).toEqual([]);
});
