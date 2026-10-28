import { afterEach, describe, expect, it, vi } from 'vitest';
import { competition, heat, race, result, session, team } from '../test/factories';
import { followedHeats, type TeamNext } from './following';
import {
  addedFollows, followBarAsked, FOLLOW_BAR_ASKED_KEY, followGroup, heatStanding, lastResult, markFollowBarAsked, minutesToGo, raceProgress, withFollowingTab,
} from './followingCards';

const entry = (teamId: number, laneIndex = teamId) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex });

describe('followGroup', () => {
  const heatRow = (status: string) => ({ kind: 'heat', lane: 1, row: { status } } as unknown as TeamNext);
  it('puts a running heat on now, another heat up next, and a team with every heat finished under done', () => {
    expect(followGroup(heatRow('live'), false)).toBe('now');
    expect(followGroup(heatRow('late'), false)).toBe('next');
    expect(followGroup({ kind: 'done' }, false)).toBe('done');
    expect(followGroup({ kind: 'undrawn' }, false)).toBe('next');
    expect(followGroup(undefined, false)).toBe('next');
  });
  it('never says on now from a saved copy', () => {
    expect(followGroup(heatRow('live'), true)).toBe('next');
    expect(followGroup({ kind: 'done' }, true)).toBe('done');
  });
});

describe('heatStanding', () => {
  const two = heat(1, { entries: [entry(1), entry(2), entry(3)], races: [
    race(1, { isComplete: true, results: [result(1, 1, { points: 3 }), result(2, 2, { points: 2 }), result(3, 3, { points: 1 })] }),
    race(2, { isComplete: true, results: [result(1, 3, { points: 1 }), result(2, 2, { points: 2 }), result(3, 1, { points: 3 })] }),
    race(3),
  ] });
  it('adds up the races scored so far and shares a place between level teams', () => {
    expect(heatStanding(two, 2)).toEqual({ place: 1, points: 4 });
    expect(heatStanding(two, 1)).toEqual({ place: 1, points: 4 });
    expect(heatStanding(two, 3)).toEqual({ place: 1, points: 4 });
  });
  it('ranks a team behind those with more points', () => {
    const uneven = heat(1, { entries: [entry(1), entry(2)], races: [race(1, { isComplete: true, results: [result(1, 2, { points: 1 }), result(2, 1, { points: 2 })] })] });
    expect(heatStanding(uneven, 1)).toEqual({ place: 2, points: 1 });
    expect(heatStanding(uneven, 2)).toEqual({ place: 1, points: 2 });
  });
  it('has nothing to say before a race is scored or for a team that is not in the heat', () => {
    expect(heatStanding(heat(1, { entries: [entry(1)], races: [race(1)] }), 1)).toBeNull();
    expect(heatStanding(two, 9)).toBeNull();
  });
  it('ignores results from teams that are not in the heat', () => {
    const odd = heat(1, { entries: [entry(1)], races: [race(1, { isComplete: true, results: [result(1, 1, { points: 2 }), result(7, 2, { points: 9 })] })] });
    expect(heatStanding(odd, 1)).toEqual({ place: 1, points: 2 });
  });
});

describe('raceProgress', () => {
  it('names the race being ridden out of the heat, in running order', () => {
    const h = heat(1, { races: [race(2, { orderIndex: 2 }), race(1, { orderIndex: 1, isComplete: true }), race(3, { orderIndex: 3 })] });
    expect(raceProgress(h)).toEqual({ current: 2, total: 3 });
  });
  it('stays on the last race once all are scored, and is null with no races', () => {
    expect(raceProgress(heat(1, { races: [race(1, { isComplete: true }), race(2, { isComplete: true })] }))).toEqual({ current: 2, total: 2 });
    expect(raceProgress(heat(1))).toBeNull();
  });
});

describe('minutesToGo', () => {
  const now = new Date('2026-07-01T10:00:00Z');
  it('counts whole minutes while the heat is soon', () => {
    expect(minutesToGo(new Date('2026-07-01T10:25:00Z'), now)).toBe(25);
    expect(minutesToGo(new Date('2026-07-01T10:00:20Z'), now)).toBeNull();
    expect(minutesToGo(new Date('2026-07-01T10:00:40Z'), now)).toBe(1);
  });
  it('says nothing when there is no time, it has passed, or it is far off', () => {
    expect(minutesToGo(null, now)).toBeNull();
    expect(minutesToGo(undefined, now)).toBeNull();
    expect(minutesToGo(new Date('2026-07-01T09:50:00Z'), now)).toBeNull();
    expect(minutesToGo(new Date('2026-07-01T12:30:00Z'), now)).toBeNull();
    expect(minutesToGo(new Date('2026-07-01T12:00:00Z'), now)).toBe(120);
  });
});

