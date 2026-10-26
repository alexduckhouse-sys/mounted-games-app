import { describe, expect, it } from 'vitest';
import type { Heat, Session } from '../types';
import { heat as baseHeat, race, result, session as baseSession, standing, team as baseTeam } from '../test/factories';
import { buildToplist, explainTieBreak, ordinal, sectionScoreVersion, toplistNote, type ToplistRow } from './toplist';

const SECTION = 9;
const entries = (teamIds: number[]): Heat['entries'] => teamIds.map((teamId, lane) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: lane }));
const heat = (id: number, teamIds: number[], races: Heat['races'], extra: Partial<Heat> = {}) => baseHeat(id, { entries: entries(teamIds), races, ...extra });
const session = (id: number, heats: Heat[], extra: Partial<Session> = {}) => baseSession(id, { competitionSectionId: SECTION, sectionName: 'Seniors', name: 'Seniors heats', heats, ...extra });
const scored = (id: number, ...pairs: [teamId: number, points: number][]) => race(id, { isComplete: true, results: pairs.map(([teamId, points]) => result(teamId, 1, { points })) });
const team = (id: number, extra: Parameters<typeof baseTeam>[1] = {}) => baseTeam(id, { competitionSectionId: SECTION, ...extra });
const row = (extra: Partial<ToplistRow>): ToplistRow => ({ teamId: 1, teamName: 'T', points: 0, position: 1, joint: false, runoff: false, out: false, needed: null, racesLeft: 0, withdrawn: false, bonus: 0, ...extra });

describe('ordinal', () => {
  it('reads naturally, including the teens', () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th']);
  });
});

describe('buildToplist positions', () => {
  it('lets tied teams share a position and skips the next one', () => {
    const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 8), standing(4, 5)], [], [], SECTION, null);
    expect(list.rows.map((r) => [r.position, r.joint])).toEqual([[1, false], [2, true], [2, true], [4, false]]);
  });

  it('sorts standings by points without changing the input', () => {
    const input = [standing(1, 3), standing(2, 9)];
    expect(buildToplist(input, [], [], SECTION, null).rows.map((r) => r.teamId)).toEqual([2, 1]);
    expect(input.map((s) => s.teamId)).toEqual([1, 2]);
  });

  it('puts A finalists above B finalists above everyone else, then orders by points within each', () => {
    const input = [
      { ...standing(1, 7), finalTier: 0 },
      { ...standing(2, 10), finalTier: 1 },
      { ...standing(3, 12), finalTier: 0 },
      { ...standing(4, 20), finalTier: null },
      { ...standing(5, 5), finalTier: 1 },
    ];
    const list = buildToplist(input, [], [], SECTION, null);
    expect(list.rows.map((r) => r.teamId)).toEqual([3, 1, 2, 5, 4]);
    expect(list.rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not tie teams on equal points when they are in different finals', () => {
    const list = buildToplist([{ ...standing(1, 7), finalTier: 0 }, { ...standing(2, 7), finalTier: 1 }, { ...standing(3, 7), finalTier: 1 }], [], [], SECTION, null);
    expect(list.rows.map((r) => [r.teamId, r.position, r.joint])).toEqual([[1, 1, false], [2, 2, true], [3, 2, true]]);
  });

  it('keeps plain points order when no team has a final tier', () => {
    const list = buildToplist([standing(1, 3), { ...standing(2, 9), finalTier: null }, standing(3, 6)], [], [], SECTION, null);
    expect(list.rows.map((r) => r.teamId)).toEqual([2, 3, 1]);
  });

  it('is empty for no standings', () => {
    const list = buildToplist([], [], [], SECTION, 3);
    expect(list).toMatchObject({ rows: [], cutAfter: null, runoff: null, hc: [], sessionsDone: 0, sessionsTotal: 0 });
  });
});

describe('buildToplist withdrawn teams', () => {
  it('keeps their points and marks them withdrawn', () => {
    const list = buildToplist([{ ...standing(1, 10), withdrawn: true }, standing(2, 8)], [], [], SECTION, null);
    expect(list.rows.map((r) => [r.teamId, r.points, r.withdrawn])).toEqual([[1, 10, true], [2, 8, false]]);
    expect(toplistNote(list.rows[0])).toBe('Withdrawn');
  });
});

describe('toplist note with tack bonus points', () => {
  it('says how many of the points are tack bonus, alongside any other note', () => {
    expect(toplistNote(row({ bonus: 1 }))).toBe('1 tack bonus point');
    expect(toplistNote(row({ bonus: 3, withdrawn: true }))).toBe('Withdrawn · 3 tack bonus points');
    expect(toplistNote(row({}))).toBeNull();
  });
});

