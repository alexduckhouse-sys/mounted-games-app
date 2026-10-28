import { describe, expect, it } from 'vitest';
import { TieBreakRule, type Heat, type Race, type ResultRow } from '../types';
import { heatFinishedSentence, heatTotals, placeText, summariseRace, type SummaryInput } from './raceSummary';

const TEAMS = [1, 2, 3, 4];
const none = new Set<number>();

const heat = (stage?: number, teamIds = TEAMS): Heat => ({
  id: 1, sessionId: 1, orderIndex: 0, raceRoundStage: stage as never,
  entries: teamIds.map((id, i) => ({ id, teamId: id, teamName: `Team ${String.fromCharCode(64 + id)}`, laneIndex: i })),
  races: [],
});

const row = (teamId: number, placing: number | null, points: number, over: Partial<ResultRow> = {}): ResultRow => ({
  id: teamId * 100 + (placing ?? 9), teamId, teamName: '', placing, eliminated: false, points, ...over,
});

const race = (orderIndex: number, results: ResultRow[], isComplete = true): Race => ({
  id: orderIndex + 1, heatId: 1, name: `Race ${orderIndex + 1}`, orderIndex, isComplete, results,
});

const input = (h: Heat, races: Race[], raceIndex: number, over: Partial<SummaryInput> = {}): SummaryInput => ({
  heat: h, races, raceIndex, hcTeamIds: none, rule: TieBreakRule.Countback, qualifiers: 2, notes: {}, ...over,
});

describe('summariseRace gating', () => {
  it('returns null for a missing or incomplete race', () => {
    const h = heat();
    expect(summariseRace(input(h, [race(0, [], false)], 0))).toBeNull();
    expect(summariseRace(input(h, [], 0))).toBeNull();
  });

  it('only adds an ending after the last race, and only once every race is complete', () => {
    const h = heat();
    const r0 = race(0, [row(1, 1, 4), row(2, 2, 3)]);
    expect(summariseRace(input(h, [r0, race(1, [], false)], 0))!.ending).toBeNull();
    const lastOfTwo = summariseRace(input(h, [race(0, [], false), race(1, [row(1, 1, 4)])], 1))!;
    expect(lastOfTwo.ending).toBeNull();
    expect(summariseRace(input(h, [r0], 0))!.ending).not.toBeNull();
  });
});

describe('summariseRace placings and outs', () => {
  it('ignores sit-outs and unplaced finishers, falls back for unknown teams and uses statuses when there is no note', () => {
    const h = heat(undefined, [1, 2, 3]);
    const r = race(0, [
      row(2, 2, 3), row(1, 1, 4),
      row(3, null, 0),
      row(9, 3, 2),
      row(5, null, 0, { isSitOut: true, eliminated: true }),
      row(3, null, 0, { eliminated: true, status: 2 }),
      row(1, null, 0, { eliminated: true }),
      row(2, null, 0, { eliminated: true, status: 3 }),
    ]);
    const s = summariseRace(input(h, [r], 0, { notes: { 1: '   ', 2: '  Missed a pot  ' } }))!;
    expect(s.placings.map((p) => [p.teamName, p.place])).toEqual([['Team A', 1], ['Team B', 2], ['Team 9', 3]]);
    expect(s.out.map((o) => [o.teamName, o.reason])).toEqual([
      ['Team C', 'Did not start'], ['Team A', 'Eliminated'], ['Team B', 'Missed a pot'],
    ]);
  });

  it('marks hors concours teams in the placings', () => {
    const s = summariseRace(input(heat(), [race(0, [row(1, 1, 4), row(2, 2, 3)])], 0, { hcTeamIds: new Set([2]) }))!;
    expect(s.placings.map((p) => p.hc)).toEqual([false, true]);
    expect(s.totals.map((t) => [t.teamId, t.hc, t.position])).toEqual([[1, false, 1], [3, false, 2], [4, false, 2], [2, true, null]]);
  });
});

