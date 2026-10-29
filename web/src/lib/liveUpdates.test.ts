import { afterEach, describe, expect, it, vi } from 'vitest';
import { axiosError, competition, heat, race, session, team } from '../test/factories';
import { applyResultsUpdate, isNetworkError, replaceHeat, retryOnNetworkError, type ResultsUpdate } from './liveUpdates';

const detail = () => competition({
  sessions: [
    session(1, { heats: [heat(10, { races: [race(100, { startedAt: 'old-start', finishedAt: 'old-finish' }), race(101)] }), heat(11)] }),
    session(2, { heats: [heat(20, { races: [race(200)] })] }),
  ],
});

describe('replaceHeat', () => {
  it('swaps one heat in the right session and leaves everything else alone', () => {
    const before = detail();
    const updated = heat(10, { label: 'Updated' });
    const after = replaceHeat(before, 1, updated);
    expect(after.sessions[0].heats[0]).toBe(updated);
    expect(after.sessions[0].heats[1]).toBe(before.sessions[0].heats[1]);
    expect(after.sessions[1]).toBe(before.sessions[1]);
  });

  it('does nothing for a heat the session does not have', () => {
    const before = detail();
    expect(replaceHeat(before, 1, heat(99)).sessions[0].heats.map((h) => h.id)).toEqual([10, 11]);
  });
});

describe('applyResultsUpdate', () => {
  const withCards = () => competition({
    teams: [team(1, { refereeCard: 'yellow' }), team(2, { refereeCard: 'red' })],
    sessions: [session(1, { heats: [heat(10, { entries: [
      { id: 1, teamId: 1, teamName: 'Team 1', laneIndex: 1, refereeCard: 'yellow' },
      { id: 2, teamId: 2, teamName: 'Team 2', laneIndex: 2, refereeCard: 'red' },
    ] })] })],
  });

  it('updates HC status without erasing referee cards or changing another team', () => {
    const before = withCards();
    const after = applyResultsUpdate(before, { teamId: 1, isHorsConcours: true });
    expect(after.teams[0]).toMatchObject({ isHorsConcours: true, refereeCard: 'yellow' });
    expect(after.teams[1]).toBe(before.teams[1]);
    expect(after.sessions).toBe(before.sessions);
    expect(applyResultsUpdate(after, { teamId: 1, isHorsConcours: false }).teams[0].isHorsConcours).toBe(false);
  });

  it.each([1, null])('leaves cards untouched on a tack-check standings invalidation for team %s', (teamId) => {
    const before = withCards();
    expect(applyResultsUpdate(before, { sectionId: 5, teamId, tackCheck: true })).toBe(before);
  });

  it('ignores malformed team changes instead of guessing a card or HC value', () => {
    const before = withCards();
    expect(applyResultsUpdate(before, { teamId: 1, isHorsConcours: 'yes' } as unknown as ResultsUpdate)).toBe(before);
    expect(applyResultsUpdate(before, { teamId: null, refereeCard: 'red' } as unknown as ResultsUpdate)).toBe(before);
  });

  it('changes or clears a referee card only when the payload explicitly carries that field', () => {
    const before = withCards();
    const after = applyResultsUpdate(before, { teamId: 1, refereeCard: 'red' });
    expect(after.teams[0].refereeCard).toBe('red');
    expect(after.sessions[0].heats[0].entries[0].refereeCard).toBe('red');
    expect(after.teams[1]).toBe(before.teams[1]);
    expect(after.sessions[0].heats[0].entries[1]).toBe(before.sessions[0].heats[0].entries[1]);
    const cleared = applyResultsUpdate(after, { teamId: 1, refereeCard: null });
    expect(cleared.teams[0].refereeCard).toBeNull();
    expect(cleared.sessions[0].heats[0].entries[0].refereeCard).toBeNull();
    expect(applyResultsUpdate(before, { teamId: 1 } as ResultsUpdate)).toBe(before);
  });

  it('replaces a whole heat when the update carries one', () => {
    const updated = heat(11, { label: 'Final' });
    expect(applyResultsUpdate(detail(), { sessionId: 1, heat: updated }).sessions[0].heats[1]).toBe(updated);
  });

  it('ignores an update whose heat is missing', () => {
    const before = detail();
    expect(applyResultsUpdate(before, { sessionId: 1, heat: undefined } as unknown as ResultsUpdate)).toBe(before);
  });

  it('starting a race sets its start and clears any finish', () => {
    const race100 = applyResultsUpdate(detail(), { sessionId: 1, raceId: 100, started: 'new-start' }).sessions[0].heats[0].races[0];
    expect(race100).toMatchObject({ startedAt: 'new-start', finishedAt: null });
  });

  it('un-starting a race clears its start', () => {
    const race100 = applyResultsUpdate(detail(), { sessionId: 1, raceId: 100, started: null }).sessions[0].heats[0].races[0];
    expect(race100).toMatchObject({ startedAt: null, finishedAt: null });
    const missing = applyResultsUpdate(detail(), { sessionId: 1, raceId: 100, started: undefined }).sessions[0].heats[0].races[0];
    expect(missing.startedAt).toBeNull();
  });

  it('finishing a race keeps its start', () => {
    const race100 = applyResultsUpdate(detail(), { sessionId: 1, raceId: 100, finished: 'new-finish' }).sessions[0].heats[0].races[0];
    expect(race100).toMatchObject({ startedAt: 'old-start', finishedAt: 'new-finish' });
    const cleared = applyResultsUpdate(detail(), { sessionId: 1, raceId: 100 }).sessions[0].heats[0].races[0];
    expect(cleared.finishedAt).toBeNull();
  });

  it('touches only the matching race', () => {
    const after = applyResultsUpdate(detail(), { sessionId: 1, raceId: 100, finished: 'x' });
    expect(after.sessions[0].heats[0].races[1]).toEqual(race(101));
    expect(after.sessions[0].heats[1]).toEqual(heat(11));
    expect(after.sessions[1]).toEqual(detail().sessions[1]);
  });

  it('ignores a race that is not in the named session', () => {
    expect(applyResultsUpdate(detail(), { sessionId: 2, raceId: 100, finished: 'x' })).toEqual(detail());
    expect(applyResultsUpdate(detail(), { sessionId: 1, raceId: 999, finished: 'x' })).toEqual(detail());
  });
});