describe('buildToplist final cut-off', () => {
  it('draws no line when no final places are set', () => {
    for (const places of [null, undefined, 0]) {
      const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 6)], [], [], SECTION, places);
      expect(list.cutAfter).toBeNull();
      expect(list.rows.every((r) => !r.out && r.needed == null)).toBe(true);
    }
  });

  it('draws no line when everyone makes the final', () => {
    expect(buildToplist([standing(1, 10), standing(2, 8)], [], [], SECTION, 2).cutAfter).toBeNull();
    expect(buildToplist([standing(1, 10), standing(2, 8)], [], [], SECTION, 5).cutAfter).toBeNull();
  });

  it('draws no line before anyone has scored', () => {
    const list = buildToplist([standing(1, 0), standing(2, 0), standing(3, 0)], [], [], SECTION, 2);
    expect(list).toMatchObject({ cutAfter: null, runoff: null });
  });

  it('puts the line under the last finalist and tells teams below what they need', () => {
    const sessions = [session(1, [heat(1, [3, 90, 91], [race(1), race(2)])])];
    const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 5)], sessions, [team(90, { isHorsConcours: true }), team(91, { isHorsConcours: true })], SECTION, 2);
    expect(list.cutAfter).toBe(1);
    expect(list.runoff).toBeNull();
    expect(list.rows.map((r) => r.out)).toEqual([false, false, true]);
    expect(list.rows[2]).toMatchObject({ needed: 6, racesLeft: 2 });
    expect(toplistNote(list.rows[2])).toBe('6 needed to make the final (normal finishes)');
  });

  it('does not say what a team below the line needs once it has no races left', () => {
    const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 5)], [], [], SECTION, 2);
    expect(list.rows[2]).toMatchObject({ out: true, needed: null });
  });

  it('turns a tie across the line into a run-off and moves the line below the tied teams', () => {
    const list = buildToplist([standing(1, 12), standing(2, 9), standing(3, 9), standing(4, 4)], [], [], SECTION, 2);
    expect(list.runoff!.teams.map((r) => r.teamId)).toEqual([2, 3]);
    expect(list.runoff!.place).toBe(2);
    expect(list.cutAfter).toBe(2);
    expect(list.rows.map((r) => r.runoff)).toEqual([false, true, true, false]);
    expect(list.rows.map((r) => r.out)).toEqual([false, false, false, true]);
    expect(toplistNote(list.rows[1])).toBe('Joint 2nd · run-off');
  });

  it('does not call a tie a run-off when the tied teams all fit above the line', () => {
    const list = buildToplist([standing(1, 12), standing(2, 9), standing(3, 9), standing(4, 4)], [], [], SECTION, 3);
    expect(list.runoff).toBeNull();
    expect(list.cutAfter).toBe(2);
  });

  it('calculates the true points needed using heat slot conservation and marks mathematically eliminated teams as null', () => {
    // 4 teams in a single heat (slots 4, 3, 2, 1) with 1 race left and top 2 making the final:
    // Team 1 has 12, Team 2 has 10 (cut-off), Team 3 has 8, Team 4 has 5.
    // Naive gap for Team 3 would be 10 - 8 + 1 = 3 (reaching 11), but if Team 3 takes 3 pts,
    // the remaining slots are {4, 2, 1} so Team 2 gets at least 1 pt (reaching 11).
    // Thus Team 3 actually needs 4 pts (1st place, reaching 12 while Team 2 gets 1 pt -> 11).
    // Team 4 (5 pts, maxGain 4 -> 9 < 10) is mathematically eliminated (needed: null).
    const sessions = [session(1, [heat(1, [1, 2, 3, 4], [scored(1, [1, 4], [2, 3], [3, 2], [4, 1]), race(2)])], { lanesPerHeat: 4 })];
    const list = buildToplist(
      [standing(1, 12), standing(2, 10), standing(3, 8), standing(4, 5)],
      sessions,
      [],
      SECTION,
      2,
    );
    expect(list.rows.find((r) => r.teamId === 3)?.needed).toBe(4);
    expect(list.rows.find((r) => r.teamId === 4)?.needed).toBeNull();
  });

  it('returns maxGain when winning every remaining race ties the cut-off for a run-off, or null if rivals still pull ahead', () => {
    // 4-team heat, 1 race left (slots 4, 3, 2, 1), top 2 make the final.
    // Team 1 = 20, Team 2 = 13, Team 3 = 10 (maxGain = 4 -> 14), Team 4 = 9 (maxGain = 4 -> 13, but Team 2 gets at least +1 -> 14).
    const sessions = [session(1, [heat(1, [1, 2, 3, 4], [race(1)])], { lanesPerHeat: 4 })];
    const list = buildToplist(
      [standing(1, 20), standing(2, 13), standing(3, 10), standing(4, 9)],
      sessions,
      [],
      SECTION,
      2,
    );
    // Team 3 scoring 4 reaches 14, tying Team 2 (13 + 1 = 14) for a run-off.
    expect(list.rows.find((r) => r.teamId === 3)?.needed).toBe(4);
    // Team 4 scoring 4 only reaches 13 while Team 2 reaches at least 14, so Team 4 is eliminated.
    expect(list.rows.find((r) => r.teamId === 4)?.needed).toBeNull();
  });

  it('handles qualifier round stage (1 point per finisher) and sit-out entries when computing points needed', () => {
    const sitOutRace = race(1, { isComplete: false, results: [result(3, null, { isSitOut: true })] });
    const qualifierHeat = heat(1, [1, 2, 3, 4], [sitOutRace, race(2)], { raceRoundStage: 1 });
    const sessions = [session(1, [qualifierHeat])];
    const list = buildToplist(
      [standing(1, 5), standing(2, 3), standing(3, 2), standing(4, 2)],
      sessions,
      [],
      SECTION,
      2,
    );
    // Team 3 sits out race 1, so maxGain is 1 (from race 2); 2 + 1 = 3 ties Team 2 if Team 2 didn't score, but in stage 1 every active team gets 1 pt per race.
    expect(list.rows.find((r) => r.teamId === 3)?.needed).toBeNull();
  });
});

