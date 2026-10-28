import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { axiosError, heat } from '../test/factories';
import type { QueuedScore } from './scoreOutbox';
import { flushOutbox, inFlightGraceRemainingMs, IN_FLIGHT_GRACE_MS, isSaveInFlight, SCORE_SENT } from './useScoreOutbox';

vi.mock('../api', () => ({ api: { post: vi.fn() } }));
vi.mock('./scorerLink', () => ({ scorerApi: { post: vi.fn() } }));

const now = Date.parse('2031-06-01T10:00:00Z');
const queued = (overrides: Partial<QueuedScore> = {}): QueuedScore => ({
  raceId: 91, competitionId: 1, sessionId: 7, label: 'Test race',
  places: [{ teamId: 1, place: 1, eliminated: false }], expected: [],
  teamNames: { 1: 'Test team' }, queuedAt: new Date(now).toISOString(),
  state: 'waiting', saveId: 'test-grace-save', ...overrides,
});

beforeEach(() => { vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); });

describe('initial score-save grace period', () => {
  it('counts down using the default clock and stops exactly at the boundary', () => {
    const item = queued();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(inFlightGraceRemainingMs(item)).toBe(IN_FLIGHT_GRACE_MS);
    expect(inFlightGraceRemainingMs(item, now + 500)).toBe(1000);
    expect(inFlightGraceRemainingMs(item, now + IN_FLIGHT_GRACE_MS - 1)).toBe(1);
    expect(inFlightGraceRemainingMs(item, now + IN_FLIGHT_GRACE_MS)).toBe(0);
    expect(inFlightGraceRemainingMs(item, now + IN_FLIGHT_GRACE_MS + 1)).toBe(0);
  });

  it('does not conceal waiting scores while offline or with unusable timestamps', () => {
    expect(inFlightGraceRemainingMs(queued({ queuedAt: 'invalid' }), now)).toBe(0);
    expect(inFlightGraceRemainingMs(queued(), now - 1)).toBe(0);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(inFlightGraceRemainingMs(queued(), now)).toBe(0);
  });

  it('shows a failed online attempt immediately, then clears that failure after a successful retry', async () => {
    const item = queued({ raceId: 92, saveId: 'test-grace-retry' });
    localStorage.setItem('mg.outbox.scores', JSON.stringify([item]));
    vi.mocked(api.post).mockRejectedValueOnce(axiosError(undefined, 'ERR_NETWORK'));
    await flushOutbox();
    expect(inFlightGraceRemainingMs(item, now)).toBe(0);

    // A later edit to the same race has its own initial-save grace period.
    expect(inFlightGraceRemainingMs({ ...item, saveId: 'test-grace-new-edit' }, now)).toBe(IN_FLIGHT_GRACE_MS);
    vi.mocked(api.post).mockResolvedValueOnce({ data: heat(5) });
    await flushOutbox();
    expect(localStorage.getItem('mg.outbox.scores')).toBeNull();
    expect(inFlightGraceRemainingMs(item, now)).toBe(IN_FLIGHT_GRACE_MS);
  });
});

describe('in-flight tracking and the sent event', () => {
  it('knows a save is in flight only while its POST is pending, and announces it once accepted', async () => {
    const item = queued({ raceId: 93, saveId: 'test-inflight' });
    localStorage.setItem('mg.outbox.scores', JSON.stringify([item]));
    let release!: (v: { data: ReturnType<typeof heat> }) => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise((resolve) => { release = resolve as never; }));
    const sent = vi.fn();
    window.addEventListener(SCORE_SENT, sent);
    const flushing = flushOutbox();
    expect(isSaveInFlight(item)).toBe(true);
    expect(sent).not.toHaveBeenCalled();
    release({ data: heat(5) });
    await flushing;
    window.removeEventListener(SCORE_SENT, sent);
    expect(isSaveInFlight(item)).toBe(false);
    expect(sent).toHaveBeenCalledTimes(1);
    expect((sent.mock.calls[0][0] as CustomEvent).detail).toEqual({ competitionId: 1, label: 'Test race' });
  });
});
