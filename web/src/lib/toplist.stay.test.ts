import { describe, expect, it } from 'vitest';
import type { Heat, Session } from '../types';
import { heat as baseHeat, race, result, session as baseSession, standing, team as baseTeam } from '../test/factories';
import { buildToplist, toplistNote } from './toplist';

/*
 * The note under teams at or above the A Final line: "Guaranteed a place in the A Final" or "N pts to stay in the
 * A Final". Scoring: first place is worth the largest heat size in the session, one less per place; an elimination
 * scores nothing. A rival level on points counts against the team (countback may go its way).
 */

const SECTION = 9;
const entries = (teamIds: number[]): Heat['entries'] => teamIds.map((teamId, lane) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: lane }));
const heat = (id: number, teamIds: number[], races: Heat['races'], extra: Partial<Heat> = {}) => baseHeat(id, { entries: entries(teamIds), races, ...extra });
const session = (id: number, heats: Heat[], extra: Partial<Session> = {}) => baseSession(id, { competitionSectionId: SECTION, sectionName: 'Seniors', name: 'Seniors heats', heats, ...extra });
const team = (id: number, extra: Parameters<typeof baseTeam>[1] = {}) => baseTeam(id, { competitionSectionId: SECTION, ...extra });
const races = (from: number, count: number) => Array.from({ length: count }, (_, i) => race(from + i));
const toplist = (points: number[], sessions: Session[], places: number, teams = [] as ReturnType<typeof team>[]) =>
  buildToplist(points.map((value, i) => standing(i + 1, value)), sessions, teams, SECTION, places);
const byTeam = (list: ReturnType<typeof buildToplist>, teamId: number) => list.rows.find((row) => row.teamId === teamId)!;

describe('guaranteed a place in the A Final', () => {
  it('holds when not enough rivals can reach the team even if it is eliminated in every race left', () => {
    // Top 2 go through. One race left for all four, 4 lanes: 4, 3, 2, 1 points.
    // Team 1 (20): nobody else can get past 15 + 4 = 19. Team 2 (15): only team 1 is ahead; team 3 tops out at 8 + 4 = 12.
    const list = toplist([20, 15, 8, 6], [session(1, [heat(1, [1, 2, 3, 4], races(1, 1))])], 2);
    expect(list.cutAfter).toBe(1);
    expect(byTeam(list, 1)).toMatchObject({ guaranteed: true });
    expect(byTeam(list, 2)).toMatchObject({ guaranteed: true });
    expect(byTeam(list, 1).toStay).toBeUndefined();
    expect(toplistNote(byTeam(list, 2))).toBe('Guaranteed a place in the A Final');
    // Team 3 (8) can't pass 15 with 4 points: no note at all, not a "can't reach" claim.
    expect(byTeam(list, 3)).toMatchObject({ out: true, needed: null });
    expect(byTeam(list, 3).neededUnavailable).toBeUndefined();
  });

  it('is not claimed when the team would drop out by being eliminated, even though any finish keeps it in', () => {
    // Top 2. Team 2 has 8.5, team 3 has 7; one race between them, 2 lanes (2 and 1 points).
    // Eliminated: 8.5 against team 3's 9, out. Last: 9.5 against 9, in. So 1 point (finishing at all) keeps it in.
    const list = toplist([20, 8.5, 7], [session(1, [heat(1, [2, 3], races(1, 1))])], 2);
    expect(byTeam(list, 2)).toMatchObject({ toStay: 1 });
    expect(byTeam(list, 2).guaranteed).toBeUndefined();
    expect(toplistNote(byTeam(list, 2))).toBe('1 pt to stay in the A Final');
  });
});