describe('buildToplist from sessions', () => {
  const doneHeats = session(1, [heat(1, [1, 2], [scored(1, [1, 2], [2, 1])])], { status: 2 });
  const upcoming = session(2, [heat(2, [1, 2], [race(2), race(3)])]);
  const finals = session(3, [heat(3, [1, 2], [race(4)])], { name: 'Seniors finals' });

  it('counts sessions done and total and sums races left, leaving finals out', () => {
    const list = buildToplist([standing(1, 2), standing(2, 1)], [doneHeats, upcoming, finals], [], SECTION, null);
    expect(list.sessionsDone).toBe(1);
    expect(list.sessionsTotal).toBe(2);
    expect(list.rows[0].racesLeft).toBe(2);
    expect(toplistNote(list.rows[0])).toBe('2 races left');
  });

  it('counts a session as done when every heat has finished', () => {
    const allDone = session(1, [heat(1, [1], [scored(1, [1, 2])]), heat(2, [1], [race(2)], { finishedAt: '2026-06-01T10:00:00Z' })]);
    const empty = session(2, []);
    expect(buildToplist([], [allDone, empty], [], SECTION, null).sessionsDone).toBe(1);
  });

  it('gives points per session in running order with one column each', () => {
    const list = buildToplist([standing(1, 2), standing(2, 1)], [upcoming, doneHeats], [], SECTION, null);
    expect(list.bySession.sessions).toEqual([{ id: 1, label: 'S1', title: 'Session 1' }, { id: 2, label: 'S2', title: 'Session 2' }]);
    expect(list.bySession.cells.get(1)).toEqual([2, 0]);
    expect(list.bySession.cells.get(2)).toEqual([1, 0]);
  });

  it('adds a finals column once finals have points so the columns add up to the total', () => {
    const decided = session(3, [heat(3, [1], [scored(4, [1, 3])], { raceRoundStage: 2 })], { name: 'Seniors' });
    const list = buildToplist([standing(1, 5)], [doneHeats, decided], [], SECTION, null);
    expect(list.bySession.sessions.map((s) => s.label)).toEqual(['S1', 'F']);
    expect(list.bySession.cells.get(1)).toEqual([2, 3]);
  });

  it('adds a tack bonus column after finals so the columns still add up to the total', () => {
    const decided = session(3, [heat(3, [1], [scored(4, [1, 3])], { raceRoundStage: 2 })], { name: 'Seniors' });
    const list = buildToplist([{ ...standing(1, 9), bonusPoints: 4 }, standing(2, 1), { ...standing(8, 2), bonusPoints: 2 }], [doneHeats, decided], [], SECTION, null);
    expect(list.bySession.sessions.map((s) => s.label)).toEqual(['S1', 'F', 'T']);
    expect(list.bySession.sessions[2].title).toBe('Tack check bonus points');
    expect(list.bySession.cells.get(1)).toEqual([2, 3, 4]);
    expect(list.bySession.cells.get(2)).toEqual([1, 0, 0]);
    // A team with only bonus points still gets a row of cells.
    expect(list.bySession.cells.get(8)).toEqual([0, 0, 2]);
    expect(list.rows.find((r) => r.teamId === 1)?.bonus).toBe(4);
  });

  it('has no tack bonus column when nobody has bonus points', () => {
    const list = buildToplist([{ ...standing(1, 2), bonusPoints: 0 }], [doneHeats], [], SECTION, null);
    expect(list.bySession.sessions.map((s) => s.label)).toEqual(['S1']);
    expect(list.rows[0].bonus).toBe(0);
  });

  it('shows a finals-only team with zeroes in its session columns', () => {
    const decided = session(3, [heat(3, [7], [scored(4, [7, 3])], { label: 'Final' })], { name: 'Seniors' });
    const list = buildToplist([standing(7, 3)], [doneHeats, decided], [], SECTION, null);
    expect(list.bySession.cells.get(7)).toEqual([0, 3]);
  });

  it('ignores other age groups and non-race sessions', () => {
    const other = session(5, [heat(5, [1], [scored(9, [1, 100])])], { competitionSectionId: 77 });
    const lunch = session(6, [heat(6, [1], [scored(10, [1, 100])])], { kind: 1 });
    const list = buildToplist([standing(1, 2)], [doneHeats, other, lunch], [], SECTION, null);
    expect(list.sessionsTotal).toBe(1);
    expect(list.bySession.cells.get(1)).toEqual([2]);
  });

  it('treats a legacy break flag as a break', () => {
    const legacy = { ...session(5, [heat(5, [1], [scored(9, [1, 100])])], { isBreak: true }), kind: undefined } as unknown as Session;
    expect(buildToplist([standing(1, 0)], [legacy], [], SECTION, null).sessionsTotal).toBe(0);
  });

  it('skips a heat entirely once its heat is finished when counting races left', () => {
    const list = buildToplist([standing(1, 0)], [session(1, [heat(1, [1], [race(1)], { finishedAt: '2026-06-01T10:00:00Z' })])], [], SECTION, null);
    expect(list.rows[0].racesLeft).toBe(0);
  });
});

