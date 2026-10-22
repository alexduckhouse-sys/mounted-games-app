import { describe, expect, it } from 'vitest';
import { competition, heat, race, result, session, team } from '../test/factories';
import { arenaNames, arenaToShow, followedHeats } from './following';

describe('followedHeats', () => {
  const entry = (teamId: number) => ({ id: teamId, teamId, teamName: `Example ${teamId}`, laneIndex: teamId });
  it('shows only followed teams actually drawn in a heat, including qualifiers', () => {
    const data = competition({ teams: [team(1), team(2)], sessions: [session(1, { status: 1, heats: [
      heat(1, { entries: [entry(1), entry(2)], raceRoundStage: 1, races: [race(1)] }),
      heat(2, { entries: [entry(2)] }),
    ] }), session(2, { kind: 1, isBreak: true, heats: [heat(3, { entries: [entry(1)] })] }), session(3)] });
    expect(followedHeats(data, new Set([1, 99]))).toMatchObject([
      { heat: { id: 1 }, status: 'live', scores: [{ team: { id: 1 }, lane: 1, points: 0, racesRun: 0 }] },
    ]);
    expect(followedHeats(data, new Set())).toEqual([]);
  });
  it('honours pinned heat times and sums completed race points without inventing a placing', () => {
    const data = competition({ teams: [team(1)], sessions: [session(1, { scheduledStart: '2026-07-01T09:00:00Z', heats: [
      heat(1, { entries: [entry(1)], scheduledStart: '2026-07-01T11:00:00Z', races: [
        race(1, { isComplete: true, results: [result(1, 1, { points: 4 }), result(2, 2, { points: 3 })] }),
        race(2, { isComplete: true, results: [result(1, null, { points: 0, eliminated: true })] }),
        race(3, { results: [result(1, 1, { points: 4 })] }),
      ] }),
    ] })] });
    const [row] = followedHeats(data, new Set([1]));
    expect(row.effective?.toISOString()).toBe('2026-07-01T11:00:00.000Z');
    expect(row.scores[0]).toMatchObject({ points: 4, racesRun: 2 });
  });
});

describe('arenaNames and arenaToShow', () => {
  it('lists distinct arenas and only names one when there are several', () => {
    const sessions = [session(1, { arenaName: ' Main ' }), session(2, { arenaName: 'Main' }), session(3, { arenaName: '  ' }), session(4, { arenaName: null }), session(5, { arenaName: 'Ring 2' })];
    expect(arenaNames(sessions)).toEqual(['Main', 'Ring 2']);
    expect(arenaToShow(sessions[0], ['Main', 'Ring 2'])).toBe('Main');
    expect(arenaToShow(sessions[2], ['Main', 'Ring 2'])).toBeNull();
    expect(arenaToShow(sessions[0], ['Main'])).toBeNull();
    expect(arenaToShow(sessions[0], [])).toBeNull();
  });
});