describe('points to stay in the A Final', () => {
  it('is the smallest gain that keeps the team in whatever the others do (last race, level counts against)', () => {
    // Top 2. Team 2 (10) and team 3 (9) ride the last race, 2 lanes.
    // Team 2 eliminated: 10 v 11, out. Second: 11 v 11, level, out on the safe side. First: 12 v 10, in. So 2 to stay.
    const list = toplist([20, 10, 9], [session(1, [heat(1, [2, 3], races(1, 1))])], 2);
    expect(byTeam(list, 2)).toMatchObject({ toStay: 2, racesLeft: 1 });
    expect(toplistNote(byTeam(list, 2))).toBe('2 pts to stay in the A Final');
    // Below the line, team 3 can at best draw level: 11 v 11.
    expect(byTeam(list, 3)).toMatchObject({ needed: 2, neededForRunoff: true });
    expect(toplistNote(byTeam(list, 3))).toBe('2 pts needed for a run-off (normal finishes)');
  });

  it('counts half points: 8.5 needs one point where 8 needs two', () => {
    const half = toplist([20, 8.5, 7], [session(1, [heat(1, [2, 3], races(1, 1))])], 2);
    const whole = toplist([20, 8, 7], [session(1, [heat(1, [2, 3], races(1, 1))])], 2);
    expect(byTeam(half, 2).toStay).toBe(1);
    // 8 + 1 = 9 is level with team 3's 7 + 2 = 9, so only a win (2) is safe.
    expect(byTeam(whole, 2).toStay).toBe(2);
  });

  it('works over several races and a six-lane heat', () => {
    // Top 3 of six teams, two races left, 6 lanes (6 down to 1 points). Teams 1 (41) and 2 (38) are clear already,
    // so team 3 (30) drops out as soon as one rival ends level or ahead; team 4 (28) is the danger.
    // Team 3 scoring 10 (two seconds, 40): team 4 can win both, 40, level, so 10 is not safe.
    // Team 3 scoring 11 (a first and a second, 41): team 4 gets at most 6 + 5, 39. So 11 to stay.
    const sessions = [session(1, [heat(1, [1, 2, 3, 4, 5, 6], races(1, 2))])];
    const list = toplist([41, 38, 30, 28, 25, 20], sessions, 3);
    expect(byTeam(list, 3)).toMatchObject({ toStay: 11 });
    expect(oracle([41, 38, 30, 28, 25, 20], 2, 3, 2).toStay).toBe(11);
    // Pushing a team out of the top 3 takes three rivals level or ahead. Team 1 (41), even eliminated twice: only
    // team 2 (up to 50) and team 3 (up to 42) can reach 41; team 4 tops out at 40.
    expect(byTeam(list, 1)).toMatchObject({ guaranteed: true });
    // Team 2 (38) on 40 (gain 2): team 4 wins both (40) and team 3 takes two seconds (40), with team 1 on 41: out.
    // On 41 (gain 3) team 4 can't get there, so only teams 1 and 3 can: 3 to stay.
    expect(byTeam(list, 2)).toMatchObject({ toStay: 3 });
    expect(oracle([41, 38, 30, 28, 25, 20], 1, 3, 2).toStay).toBe(3);
  });

  it('uses the shared session base with HC teams but gives HC no finishing place', () => {
    // Top 2. Team 4 is hors concours in the heat: the base is 3 lanes, but only teams 2 and 3 take places (3 and 2).
    // Team 2 (8): eliminated 8 v 10, second 10 v 10 (level), first 11 v 9. So 3 to stay.
    const withHc = toplist([10, 8, 7], [session(1, [heat(1, [2, 3, 4], races(1, 1))])], 2, [team(4, { isHorsConcours: true })]);
    expect(byTeam(withHc, 2)).toMatchObject({ toStay: 3 });
    // Without the HC team the race is worth 2 and 1, so a win (2) is enough.
    const without = toplist([10, 8, 7], [session(1, [heat(1, [2, 3], races(1, 1))])], 2);
    expect(byTeam(without, 2)).toMatchObject({ toStay: 2 });
  });

  it('gives tied teams straddling the line (a run-off for now) what each needs to stay, with no run-off words', () => {
    // Top 2: 12, then 9 and 9 level across the line. One race left for teams 2, 3 and 4 (3, 2 and 1 points).
    // Team 2 scoring 2 (11) can be caught by team 3 winning (12); scoring 3 (12) leaves team 3 at most 11.
    const list = toplist([12, 9, 9, 4], [session(1, [heat(1, [2, 3, 4], races(1, 1))])], 2);
    expect(list.runoff?.teams.map((row) => row.teamId)).toEqual([2, 3]);
    expect(list.cutAfter).toBe(2);
    expect(byTeam(list, 2)).toMatchObject({ runoff: true, joint: true, toStay: 3 });
    expect(byTeam(list, 3)).toMatchObject({ runoff: true, joint: true, toStay: 3 });
    // Team 4 (4) can reach 7 at most: out of reach, no note.
    expect(byTeam(list, 4)).toMatchObject({ out: true, needed: null });
  });

  it('says nothing when the team cannot make sure on its own (rivals elsewhere can pass it whatever it does)', () => {
    // Top 2. Teams 1 and 2 have one race together; teams 3 and 4 have three more races in another heat (2 and 1 points).
    // Team 2 winning its race (11) can still be passed by team 3 (8 + 6 = 14) and caught by team 4 (8 + 3 = 11).
    const sessions = [session(1, [heat(1, [1, 2], races(1, 1)), heat(2, [3, 4], races(2, 3))])];
    const list = toplist([10, 9, 8, 8], sessions, 2);
    expect(byTeam(list, 2).guaranteed).toBeUndefined();
    expect(byTeam(list, 2).toStay).toBeNull();
    expect(byTeam(list, 2).neededUnavailable).toBeUndefined();
    expect(toplistNote(byTeam(list, 2))).toBe('1 race left');
  });

  it('has no note for a team that has finished riding, even if others can still pass it', () => {
    // Team 2 has no races left; teams 3 and 4 still ride. No guarantee or target is given for team 2.
    const done = race(1, { isComplete: true, results: [result(2, 1, { points: 2 })] });
    const sessions = [session(1, [heat(1, [2], [done]), heat(2, [3, 4], races(2, 2))])];
    const list = toplist([20, 10, 9, 0], sessions, 2);
    expect(byTeam(list, 2)).toMatchObject({ racesLeft: 0 });
    expect(byTeam(list, 2).guaranteed).toBeUndefined();
    expect(byTeam(list, 2).toStay).toBeUndefined();
  });

  it('has no notes once every race is complete', () => {
    const complete = race(1, { isComplete: true, results: [result(2, 1, { points: 2 }), result(3, 2, { points: 1 })] });
    const list = toplist([20, 12, 10], [session(1, [heat(1, [2, 3], [complete])])], 2);
    expect(list.rows.every((row) => row.guaranteed === undefined && row.toStay === undefined && row.needed === null)).toBe(true);
  });

  it('gives a withdrawn team nothing but keeps its points against everyone else', () => {
    // Team 2 has withdrawn on 10 points. It still counts in the 3-lane base, so team 3 (9) and team 4 (0) race for
    // 3 and 2 points: team 3 needs 2 (11 beats 10 outright).
    const list = buildToplist([standing(1, 20), { ...standing(2, 10), withdrawn: true }, standing(3, 9), standing(4, 0)],
      [session(1, [heat(1, [2, 3, 4], races(1, 1))])], [], SECTION, 2);
    expect(byTeam(list, 2)).toMatchObject({ withdrawn: true });
    expect(byTeam(list, 2).toStay).toBeUndefined();
    expect(toplistNote(byTeam(list, 2))).toBe('Withdrawn');
    expect(byTeam(list, 3)).toMatchObject({ needed: 2 });
  });
});