describe('buildToplist hors concours', () => {
  it('lists them apart with their own points, best first then by name, for this age group only', () => {
    const sessions = [session(1, [heat(1, [5, 6, 8], [scored(1, [5, 4], [6, 4], [8, 1])])])];
    const teams = [
      team(1), team(5, { isHorsConcours: true, displayName: 'Zed' }), team(6, { isHorsConcours: true, displayName: 'Abe' }),
      team(7, { isHorsConcours: true, displayName: 'Nobody' }), team(8, { isHorsConcours: true, displayName: 'Low' }),
      team(9, { isHorsConcours: true, competitionSectionId: 10 }),
    ];
    expect(buildToplist([standing(1, 3)], sessions, teams, SECTION, null).hc).toEqual([
      { teamId: 6, teamName: 'Abe', points: 4, racesLeft: 0 },
      { teamId: 5, teamName: 'Zed', points: 4, racesLeft: 0 },
      { teamId: 8, teamName: 'Low', points: 1, racesLeft: 0 },
      { teamId: 7, teamName: 'Nobody', points: 0, racesLeft: 0 },
    ]);
  });
});

describe('buildToplist finals and team detail', () => {
  const qualifier = session(1, [heat(1, [1, 2, 3], [scored(1, [1, 3], [2, 2], [3, 1])], { label: 'Heat 1' })], { status: 2 });
  const finalHeat = (id: number, label: string, races: Heat['races'], teamIds: number[], extra: Partial<Heat> = {}) =>
    heat(id, teamIds, races, { label, raceRoundStage: 2, orderIndex: id, ...extra });
  const finalsSession = (heats: Heat[], extra: Partial<Session> = {}) => session(2, heats, { name: 'Seniors finals', orderIndex: 2, ...extra });
  const standings = [standing(1, 10), standing(2, 8), standing(3, 6)];

  it('has no finals until a final heat has results', () => {
    const list = buildToplist(standings, [qualifier, finalsSession([finalHeat(2, 'A Final', [race(2)], [1, 2, 3])])], [], SECTION, null);
    expect(list.finals).toEqual([]);
    expect(list.detail.get(1)!.final).toBeNull();
  });

  it('orders a final by points, shares places between ties and adds the qualifying position', () => {
    const decided = finalsSession([finalHeat(2, 'A Final', [scored(2, [3, 5], [1, 5], [2, 2])], [1, 2, 3])]);
    const [group] = buildToplist(standings, [qualifier, decided], [], SECTION, null).finals;
    expect(group.label).toBe('A Final');
    expect(group.rows.map((r) => [r.teamId, r.place, r.points, r.qualifyingPosition])).toEqual([[1, 1, 5, 1], [3, 1, 5, 3], [2, 3, 2, 2]]);
  });

  it('adds up several races, keeps teams with no result last and lists finals in running order', () => {
    const a = finalHeat(5, 'B Final', [scored(5, [4, 2]), scored(6, [4, 3])], [4, 5]);
    const b = finalHeat(2, 'A Final', [scored(2, [1, 4])], [1, 2]);
    const list = buildToplist(standings, [qualifier, finalsSession([a, b])], [], SECTION, null);
    expect(list.finals.map((g) => g.label)).toEqual(['A Final', 'B Final']);
    expect(list.finals[0].rows.map((r) => [r.teamId, r.place, r.points])).toEqual([[1, 1, 4], [2, null, null]]);
    expect(list.finals[1].rows).toEqual([{ teamId: 4, teamName: 'Team 4', place: 1, points: 5, qualifyingPosition: null }, { teamId: 5, teamName: 'Team 5', place: null, points: null, qualifyingPosition: null }]);
    expect(list.finals[1].races.get(4)!.map((r) => [r.name, r.points])).toEqual([['Race 5', 2], ['Race 6', 3]]);
  });

  it('labels a final from its session when the heat label has no final wording', () => {
    const named = session(2, [heat(2, [1], [scored(2, [1, 4])], { label: 'Heat 1' }), heat(3, [2], [scored(3, [2, 4])])], { name: 'Seniors final', orderIndex: 2 });
    expect(buildToplist(standings, [qualifier, named], [], SECTION, null).finals.map((g) => g.label)).toEqual(['Seniors final · Heat 1', 'Seniors final']);
  });

  it('ranks qualifying without the finals points and not at all before anyone has scored', () => {
    const decided = finalsSession([finalHeat(2, 'A Final', [scored(2, [2, 9])], [2])]);
    const list = buildToplist([standing(2, 11), standing(1, 3)], [qualifier, decided], [], SECTION, null);
    expect(list.detail.get(2)).toMatchObject({ qualifyingPosition: 2, qualifyingPoints: 2 });
    expect(list.detail.get(1)).toMatchObject({ qualifyingPosition: 1, qualifyingPoints: 3 });
    const empty = buildToplist(standings, [session(1, [heat(1, [1], [race(1)])])], [], SECTION, null);
    expect(empty.detail.get(1)).toMatchObject({ qualifyingPosition: null, qualifyingPoints: 0 });
  });

  it('breaks a team down by finals first, then each session with its races, and notes who did not ride', () => {
    const second = session(3, [heat(3, [2], [race(3)], { label: 'Heat 2' })], { orderIndex: 3 });
    const decided = finalsSession([finalHeat(4, 'A Final', [scored(4, [1, 6], [2, 4])], [1, 2])]);
    const { detail } = buildToplist(standings, [qualifier, second, decided], [], SECTION, null);
    const one = detail.get(1)!;
    expect(one.final).toEqual({ label: 'A Final', place: 1, points: 6 });
    expect(one.blocks.map((b) => [b.kind, b.label, b.points, b.note])).toEqual([['final', 'A Final', 6, 'not carried over'], ['session', 'Session 1 · Heat 1', 3, null], ['session', 'Session 2', null, null]]);
    expect(one.blocks[0].races).toEqual([{ id: 11, name: 'Race 4', placing: 1, eliminated: false, points: 6 }]);
    expect(one.blocks[1].races.map((r) => [r.name, r.placing, r.points])).toEqual([['Race 1', 1, 3]]);
    const two = detail.get(2)!;
    expect(two.blocks[2]).toMatchObject({ label: 'Session 2 · Heat 2', points: 0, races: [] });
  });

  it('includes finalists that are not in the standings', () => {
    const decided = finalsSession([finalHeat(2, 'A Final', [scored(2, [8, 3])], [8])]);
    expect(buildToplist(standings, [qualifier, decided], [], SECTION, null).detail.get(8)).toMatchObject({ teamName: 'Team 8', qualifyingPosition: null, final: { points: 3 } });
  });
});