describe('lastResult', () => {
  const entries = [entry(1), entry(2)];
  const comp = competition({ teams: [team(1), team(2)], sessions: [session(1, { status: 2, heats: [
    heat(1, { finishedAt: '2026-07-01T09:00:00Z', entries, races: [race(1, { isComplete: true, results: [result(1, 1, { points: 2 }), result(2, 2, { points: 1 })] })] }),
    heat(2, { finishedAt: '2026-07-01T09:30:00Z', entries, races: [race(2, { isComplete: true, results: [result(1, 2, { points: 1 }), result(2, 1, { points: 2 })] })] }),
    heat(3, { entries }),
  ] })] });
  it('is the latest finished heat with where the team came in it', () => {
    const rows = followedHeats(comp, new Set([1]));
    const last = lastResult(rows, 1);
    expect(last?.row.heat?.id).toBe(2);
    expect(last).toMatchObject({ place: 2, points: 1 });
  });
  it('skips heats that are not finished, and teams that were not in one', () => {
    const rows = followedHeats(comp, new Set([1, 2]));
    expect(lastResult(rows, 3)).toBeNull();
    const onlyUnfinished = followedHeats(competition({ teams: [team(1)], sessions: [session(1, { heats: [heat(1, { entries: [entry(1)] })] })] }), new Set([1]));
    expect(lastResult(onlyUnfinished, 1)).toBeNull();
  });
  it('skips a finished heat that has no scored race', () => {
    const empty = followedHeats(competition({ teams: [team(1)], sessions: [session(1, { status: 2, heats: [heat(1, { finishedAt: '2026-07-01T09:00:00Z', entries: [entry(1)] })] })] }), new Set([1]));
    expect(lastResult(empty, 1)).toBeNull();
  });
});

describe('withFollowingTab', () => {
  it('goes just before Details', () => {
    expect(withFollowingTab(['timetable', 'toplists', 'chat', 'details'])).toEqual(['timetable', 'toplists', 'chat', 'following', 'details']);
  });
  it('goes at the end when there is no Details tab', () => {
    expect(withFollowingTab(['timetable', 'toplists'])).toEqual(['timetable', 'toplists', 'following']);
  });
  it('leaves a bar that has it alone', () => {
    expect(withFollowingTab(['following', 'timetable'])).toEqual(['following', 'timetable']);
  });
  it('makes room in a full bar by dropping its last tab that is not Timetable, Toplists or Details', () => {
    expect(withFollowingTab(['timetable', 'toplists', 'chat', 'teams', 'arena', 'details'])).toEqual(['timetable', 'toplists', 'chat', 'teams', 'following', 'details']);
  });
  it('keeps Timetable, Toplists and Details when it makes room', () => {
    expect(withFollowingTab(['timetable', 'toplists', 'details', 'chat', 'teams', 'arena'])).toEqual(['timetable', 'toplists', 'following', 'details', 'chat', 'teams']);
  });
});

describe('addedFollows', () => {
  const a = { competitionId: 1, teamId: 1 };
  it('lists the teams of this competition that were not followed before', () => {
    expect(addedFollows([a], [a, { competitionId: 1, teamId: 2 }, { competitionId: 2, teamId: 3 }], 1)).toEqual([2]);
    expect(addedFollows([a], [a], 1)).toEqual([]);
    expect(addedFollows([a], [], 1)).toEqual([]);
  });
});

describe('the answer to the bottom bar question', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('is remembered once given, whichever it was', () => {
    expect(followBarAsked()).toBe(false);
    markFollowBarAsked('declined');
    expect(localStorage.getItem(FOLLOW_BAR_ASKED_KEY)).toBe('declined');
    expect(followBarAsked()).toBe(true);
  });
  it('counts as asked when storage is blocked, so it never nags', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(followBarAsked()).toBe(true);
    expect(() => markFollowBarAsked('added')).not.toThrow();
  });
});