describe('when the sums are too big', () => {
  it('says the calculation is unavailable rather than claim a place or a target when the work runs out', () => {
    // 24 teams in four heats of six with eight races each, top 6 through. Some rows above the line run out of work.
    const ids = Array.from({ length: 24 }, (_, i) => i + 1);
    const heats = Array.from({ length: 4 }, (_, i) => heat(i + 1, ids.slice(i * 6, i * 6 + 6), races(i * 8 + 1, 8)));
    const list = buildToplist(ids.map((id) => standing(id, 25 - id)), [session(1, heats)], [], SECTION, 6);
    const above = list.rows.slice(0, (list.cutAfter ?? -1) + 1);
    expect(above.some((row) => row.neededUnavailable)).toBe(true);
    for (const row of above.filter((item) => item.neededUnavailable)) {
      expect(row.guaranteed).toBeUndefined();
      expect(row.toStay).toBeUndefined();
      expect(toplistNote(row)).toBe('Qualification calculation unavailable');
    }
  });

  it('does not search at all for very large programmes', () => {
    const list = toplist([5, 4, 1], [session(1, [heat(1, [1, 2, 3], races(1, 200))])], 2);
    expect(list.rows.slice(0, 2).every((row) => row.neededUnavailable && row.guaranteed === undefined && row.toStay === undefined)).toBe(true);
  });
});