describe('toplistNote', () => {
  it('prefers the run-off, then what is needed, then races left', () => {
    expect(toplistNote(row({ runoff: true, position: 3, needed: 2, racesLeft: 4 }))).toBe('Joint 3rd · run-off');
    expect(toplistNote(row({ needed: 2, racesLeft: 4 }))).toBe('2 needed to make the final (normal finishes)');
    expect(toplistNote(row({ racesLeft: 1 }))).toBe('1 race left');
    expect(toplistNote(row({ racesLeft: 4 }))).toBe('4 races left');
    expect(toplistNote(row({ withdrawn: true, racesLeft: 4 }))).toBe('Withdrawn');
  });

  it('has nothing to say when there is nothing worth saying', () => {
    expect(toplistNote(row({}))).toBeNull();
  });

  it('still says how many are needed when the figure is zero', () => {
    expect(toplistNote(row({ needed: 0 }))).toBe('0 needed to make the final (normal finishes)');
  });
});

describe('buildToplist started', () => {
  it('is false while nobody has points and no race has results', () => {
    const open = session(1, [heat(1, [1, 2], [race(1)])]);
    expect(buildToplist([standing(1, 0), standing(2, 0)], [open], [], SECTION, null).started).toBe(false);
    expect(buildToplist([standing(1, 0), standing(2, 0)], [], [], SECTION, null).started).toBe(false);
  });

  it('is true once any team has points', () => {
    expect(buildToplist([standing(1, 3), standing(2, 0)], [], [], SECTION, null).started).toBe(true);
  });

  it('is true once a race in the age group has results, even if every team scored nothing', () => {
    const allOut = race(1, { isComplete: true, results: [result(1, null, { eliminated: true }), result(2, null, { eliminated: true })] });
    const played = session(1, [heat(1, [1, 2], [allOut])]);
    expect(buildToplist([standing(1, 0), standing(2, 0)], [played], [], SECTION, null).started).toBe(true);
  });

  it('ignores results in other age groups', () => {
    const other = session(1, [heat(1, [1, 2], [scored(1, [1, 0])])], { competitionSectionId: SECTION + 1 });
    expect(buildToplist([standing(1, 0), standing(2, 0)], [other], [], SECTION, null).started).toBe(false);
  });
});

describe('buildToplist byGame', () => {
  it('groups non-final race results across heats by game name, excluding HC teams and ranking with ties', () => {
    const r1 = race(1, {
      name: 'Bending',
      orderIndex: 1,
      isComplete: true,
      results: [
        result(1, 1, { points: 5, teamName: 'Alpha' }),
        result(2, 2, { points: 4, teamName: 'Bravo' }),
        result(99, 3, { points: 3, teamName: 'Guest HC' }),
      ],
    });
    const r2 = race(2, {
      name: 'bending',
      orderIndex: 1,
      isComplete: true,
      results: [
        result(3, 1, { points: 5, teamName: 'Charlie' }),
        result(4, null, { points: 0, eliminated: true, teamName: 'Delta' }),
      ],
    });
    const unscored = race(3, { name: 'Mug', orderIndex: 2, isComplete: false, results: [] });
    const s1 = session(1, [
      heat(1, [1, 2, 99], [r1, unscored], { label: 'Heat 1', orderIndex: 1 }),
      heat(2, [3, 4], [r2], { orderIndex: 2 }),
    ], { orderIndex: 1 });
    const s2 = session(2, [
      heat(3, [1], [race(4, { name: 'Flag', isComplete: true, results: [result(1, 1, { points: 5, teamName: 'Alpha' })] })], { label: 'Heat 1', orderIndex: 1 }),
    ], { orderIndex: 2 });

    const singleSessionList = buildToplist(
      [standing(1, 5), standing(2, 4), standing(3, 5), standing(4, 0)],
      [s1],
      [team(99, { isHorsConcours: true })],
      SECTION,
      null,
    );
    expect(singleSessionList.byGame).toHaveLength(1);
    expect(singleSessionList.byGame[0].name).toBe('Bending');
    expect(singleSessionList.byGame[0].rows.map((r) => [r.teamName, r.heatLabel, r.position, r.joint, r.points])).toEqual([
      ['Alpha', 'Heat 1', 1, true, 5],
      ['Charlie', 'Heat 2', 1, true, 5],
      ['Bravo', 'Heat 1', 3, false, 4],
      ['Delta', 'Heat 2', 4, false, 0],
    ]);

    const multiSessionList = buildToplist(
      [standing(1, 10)],
      [s1, s2],
      [team(99, { isHorsConcours: true })],
      SECTION,
      null,
    );
    expect(multiSessionList.byGame.map((g) => g.name)).toEqual(['Bending', 'Flag']);
    expect(multiSessionList.byGame[1].rows[0].heatLabel).toBe('S2 · Heat 1');
  });
});

