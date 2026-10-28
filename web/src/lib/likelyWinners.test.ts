import { describe, expect, it } from 'vitest';
import { HISTORY_K, eventPlaces, eventWeight, likelyWinners, parseFavouriteHistory, type FavouriteHistory } from './likelyWinners';

type R = { teamId: number; placing: number | null; eliminated?: boolean; isSitOut?: boolean };
const race = (results: R[], isComplete = true) => ({
  isComplete,
  results: results.map((r, i) => ({ id: i, teamName: '', points: 0, eliminated: false, ...r })),
});
const heat = (entries: number, races: ReturnType<typeof race>[]) => ({ entries: Array.from({ length: entries }, () => ({})), races });
const session = (sectionId: number, heats: ReturnType<typeof heat>[]) => ({ competitionSectionId: sectionId, heats }) as never;
const team = (id: number, name: string, extra: object = {}) => ({ id, displayName: name, isHorsConcours: false, competitionSectionId: 1, ...extra }) as never;
const past = (teamId: number, share: number | null): FavouriteHistory => ({ teamId, teamName: '', historyPlaceShare: share, historyEntries: share == null ? 0 : 2 });

describe('eventWeight', () => {
  it('is 0 with no races, half at K and climbs towards 1', () => {
    expect(eventWeight(0)).toBe(0);
    expect(eventWeight(-1)).toBe(0);
    expect(eventWeight(HISTORY_K)).toBe(0.5);
    expect(eventWeight(12)).toBe(0.75);
    expect(eventWeight(1000)).toBeGreaterThan(0.99);
  });
});

describe('eventPlaces', () => {
  it('averages race places, ignores unfinished races, eliminations and sit-outs, and works out the typical field', () => {
    const sessions = [
      session(1, [heat(4, [
        race([{ teamId: 1, placing: 1 }, { teamId: 2, placing: 2 }, { teamId: 3, placing: 3, isSitOut: true }]),
        race([{ teamId: 1, placing: 2 }, { teamId: 2, placing: null, eliminated: true }]),
        race([{ teamId: 1, placing: 1 }, { teamId: 2, placing: 2 }], false),
      ])]),
      session(2, [heat(8, [race([{ teamId: 1, placing: 1 }, { teamId: 9, placing: 2 }])])]),
    ];
    const { totals, field } = eventPlaces(sessions, 1);
    expect(totals.get(1)).toEqual({ sum: 3, races: 2 });
    expect(totals.get(2)).toEqual({ sum: 2, races: 1 });
    expect(totals.has(3)).toBe(false);
    expect(totals.has(9)).toBe(false);
    expect(field).toBe(2);
  });

  it('falls back to the widest heat before any race is scored, and to null with no heats', () => {
    expect(eventPlaces([session(1, [heat(5, [race([], false)])])], 1).field).toBe(5);
    expect(eventPlaces([session(1, [heat(1, [])])], 1).field).toBeNull();
    expect(eventPlaces([], 1).field).toBeNull();
  });
});

describe('likelyWinners', () => {
  const sessions = [session(1, [heat(4, [
    race([{ teamId: 1, placing: 1 }, { teamId: 2, placing: 2 }, { teamId: 3, placing: 3 }, { teamId: 4, placing: 4 }]),
    race([{ teamId: 1, placing: 1 }, { teamId: 2, placing: 2 }, { teamId: 3, placing: 4 }, { teamId: 4, placing: 3 }]),
  ])])];

  it('ranks by this event alone when there is no history', () => {
    const list = likelyWinners(sessions, [team(1, 'A'), team(2, 'B'), team(3, 'C'), team(4, 'D')], [], 1);
    expect(list.map((f) => [f.teamName, f.avgPlace, f.basis])).toEqual([['A', 1, 'event'], ['B', 2, 'event'], ['C', 3.5, 'event'], ['D', 3.5, 'event']]);
    expect(list[2].races).toBe(2);
  });

  it('breaks ties on more races, then name', () => {
    const list = likelyWinners(sessions, [team(4, 'Z'), team(3, 'Y')], [], 1);
    expect(list.map((f) => f.teamName)).toEqual(['Y', 'Z']);
  });

  it('blends history in, weighted towards history early and this event later', () => {
    // Team 4 rides 3.5 on average over 2 races; history says it usually finishes at the very top (share 0.25 of a field of 4 = 1).
    const [d] = likelyWinners(sessions, [team(4, 'D')], [past(4, 0.25)], 1);
    const w = 2 / (2 + HISTORY_K);
    expect(d.basis).toBe('blend');
    expect(d.avgPlace).toBe(Math.round((w * 3.5 + (1 - w) * 1) * 10) / 10);
  });

  it('uses history alone for a team with no race places yet, and leaves out a team with nothing', () => {
    const list = likelyWinners([session(1, [heat(6, [race([], false)])])], [team(1, 'A'), team(2, 'B')], [past(1, 0.5)], 1);
    expect(list).toEqual([{ teamId: 1, teamName: 'A', avgPlace: 3, races: 0, basis: 'history' }]);
  });

  it('leaves out hors concours teams, other age groups and teams whose history cannot be scaled', () => {
    const list = likelyWinners(sessions, [team(1, 'A', { isHorsConcours: true }), team(2, 'B', { competitionSectionId: 2 }), team(5, 'E')], [past(5, 0.5)], 1);
    expect(list).toEqual([{ teamId: 5, teamName: 'E', avgPlace: 2, races: 0, basis: 'history' }]);
    expect(likelyWinners([], [team(1, 'A')], [past(1, 0.5)], 1)).toEqual([]);
  });

  it('never shows a place better than 1st', () => {
    const [a] = likelyWinners([session(1, [heat(4, [])])], [team(1, 'A')], [past(1, 0.1)], 1);
    expect(a.avgPlace).toBe(1);
  });
});

describe('parseFavouriteHistory', () => {
  it('keeps good rows and drops malformed ones', () => {
    expect(parseFavouriteHistory(null)).toEqual([]);
    expect(parseFavouriteHistory([
      { teamId: 1, teamName: 'A', historyPlaceShare: 0.4, historyEntries: 3 },
      { teamId: 2, teamName: 'B', historyPlaceShare: 5, historyEntries: 'x' },
      { teamId: 'x', teamName: 'C' },
      null,
      { teamId: 3, teamName: 7 },
    ])).toEqual([
      { teamId: 1, teamName: 'A', historyPlaceShare: 0.4, historyEntries: 3 },
      { teamId: 2, teamName: 'B', historyPlaceShare: null, historyEntries: 0 },
    ]);
  });
});