/* Independent exhaustive oracle with the full rules: in every race each team either finishes or is eliminated, and the
 * finishers take the top places in any order (n points for first, then n-1 ...). No pruning, no shortcuts. */
function permutations(values: number[]): number[][] {
  if (!values.length) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest]));
}
function raceOutcomes(n: number): number[][] {
  const outcomes: number[][] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const finishers = Array.from({ length: n }, (_, i) => i).filter((i) => (mask & (1 << i)) === 0);
    for (const order of permutations(finishers.map((_, i) => n - i))) {
      const points = Array<number>(n).fill(0);
      finishers.forEach((teamIndex, i) => { points[teamIndex] = order[i]; });
      outcomes.push(points);
    }
  }
  return outcomes;
}
function oracle(initial: number[], candidate: number, places: number, rounds: number) {
  const outcomes = raceOutcomes(initial.length);
  let worst = -Infinity;
  const gains = new Set<number>();
  function ride(points: number[], remaining: number) {
    if (remaining) {
      for (const outcome of outcomes) ride(points.map((value, i) => value + outcome[i]), remaining - 1);
      return;
    }
    const gain = points[candidate] - initial[candidate];
    gains.add(gain);
    if (points.filter((value, i) => i !== candidate && value >= points[candidate]).length >= places) worst = Math.max(worst, gain);
  }
  ride(initial, rounds);
  if (worst === -Infinity) return { guaranteed: true, toStay: undefined };
  const safe = [...gains].filter((gain) => gain > worst);
  return { guaranteed: undefined, toStay: safe.length ? Math.min(...safe) : null };
}

describe('agrees with every possible result, eliminations included', () => {
  it('over two races of four teams, with half points and ties', () => {
    const sessions = [session(1, [heat(1, [1, 2, 3, 4], races(1, 2))])];
    let checked = 0;
    for (const a of [0, 1, 3.5, 6]) for (const b of [0, 1, 3.5, 6]) for (const c of [0, 1, 3.5, 6]) for (const d of [0, 1, 3.5, 6]) {
      const initial = [a, b, c, d];
      const list = toplist(initial, sessions, 2);
      if (list.cutAfter == null) continue;
      for (const row of list.rows.slice(0, list.cutAfter + 1)) {
        const expected = oracle(initial, row.teamId - 1, 2, 2);
        expect({ initial, teamId: row.teamId, guaranteed: row.guaranteed, toStay: row.toStay, unknown: row.neededUnavailable })
          .toEqual({ initial, teamId: row.teamId, ...expected, unknown: undefined });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('over one race of five teams with three places', () => {
    const sessions = [session(1, [heat(1, [1, 2, 3, 4, 5], races(1, 1))])];
    for (const initial of [[9, 8, 7, 6, 5], [9, 7, 7, 7, 3], [12, 6.5, 6, 4, 4], [10, 10, 9, 5, 5], [8, 8, 8, 8, 8]]) {
      const list = toplist(initial, sessions, 3);
      for (const row of list.rows.slice(0, (list.cutAfter ?? -1) + 1)) {
        expect({ initial, teamId: row.teamId, guaranteed: row.guaranteed, toStay: row.toStay })
          .toEqual({ initial, teamId: row.teamId, ...oracle(initial, row.teamId - 1, 3, 1) });
      }
    }
  });
});