describe('heatTotals', () => {
  const h = heat();

  it('counts a team with no results as zero and counts only races up to the given one', () => {
    const r0 = race(0, [row(1, 1, 4)]);
    const r1 = race(1, [row(2, 1, 4)]);
    const t = heatTotals(h, [r0, r1], 0, none, TieBreakRule.Countback);
    expect(t.map((x) => [x.teamId, x.points])).toEqual([[1, 4], [2, 0], [3, 0], [4, 0]]);
  });

  it('separates equal points by most wins, then by lower places, and says why', () => {
    // Teams 1 and 2 both 4 points. Team 1 has a win; team 2 has two seconds.
    const r0 = race(0, [row(1, 1, 3), row(2, 2, 2)]);
    const r1 = race(1, [row(1, 3, 1), row(2, 2, 2)]);
    const t = heatTotals(h, [r0, r1], 1, none, TieBreakRule.Countback);
    expect(t.slice(0, 2).map((x) => [x.teamId, x.points, x.position])).toEqual([[1, 4, 1], [2, 4, 2]]);
    expect(t[0].why).toBe('most wins');

    // Both have one win and one third place, but team 4 has an extra second place.
    const a = race(0, [row(3, 1, 3), row(4, 1, 3)]);
    const b = race(1, [row(3, 2, 1), row(4, 3, 1)]);
    const c = race(2, [row(3, 3, 1), row(4, 2, 1)]);
    const same = heatTotals(heat(), [a, b, c], 2, none, TieBreakRule.Countback);
    expect(same[0].points).toBe(same[1].points);
    expect(same[0].position).toBe(1);
    expect(same[1].position).toBe(1);
    expect(same[0].why).toBeNull();

    // Same wins, different second places.
    const x = race(0, [row(1, 1, 3), row(2, 1, 3)]);
    const y = race(1, [row(1, 2, 1), row(2, 3, 1)]);
    const z = race(2, [row(1, 3, 1), row(2, 3, 1), row(3, 2, 3)]);
    const second = heatTotals(heat(), [x, y, z], 2, none, TieBreakRule.Countback).filter((r) => r.points === 5);
    expect(second.map((r) => r.teamId)).toEqual([1, 2]);
    expect(second[0].why).toBe('more 2nd places');
  });

  it('uses the most recent race first under the last-race rule', () => {
    const r0 = race(0, [row(1, 1, 3), row(2, 2, 1)]);
    const r1 = race(1, [row(2, 1, 3), row(1, 2, 1)]);
    const t = heatTotals(heat(), [r0, r1], 1, none, TieBreakRule.LastRace);
    expect(t.slice(0, 2).map((x) => x.teamId)).toEqual([2, 1]);
    expect(t[0].why).toBe('better score in the most recent race');
  });

  it('falls through to countback when the last race does not split them', () => {
    const r0 = race(0, [row(1, 1, 3), row(2, 2, 2)]);
    const r1 = race(1, [row(1, 2, 2), row(2, 1, 3)]);
    // Here the latest race differs (team 2 scored more), so it decides. Below, identical latest races fall through.
    const eq0 = race(0, [row(1, 1, 2), row(2, 2, 2)]);
    const eq1 = race(1, [row(1, 3, 1), row(2, 3, 1)]);
    const t = heatTotals(heat(), [eq0, eq1], 1, none, TieBreakRule.LastRace);
    expect(t[0].teamId).toBe(1);
    expect(t[0].why).toBe('most wins');
    expect(heatTotals(heat(), [r0, r1], 1, none, TieBreakRule.LastRace)[0].teamId).toBe(2);
  });

  it('shares a place without a reason under run-off and manual rules', () => {
    const r0 = race(0, [row(1, 1, 3), row(2, 2, 3)]);
    for (const rule of [TieBreakRule.RunOff, TieBreakRule.Manual]) {
      const t = heatTotals(heat(), [r0], 0, none, rule);
      expect(t.slice(0, 2).map((x) => [x.teamId, x.position, x.why])).toEqual([[1, 1, null], [2, 1, null]]);
    }
  });

  it('lists hors concours teams last, unranked, ordered by points', () => {
    const r0 = race(0, [row(1, 1, 4), row(2, 2, 3), row(3, 3, 2)]);
    const t = heatTotals(heat(), [r0], 0, new Set([1, 3]), TieBreakRule.Countback);
    expect(t.map((x) => [x.teamId, x.hc, x.position])).toEqual([[2, false, 1], [4, false, 2], [1, true, null], [3, true, null]]);
  });

  it('ignores sit-outs and eliminated or unplaced results when counting places', () => {
    const r0 = race(0, [
      row(1, 1, 3), row(2, null, 3), row(2, 1, 0, { isSitOut: true }), row(3, 1, 0, { eliminated: true }),
    ]);
    const t = heatTotals(heat(), [r0], 0, none, TieBreakRule.Countback);
    expect(t.find((x) => x.teamId === 2)!.points).toBe(3);
    expect(t.find((x) => x.teamId === 3)!.points).toBe(0);
  });
});

