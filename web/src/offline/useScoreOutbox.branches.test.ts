import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { QueuedScore } from './scoreOutbox';
import { flushOutbox, IN_FLIGHT_GRACE_MS, inFlightGraceRemainingMs, readOutbox, updateOutbox } from './useScoreOutbox';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));
vi.mock('./scorerLink', () => ({ scorerApi: { post: vi.fn() } }));

const queued = (raceId: number, queuedAt: string, extra: Partial<QueuedScore> = {}): QueuedScore => ({
  raceId,
  competitionId: 1,
  sessionId: 7,
  label: `Race ${raceId}`,
  places: [{ teamId: 1, place: 1, eliminated: false }],
  expected: [],
  teamNames: {},
  queuedAt,
  state: 'waiting',
  ...extra,
});

const online = (value: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);

beforeEach(() => {
  online(true);
  vi.mocked(api.post).mockReset();
});

describe('inFlightGraceRemainingMs', () => {
  const now = Date.parse('2026-06-01T10:00:10Z');

  it('returns the time left while a fresh online save may still be in flight', () => {
    expect(inFlightGraceRemainingMs(queued(1, '2026-06-01T10:00:09.500Z'), now)).toBe(IN_FLIGHT_GRACE_MS - 500);
    expect(inFlightGraceRemainingMs(queued(1, '2026-06-01T10:00:10Z'), now)).toBe(IN_FLIGHT_GRACE_MS);
  });

  it('defaults to the current time', () => {
    const fresh = queued(1, new Date().toISOString());
    const left = inFlightGraceRemainingMs(fresh);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(IN_FLIGHT_GRACE_MS);
  });

  it('is zero when offline, when the save is old, from the future or has a bad date', () => {
    expect(inFlightGraceRemainingMs(queued(1, '2026-06-01T09:00:00Z'), now)).toBe(0);
    expect(inFlightGraceRemainingMs(queued(1, '2026-06-01T10:00:10Z'), now + IN_FLIGHT_GRACE_MS)).toBe(0);
    expect(inFlightGraceRemainingMs(queued(1, '2026-06-01T10:01:00Z'), now)).toBe(0);
    expect(inFlightGraceRemainingMs(queued(1, 'garbage'), now)).toBe(0);
    online(false);
    expect(inFlightGraceRemainingMs(queued(1, '2026-06-01T10:00:09.500Z'), now)).toBe(0);
  });

  it('stops granting grace once a send for that save failed for lack of signal', async () => {
    const item = queued(42, '2026-06-01T10:00:09.500Z', { saveId: 'fail-1' });
    localStorage.setItem('mg.outbox.scores', JSON.stringify([item]));
    expect(inFlightGraceRemainingMs(item, now)).toBeGreaterThan(0);
    vi.mocked(api.post).mockRejectedValue(new Error('network down'));
    await flushOutbox();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(inFlightGraceRemainingMs(item, now)).toBe(0);
  });
});

describe('updateOutbox and flush edge cases', () => {
  it('keeps the save id a queued item already has and invents one for items without', () => {
    online(false);
    expect(updateOutbox(() => [queued(1, '2026-06-01T10:00:00Z', { saveId: 'keep' }), queued(2, '2026-06-01T10:00:00Z', { saveId: undefined })])).toBe(true);
    const stored = readOutbox();
    expect(stored[0].saveId).toBe('keep');
    expect(stored[1].saveId).toMatch(/[0-9a-f-]{36}/);
  });

  it('sends a save at most once per flush when storage silently fails to record the result', async () => {
    localStorage.setItem('mg.outbox.scores', JSON.stringify([queued(5, '2026-06-01T10:00:00Z', { saveId: 'stuck' })]));
    vi.mocked(api.post).mockResolvedValue({ data: { id: 1, sessionId: 7, orderIndex: 1, entries: [], races: [] } });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    await flushOutbox();
    expect(api.post).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    removeItem.mockRestore();
    expect(readOutbox()).toHaveLength(1);
  });
});