/** Independent exhaustive oracle: all legal finishing orders, with no pruning or greedy choices. */
function permutations(values: number[]): number[][] {
  if (!values.length) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest]));
}
function normalFinishOracle(initial: number[], candidate: number, places: number, rounds: number) {
  const orders = permutations(initial.map((_, index) => index + 1));
  let outright = Infinity;
  let runoff = Infinity;
  function ride(points: number[], remaining: number) {
    if (remaining) {
      for (const order of orders) ride(points.map((value, index) => value + order[index]), remaining - 1);
      return;
    }
    const gain = points[candidate] - initial[candidate];
    const rivals = points.filter((_, index) => index !== candidate);
    if (rivals.filter((value) => value >= points[candidate]).length < places) outright = Math.min(outright, gain);
    if (rivals.filter((value) => value > points[candidate]).length < places) runoff = Math.min(runoff, gain);
  }
  ride(initial, rounds);
  return Number.isFinite(outright) ? { needed: outright, runoff: false }
    : Number.isFinite(runoff) ? { needed: runoff, runoff: true } : { needed: null, runoff: false };
}

describe('exact normal-finish qualification', () => {
  it.each([
    [[6, 5, 0, 0], 8],
    [[6, 4, 1, 0], 6],
    [[6, 4, 2, 0], 5],
  ])('finds legal multi-race allocations for %j rather than distributing a gain greedily', (points, needed) => {
    const list = buildToplist((points as number[]).map((value, i) => standing(i + 1, value)),
      [session(1, [heat(1, [1, 2, 3, 4], [race(1), race(2)])])], [], SECTION, 2);
    expect(list.rows.find((item) => item.teamId === 3)).toMatchObject({ needed });
  });

  it('agrees with exhaustive legal 4/3/2/1 finishes over two races, including half-point totals and ties', () => {
    const sessions = [session(1, [heat(1, [1, 2, 3, 4], [race(1), race(2)])])];
    for (const a of [0, 1, 3.5, 6]) for (const b of [0, 1, 3.5, 6]) {
      for (const c of [0, 1, 3.5, 6]) for (const d of [0, 1, 3.5, 6]) {
        const initial = [a, b, c, d];
        const list = buildToplist(initial.map((value, i) => standing(i + 1, value)), sessions, [], SECTION, 2);
        for (const item of list.rows.filter((item) => item.out)) {
          const expected = normalFinishOracle(initial, item.teamId - 1, 2, 2);
          expect({ initial, teamId: item.teamId, needed: item.needed, runoff: !!item.neededForRunoff, unknown: !!item.neededUnavailable })
            .toEqual({ initial, teamId: item.teamId, needed: expected.needed, runoff: expected.runoff, unknown: false });
        }
      }
    }
  });

  it('keeps HC in the session base but skips their placing as the scoring API does', () => {
    const list = buildToplist([standing(1, 6), standing(2, 4), standing(3, 1.5)],
      [session(1, [heat(1, [1, 2, 3, 4], [race(1)])])], [team(4, { isHorsConcours: true })], SECTION, 2);
    expect(list.rows.find((item) => item.teamId === 3)?.needed).toBeNull();
  });

  it('does not invent extra points for a lone entrant or derive a future base from manual awards', () => {
    const lone = buildToplist([standing(1, 10), standing(2, 8), standing(3, 5)],
      [session(1, [heat(1, [3], [race(1), race(2)])])], [], SECTION, 2);
    expect(lone.rows[2]).toMatchObject({ needed: null });
    expect(lone.rows[2].neededUnavailable).toBeUndefined();
    const awarded = buildToplist([standing(1, 30), standing(2, 10), standing(3, 1)],
      [session(1, [heat(1, [1, 2, 3], [scored(1, [1, 30]), race(2)])])], [], SECTION, 2);
    expect(awarded.rows[2].needed).toBeNull();
  });

  it('uses the largest field in the session even when the candidate rides in a smaller heat', () => {
    const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 5)],
      [session(1, [heat(1, [1, 2, 4, 5], [scored(1, [1, 4])]), heat(2, [3], [race(2)])])], [], SECTION, 2);
    expect(list.rows[2].needed).toBe(4);
  });

  it('uses the drawn rotation for future sit-outs, including unsorted races and entries', () => {
    const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 5)],
      [session(1, [heat(1, [1, 2, 3], [race(2), race(1)], { entries: [...entries([1, 2, 3])].reverse() })], { lanesPerHeat: 2 })], [], SECTION, 2);
    // Team 3 sits out the first race and can score only 2 in the second, not the naive 4.
    expect(list.rows[2]).toMatchObject({ needed: null });
    expect(list.rows[2].neededUnavailable).toBeUndefined();
  });

  it('never gives withdrawn teams a future award or lets them consume a finishing slot', () => {
    const list = buildToplist([standing(1, 8), { ...standing(2, 6), withdrawn: true }, standing(3, 3)],
      [session(1, [heat(1, [1, 2, 3], [race(1)])])], [], SECTION, 2);
    expect(list.rows[2]).toMatchObject({ needed: 3, neededForRunoff: true });
    expect(toplistNote(list.rows[2])).toBe('3 needed for a run-off (normal finishes)');
  });

  it('finds the minimum run-off gain when no outright finish is possible', () => {
    const list = buildToplist([standing(1, 12), standing(2, 9), standing(3, 8), standing(4, 7)],
      [session(1, [heat(1, [3, 4], [race(1)], { raceRoundStage: 1 })])], [], SECTION, 2);
    expect(list.rows[2]).toMatchObject({ needed: 1, neededForRunoff: true });
  });

  it('has an explicit unknown outcome when a normal-sized search exceeds its work budget', () => {
    const ids = Array.from({ length: 24 }, (_, i) => i + 1);
    const heats = Array.from({ length: 4 }, (_, i) => heat(i + 1, ids.slice(i * 6, i * 6 + 6),
      Array.from({ length: 8 }, (_, j) => race(i * 8 + j + 1))));
    const list = buildToplist(ids.map((id) => standing(id, 25 - id)), [session(1, heats)], [], SECTION, 6);
    const unavailable = list.rows.filter((item) => item.neededUnavailable);
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable.every((item) => item.needed === null && !item.neededForRunoff)).toBe(true);
    expect(toplistNote(unavailable[0])).toBe('Qualification calculation unavailable');
  });

  it('bounds recursion and table sizes for very large programmes without claiming elimination', () => {
    const list = buildToplist([standing(1, 5), standing(2, 4), standing(3, 1)],
      [session(1, [heat(1, [1, 2, 3], Array.from({ length: 200 }, (_, i) => race(i)))])], [], SECTION, 2);
    expect(list.rows[2]).toMatchObject({ needed: null, neededUnavailable: true });
  });
});