describe('summariseRace endings', () => {
  it('lists a heat result with singular points, tie reasons and a level note', () => {
    const h = heat(undefined, [1, 2, 3]);
    const r = race(0, [row(1, 1, 1), row(2, 2, 0.5), row(3, 3, 0.5)]);
    const s = summariseRace(input(h, [r], 0, { rule: TieBreakRule.Countback }))!;
    expect(s.ending!.heading).toBe('Heat result');
    expect(s.ending!.lines[0]).toBe('1st Team A: 1 point');
    expect(s.ending!.lines[1]).toBe('2nd Team B: 0.5 points, ahead on tie-break: more 2nd places');
    expect(s.ending!.lines).toHaveLength(3);
  });

  it('notes teams still level after the tie-break, with wording that depends on the rule', () => {
    const h = heat(undefined, [1, 2]);
    const r = race(0, [row(1, 1, 3), row(2, 1, 3)]);
    expect(summariseRace(input(h, [r], 0))!.ending!.lines.at(-1))
      .toBe('Some teams are still level after the tie-break: the organiser decides the order.');
    expect(summariseRace(input(h, [r], 0, { rule: TieBreakRule.RunOff }))!.ending!.lines.at(-1))
      .toBe('Teams are level on points: the organiser decides the order.');
  });

  it('calls the second stage the final result and lists hors concours teams without a place', () => {
    const h = heat(2, [1, 2]);
    const r = race(0, [row(1, 1, 5), row(2, 2, 1)]);
    const s = summariseRace(input(h, [r], 0, { hcTeamIds: new Set([2]) }))!;
    expect(s.ending!.heading).toBe('Final result');
    expect(s.ending!.lines).toEqual(['1st Team A: 5 points', 'Team B: hors concours, 1 points, not ranked']);
  });

  it('picks the qualifiers for a qualifier heat, skipping hors concours and listing the out', () => {
    const h = heat(1, [1, 2, 3, 4]);
    const r0 = race(0, [row(1, 1, 4), row(2, 2, 3), row(3, 3, 2), row(4, null, 0, { eliminated: true, status: 4 })]);
    const r1 = race(1, [row(9, 1, 4)]);
    const s = summariseRace(input(h, [r0, r1], 1, { hcTeamIds: new Set([1]), qualifiers: 1, notes: { 4: 'Fell off' } }))!;
    expect(s.ending!.heading).toBe('Through to the final');
    expect(s.ending!.lines).toEqual([
      'Team 9: qualified 1st, through to the final',
      'Team B: not through. Placed 2nd and only the top 1 go through',
      'Team C: not through. Placed 3rd and only the top 1 go through',
      'Team A (HC): hors concours, does not take a place in the final',
      'Team D: out of the qualifier. Fell off',
    ]);
  });

  it('uses status wording for qualifier outs without a note, and ignores unplaced or sit-out results', () => {
    const h = heat(1, [1, 2]);
    const r0 = race(0, [row(1, 1, 4), row(2, null, 0, { eliminated: true, status: 2 }), row(2, 2, 0, { isSitOut: true }), row(1, null, 0)]);
    const s = summariseRace(input(h, [r0], 0, { qualifiers: 1 }))!;
    expect(s.ending!.lines).toEqual([
      'Team A: qualified 1st, through to the final',
      'Team B: out of the qualifier. Did not start',
    ]);
  });

  it('counts repeated wins for the same team and names a one point hors concours total', () => {
    const h = heat(undefined, [1, 2]);
    const r0 = race(0, [row(1, 1, 2), row(2, 2, 1)]);
    const r1 = race(1, [row(1, 1, 2), row(2, 2, 1)]);
    const s = summariseRace(input(h, [r0, r1], 1, { hcTeamIds: new Set([2]) }))!;
    expect(s.totals[0]).toMatchObject({ teamId: 1, points: 4 });
    expect(s.ending!.lines).toEqual(['1st Team A: 4 points', 'Team B: hors concours, 2 points, not ranked']);
  });
});

describe('joint places and the heat-finished sentence', () => {
  it('reads a shared place as =1st and a sole place as 1st', () => {
    expect(placeText(1, true)).toBe('=1st');
    expect(placeText(3, false)).toBe('3rd');
  });

  it('marks joint places in a race and in the heat totals, and leaves hors concours unranked', () => {
    const h = heat();
    const r0 = race(0, [row(1, 1, 4), row(2, 1, 4), row(3, 3, 2), row(4, 4, 1)]);
    const s = summariseRace(input(h, [r0], 0, { rule: TieBreakRule.Manual, hcTeamIds: new Set([4]) }))!;
    expect(s.placings.map((p) => [p.teamId, p.joint, p.hc])).toEqual([[1, true, false], [2, true, false], [3, false, false], [4, false, true]]);
    expect(s.totals.map((t) => [t.teamId, t.position, t.joint, t.hc])).toEqual([[1, 1, true, false], [2, 1, true, false], [3, 3, false, false], [4, null, false, true]]);
    expect(s.ending!.lines[0]).toContain('=1st Team A');
    expect(s.ending!.lines[2]).toContain('3rd Team C');
    expect(s.ending!.lines[3]).toContain('Team D: hors concours');
  });

  it('names the winner, names a tie at the top together, and never names hors concours', () => {
    const t = (rows: Array<[number, number, boolean]>) => heatTotals(heat(), [race(0, rows.map(([id, pts]) => row(id, id, pts)))], 0, new Set(rows.filter((r) => r[2]).map((r) => r[0])), TieBreakRule.Manual);
    expect(heatFinishedSentence('Heat 2', t([[1, 4, false], [2, 3, false]]))).toBe('Heat 2 finished. Team A won.');
    expect(heatFinishedSentence('Heat 2', t([[1, 4, true], [2, 3, false]]))).toBe('Heat 2 finished. Team B won.');
    expect(heatFinishedSentence('Final', t([[1, 4, false], [2, 4, false]]))).toBe('Final finished. Team A and Team B are level at the top.');
    expect(heatFinishedSentence('Final', t([[1, 4, false], [2, 4, false], [3, 4, false]]))).toBe('Final finished. Team A, Team B and Team C are level at the top.');
    expect(heatFinishedSentence('Heat 1', [])).toBe('Heat 1 finished.');
    expect(heatFinishedSentence('Heat 1', t([[1, 0, false]]))).toBe('Heat 1 finished.');
  });
});