describe('isNetworkError', () => {
  it('is true for a request that never got an answer', () => {
    expect(isNetworkError(axiosError(undefined, 'ERR_NETWORK'))).toBe(true);
    expect(isNetworkError(axiosError(undefined, 'ECONNABORTED'))).toBe(true);
    expect(isNetworkError(axiosError())).toBe(true);
  });

  it('is false for a server answer, a cancellation or anything that is not an Axios error', () => {
    expect(isNetworkError(axiosError({ status: 500 }))).toBe(false);
    expect(isNetworkError(axiosError(undefined, 'ERR_CANCELED'))).toBe(false);
    expect(isNetworkError(new Error('plain'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe('retryOnNetworkError', () => {
  afterEach(() => { vi.useRealTimers(); });
  const lost = () => axiosError(undefined, 'ERR_NETWORK');

  it('returns straight away when the first attempt works', async () => {
    const send = vi.fn().mockResolvedValue('ok');
    const wait = vi.fn();
    await expect(retryOnNetworkError(send, { wait })).resolves.toBe('ok');
    expect(wait).not.toHaveBeenCalled();
  });

  it('retries after each configured delay while the connection is lost', async () => {
    const send = vi.fn().mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost()).mockResolvedValue('ok');
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(retryOnNetworkError(send, { wait })).resolves.toBe('ok');
    expect(wait.mock.calls).toEqual([[2_000], [5_000]]);
  });

  it('gives up with the last error once the delays run out', async () => {
    const failure = lost();
    const send = vi.fn().mockRejectedValue(failure);
    await expect(retryOnNetworkError(send, { delays: [1], wait: async () => {} })).rejects.toBe(failure);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fails fast when the server answered', async () => {
    const failure = axiosError({ status: 400 });
    const send = vi.fn().mockRejectedValue(failure);
    await expect(retryOnNetworkError(send, { wait: async () => {} })).rejects.toBe(failure);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('waits with real timers by default', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(lost()).mockResolvedValue('ok');
    const promise = retryOnNetworkError(send);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('ok');
  });
});