it('handles changed opponents across sessions, using complete allocations in each heat', () => {
  const sessions = [
    session(1, [heat(1, [1, 2], [race(1)]), heat(2, [3, 4], [race(2)])]),
    session(2, [heat(3, [1, 3], [race(3)]), heat(4, [2, 4], [race(4)])]),
  ];
  const initial = [6, 4, 2.5, 0];
  const fields = [[0, 1], [2, 3], [0, 2], [1, 3]];
  let minimum = Infinity;
  for (let outcome = 0; outcome < 16; outcome++) {
    const final = [...initial];
    fields.forEach(([a, b], raceIndex) => {
      const aWins = (outcome & (1 << raceIndex)) !== 0;
      final[a] += aWins ? 2 : 1;
      final[b] += aWins ? 1 : 2;
    });
    if (final.filter((points, index) => index !== 2 && points >= final[2]).length < 2) minimum = Math.min(minimum, final[2] - initial[2]);
  }
  expect(minimum).toBe(4);
  const list = buildToplist(initial.map((value, i) => standing(i + 1, value)), sessions, [], SECTION, 2);
  expect(list.rows.find((item) => item.teamId === 3)).toMatchObject({ needed: minimum });
});

describe('sectionScoreVersion', () => {
  it('ignores clocks but invalidates for combined and other-section scores', () => {
    expect(sectionScoreVersion([], null)).toBe('');
    const s1 = session(1, [heat(1, [1, 2], [race(1, { startedAt: '2026-06-01T10:00:00Z' })])]);
    const s1ClockStopped = session(1, [heat(1, [1, 2], [race(1, { startedAt: '2026-06-01T10:00:00Z', finishedAt: '2026-06-01T10:03:00Z' })], { startedAt: '2026-06-01T10:00:00Z' })], { startedAt: '2026-06-01T10:00:00Z' });
    const otherSection = session(2, [heat(2, [8, 9], [scored(2, [8, 5], [9, 3])])], { competitionSectionId: SECTION + 1 });

    const v0 = sectionScoreVersion([s1], SECTION);
    expect(sectionScoreVersion([s1ClockStopped], SECTION)).toBe(v0);
    expect(sectionScoreVersion([s1ClockStopped, otherSection], SECTION)).not.toBe(v0);

    const s1Scored = session(1, [heat(1, [1, 2], [scored(1, [1, 5], [2, 3])])]);
    expect(sectionScoreVersion([s1Scored], SECTION)).not.toBe(v0);
  });
});

