import { describe, expect, it } from 'vitest';
import { competition, heat, race, result, session, team } from '../test/factories';
import { arenaNames, arenaToShow, followedHeats, nextHeats, summariseNext } from './following';

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

describe('nextHeats and summariseNext', () => {
  const entry = (teamId: number, laneIndex = teamId) => ({ id: teamId, teamId, teamName: `Example ${teamId}`, laneIndex });
  const data = competition({
    teams: [team(1, { sectionName: 'Teams Seniors' }), team(2, { sectionName: 'Juniors' }), team(3, { sectionName: 'Pairs' }), team(4)],
    sessions: [
      session(1, { arenaName: 'Main', status: 2, heats: [heat(1, { entries: [entry(1, 2), entry(2)], finishedAt: '2026-07-01T09:30:00Z' })] }),
      session(2, { arenaName: 'Ring 2', status: 1, heats: [heat(2, { label: 'A Final', entries: [entry(1, 3)] }), heat(3, { entries: [entry(2, 4)] })] }),
    ],
  });
  const arenas = ['Main', 'Ring 2'];

  it('finds the first heat still to run, or says a team is done or not drawn', () => {
    const next = nextHeats(data, new Set([1, 2, 3, 99]));
    expect(next.get(1)).toMatchObject({ kind: 'heat', lane: 3, row: { heat: { id: 2 } } });
    expect(next.get(2)).toMatchObject({ kind: 'heat', lane: 4, row: { heat: { id: 3 } } });
    expect(next.get(3)).toEqual({ kind: 'undrawn' });
    expect(next.has(99)).toBe(false);
    expect(next.has(4)).toBe(false);
    const finished = competition({ teams: data.teams, sessions: [data.sessions[0]] });
    expect(nextHeats(finished, new Set([1])).get(1)).toEqual({ kind: 'done' });
  });

  it('describes a live heat with its age group, heat, lane and arena', () => {
    const next = nextHeats(data, new Set([1]));
    expect(summariseNext(data.teams[0], next.get(1), arenas)).toMatchObject({ sub: 'Seniors · A Final, lane 3 · Ring 2', label: 'On now', tone: 'live' });
    expect(summariseNext(data.teams[0], next.get(1), ['Main']).sub).toBe('Seniors · A Final, lane 3');
  });

  it('numbers a heat that has no label, and shows how late a heat is running', () => {
    const next = nextHeats(data, new Set([2])).get(2)!;
    if (next.kind !== 'heat') throw new Error('expected a heat');
    const late = summariseNext(data.teams[1], { ...next, row: { ...next.row, status: 'late', delayMinutes: 6 } }, arenas);
    expect(late).toMatchObject({ sub: 'Juniors · Heat 2, lane 4 · Ring 2', label: '+6 min', tone: 'late' });
    const onTime = summariseNext(data.teams[1], { ...next, row: { ...next.row, status: 'on-time' } }, arenas);
    expect(onTime).toMatchObject({ label: 'Next heat', tone: 'ok' });
    expect(onTime.time).not.toBe('–');
  });

  it('says so when a team has finished or has not been drawn, and copes with no age group', () => {
    expect(summariseNext(data.teams[2], { kind: 'undrawn' }, arenas)).toEqual({ sub: 'Pairs · not drawn yet', time: '–', label: 'Heats TBC', tone: 'wait' });
    expect(summariseNext(data.teams[2], { kind: 'done' }, arenas)).toEqual({ sub: 'Pairs · finished', time: '–', label: 'Heats done', tone: 'wait' });
    expect(summariseNext({ sectionName: null }, undefined, arenas).sub).toBe('not drawn yet');
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