describe('projected qualifying cut-off and finals tie-breaking', () => {
  it('projects the cut-off line using lanesPerHeat (default 6) before finals exist when finalistCount is null', () => {
    const standings = Array.from({ length: 8 }, (_, i) => standing(i + 1, 10 - i));
    const sessions = [session(1, [heat(1, [1, 2, 3, 4, 5, 6], [scored(1, [1, 6])])], { lanesPerHeat: 5 })];
    const list = buildToplist(standings, sessions, [], SECTION, null);
    expect(list.cutAfter).toBe(4);
  });

  it('breaks ties in buildFinalGroups using the overall standing rank before teamName localeCompare', () => {
    // Team 1 ("Zebra") is ranked ahead of Team 2 ("Alpha") in overall standings.
    const standings = [
      { ...standing(1, 15), teamName: 'Zebra' },
      { ...standing(2, 15), teamName: 'Alpha' },
    ];
    const finals = session(2, [
      heat(2, [1, 2], [
        race(2, {
          isComplete: true,
          results: [
            result(1, 1, { teamName: 'Zebra', points: 5 }),
            result(2, 1, { teamName: 'Alpha', points: 5 }),
          ],
        }),
      ], { label: 'A Final', raceRoundStage: 2 }),
    ]);
    const list = buildToplist(standings, [finals], [], SECTION, null);
    expect(list.finals[0].rows.map((r) => r.teamName)).toEqual(['Zebra', 'Alpha']);
  });
});

describe('explainTieBreak and tieBreakReason (#71)', () => {
  it('explains countback ties by the highest placing where the two teams differ', () => {
    const r1 = race(1, {
      name: 'Bending',
      orderIndex: 1,
      isComplete: true,
      results: [
        result(1, 1, { points: 4 }),
        result(2, 2, { points: 3 }),
      ],
    });
    const r2 = race(2, {
      name: 'Flag',
      orderIndex: 2,
      isComplete: true,
      results: [
        result(1, 1, { points: 4 }),
        result(2, 2, { points: 3 }),
      ],
    });
    const r3 = race(3, {
      name: 'Mug',
      orderIndex: 3,
      isComplete: true,
      results: [
        result(1, 4, { points: 1 }),
        result(2, 2, { points: 3 }),
      ],
    });
    const sessions = [session(1, [heat(1, [1, 2], [r1, r2, r3])])];
    const standings = [
      { ...standing(1, 9), teamName: 'Oakham A' },
      { ...standing(2, 9), teamName: 'Belvoir A' },
    ];
    const list = buildToplist(standings, sessions, [], SECTION, null);
    expect(list.rows[0].tieBreakReason).toBe('Ahead of Belvoir A on Countback (2× 1st places vs 0× 1st places)');
    expect(toplistNote(list.rows[0])).toBe('Ahead of Belvoir A on Countback (2× 1st places vs 0× 1st places)');
  });

  it('explains last-race tie-breaks when countback is identical', () => {
    const r1 = race(1, {
      name: 'Bending',
      orderIndex: 1,
      isComplete: true,
      results: [
        result(1, 2, { points: 3 }),
        result(2, 1, { points: 4 }),
      ],
    });
    const r2 = race(2, {
      name: 'Flag',
      orderIndex: 2,
      isComplete: true,
      results: [
        result(1, 1, { points: 4 }),
        result(2, 2, { points: 3 }),
      ],
    });
    const sessions = [session(1, [heat(1, [1, 2], [r1, r2])])];
    const standings = [
      { ...standing(1, 7), teamName: 'Oakham A' },
      { ...standing(2, 7), teamName: 'Belvoir A' },
    ];
    const list = buildToplist(standings, sessions, [], SECTION, null);
    expect(list.rows[0].tieBreakReason).toBe('Ahead on Last Race (1st in Flag vs 2nd)');
  });

  it('explains A-Final placing, referee order, and open ties', () => {
    const finalSession = session(2, [
      heat(2, [1, 2], [
        race(10, {
          name: 'Final Flag',
          orderIndex: 1,
          isComplete: true,
          results: [
            result(1, 1, { points: 5 }),
            result(2, 2, { points: 4 }),
          ],
        }),
      ], { label: 'A Final', raceRoundStage: 2 }),
    ]);
    expect(
      explainTieBreak(
        { ...standing(1, 12), teamName: 'Oakham A', finalTier: 0 },
        { ...standing(2, 12), teamName: 'Belvoir A', finalTier: 0 },
        [finalSession],
        SECTION,
      ),
    ).toBe('Ahead on A-Final placing');

    expect(
      explainTieBreak(
        { ...standing(1, 12), teamName: 'Oakham A', tieBreakOrder: 1 },
        { ...standing(2, 12), teamName: 'Belvoir A', tieBreakOrder: 2 },
        [],
        SECTION,
      ),
    ).toBe('Settled by run-off / referee order');

    expect(
      explainTieBreak(
        { ...standing(1, 12), teamName: 'Oakham A' },
        { ...standing(2, 12), teamName: 'Belvoir A' },
        [],
        SECTION,
      ),
    ).toBe('Level on points and countback — run-off if on cut-off');

    expect(
      explainTieBreak(
        { ...standing(1, 12), teamName: 'Oakham A' },
        { ...standing(2, 10), teamName: 'Belvoir A' },
        [],
        SECTION,
      ),
    ).toBeNull();
  });

  it('preserves a backend-provided tieBreakReason on StandingRow', () => {
    const standings = [
      { ...standing(1, 10), tieBreakReason: 'Ahead of Belvoir A on Countback (3× 1st places vs 1× 1st place)' },
      standing(2, 10),
    ];
    const list = buildToplist(standings, [], [], SECTION, null);
    expect(list.rows[0].tieBreakReason).toBe('Ahead of Belvoir A on Countback (3× 1st places vs 1× 1st place)');
  });
});
