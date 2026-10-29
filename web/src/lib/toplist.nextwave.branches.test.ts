import { describe, expect, it } from 'vitest';
import type { Heat, Session, StandingRow } from '../types';
import { heat as baseHeat, race, result, session as baseSession, standing, team as baseTeam } from '../test/factories';
import { buildToplist, explainTieBreak, sectionScoreVersion, toplistNote, type ToplistRow } from './toplist';

const SECTION = 9;
const entries = (teamIds: number[]): Heat['entries'] => teamIds.map((teamId, lane) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: lane }));
const heat = (id: number, teamIds: number[], races: Heat['races'], extra: Partial<Heat> = {}) => baseHeat(id, { entries: entries(teamIds), races, ...extra });
const session = (id: number, heats: Heat[], extra: Partial<Session> = {}) =>
  baseSession(id, { competitionSectionId: SECTION, sectionName: 'Seniors', name: 'Seniors heats', heats, ...extra });
const team = (id: number, extra: Parameters<typeof baseTeam>[1] = {}) => baseTeam(id, { competitionSectionId: SECTION, ...extra });
type Extra = Partial<StandingRow> & { place?: number; finalPlace?: number; finalsTieOrder?: number };
const st = (id: number, points: number, extra: Extra = {}): StandingRow => ({ ...standing(id, points), ...extra } as StandingRow);
const names = (list: ReturnType<typeof buildToplist>) => list.rows.map((r) => r.teamId);
const row = (extra: Partial<ToplistRow>): ToplistRow => ({ teamId: 1, teamName: 'T', points: 0, position: 1, joint: false, runoff: false, out: false, needed: null, racesLeft: 0, withdrawn: false, bonus: 0, ...extra });

describe('sectionScoreVersion fingerprint', () => {
  it('records heats, entries and every result field, and skips sessions of other sections and breaks', () => {
    const r = race(7, { isComplete: true, results: [
      result(2, null, { points: 0, eliminated: true, status: 3 }),
      result(1, 2, { points: 3, isSitOut: true }),
    ] });
    const own = session(1, [heat(5, [2, 1], [r], { label: 'H1', raceRoundStage: 1 })]);
    const text = sectionScoreVersion([own, session(2, [], { competitionSectionId: 77 }), session(3, [], { kind: 1 })], SECTION);
    expect(text).toBe('h:5:H1:1:[2,1]|r:7:1:[1=2/3/0//1,2=/0/1/3/0]');
  });

  it('uses defaults for a heat with no label or stage and an unfinished race', () => {
    const own = session(1, [heat(5, [1], [race(7)])]);
    expect(sectionScoreVersion([own], SECTION)).toBe('h:5::0:[1]|r:7:0:[]');
  });

  it('includes a session with no section, and combined-scoring sessions from other sections', () => {
    const noSection = session(1, [heat(1, [1], [])], { competitionSectionId: null as never });
    const combinedNotes = session(2, [heat(2, [1], [])], { competitionSectionId: 77, notes: 'x [scoring:9]' });
    const combinedLabel = session(3, [heat(3, [1], [], { label: '[Scoring:9]' })], { competitionSectionId: 77 });
    const other = session(4, [heat(4, [1], [])], { competitionSectionId: 77 });
    const text = sectionScoreVersion([noSection, combinedNotes, combinedLabel, other], SECTION);
    expect(text.split('|').map((p) => p.split(':')[1])).toEqual(['1', '2', '3']);
  });

  it('prefers a sectionId property over competitionSectionId and orders by session, heat and race', () => {
    const viaProp = { ...session(1, [heat(2, [1], []), heat(1, [1], [])], { orderIndex: 2 }), sectionId: SECTION, competitionSectionId: 77 } as Session;
    const first = session(2, [heat(9, [1], [race(2, { orderIndex: 2 }), race(1, { orderIndex: 1 })])], { orderIndex: 1 });
    const parts = sectionScoreVersion([viaProp, first], SECTION).split('|').map((p) => p.split(':').slice(0, 2).join(':'));
    expect(parts).toEqual(['h:9', 'r:1', 'r:2', 'h:1', 'h:2']);
  });
});

describe('which sessions count as races', () => {
  it('reads the legacy break flag when kind is missing', () => {
    const legacyRace = session(1, [heat(1, [1, 2], [race(1)])], { kind: undefined, isBreak: false });
    const legacyBreak = session(2, [heat(2, [1, 2], [race(2)])], { kind: undefined, isBreak: true });
    expect(buildToplist([st(1, 1)], [legacyRace, legacyBreak], [], SECTION, null).sessionsTotal).toBe(1);
  });
});

describe('races left and points per session with finals alongside', () => {
  it('leaves final heats out of races left and session columns but keeps their points in the finals column', () => {
    const qualifying = heat(1, [1, 2], [race(1, { isComplete: true, results: [result(1, 1, { points: 4 }), result(2, 2, { points: 3 })] }), race(2)]);
    const final = heat(2, [1, 2], [race(3, { isComplete: true, results: [result(1, 1, { points: 6 })] })], { label: 'A Final', raceRoundStage: 2 });
    const list = buildToplist([st(1, 10), st(2, 3)], [session(1, [qualifying, final])], [], SECTION, null);
    expect(list.rows.find((r) => r.teamId === 1)?.racesLeft).toBe(1);
    expect(list.bySession.sessions.map((s) => s.label)).toEqual(['S1', 'F']);
    expect(list.bySession.cells.get(1)).toEqual([4, 6]);
    expect(list.finals).toHaveLength(1);
  });

  it('does not count a qualifier result towards session points when the team made the round final', () => {
    const qualifier = heat(1, [1, 2], [race(1, { name: 'Flags', isComplete: true, results: [result(1, 1, { points: 1 }), result(2, 2, { points: 1 })] })], { raceRoundStage: 1, raceRoundId: 5 });
    const roundFinal = heat(2, [1], [race(2, { name: 'Flags', isComplete: true, results: [result(1, 1, { points: 4 })] })], { raceRoundStage: 2, raceRoundId: 5 });
    const list = buildToplist([st(1, 4), st(2, 1)], [session(1, [qualifier, roundFinal])], [], SECTION, null);
    expect(list.bySession.cells.get(1)).toEqual([4]);
    expect(list.bySession.cells.get(2)).toEqual([1]);
    expect(list.detail.get(1)?.blocks[0].points).toBe(4);
    expect(list.detail.get(1)?.blocks[0].races).toHaveLength(2);
    expect(list.finals).toHaveLength(0);
  });

  it('keys an unnumbered round by the heat label prefix when there is no round id', () => {
    const qualifier = heat(1, [1, 2], [race(1, { name: 'Flags', isComplete: true, results: [result(1, 1, { points: 1 })] })], { raceRoundStage: 1, label: 'Flags · Qualifier' });
    const roundFinal = heat(2, [1], [race(2, { name: 'Flags', isComplete: true, results: [result(1, 1, { points: 4 })] })], { raceRoundStage: 2, label: 'Flags · Final' });
    const noLabel = heat(3, [3], [race(3, { name: 'Ring', isComplete: true, results: [result(3, 1, { points: 1 })] })], { raceRoundStage: 1 });
    const list = buildToplist([st(1, 4), st(3, 1)], [session(1, [qualifier, roundFinal, noLabel])], [], SECTION, null);
    expect(list.bySession.cells.get(1)).toEqual([4]);
    expect(list.bySession.cells.get(3)).toEqual([1]);
  });
});

describe('sorting and tie-break order between standings', () => {
  const rank = (rows: StandingRow[], sessions: Session[] = []) => names(buildToplist(rows, sessions, [], SECTION, null));

  it('orders level teams by final tie order, then tie-break order, then final place, then place', () => {
    expect(rank([st(1, 5, { finalsTieOrder: 2 }), st(2, 5, { finalsTieOrder: 1 })])).toEqual([2, 1]);
    expect(rank([st(1, 5, { tieBreakOrder: 2 }), st(2, 5, { tieBreakOrder: 1 })])).toEqual([2, 1]);
    expect(rank([st(1, 5, { finalPlace: 2 }), st(2, 5, { finalPlace: 1 })])).toEqual([2, 1]);
    expect(rank([st(1, 5, { place: 3 }), st(2, 5, { place: 1 })])).toEqual([2, 1]);
  });

  it('prefers manual orders over later keys and ignores equal ones', () => {
    expect(rank([st(1, 5, { finalsTieOrder: 1, tieBreakOrder: 2 }), st(2, 5, { finalsTieOrder: 1, tieBreakOrder: 1 })])).toEqual([2, 1]);
    expect(rank([st(1, 5, { tieBreakOrder: 1, finalPlace: 2 }), st(2, 5, { tieBreakOrder: 1, finalPlace: 1 })])).toEqual([2, 1]);
    expect(rank([st(1, 5, { finalPlace: 1, place: 2 }), st(2, 5, { finalPlace: 1, place: 1 })])).toEqual([2, 1]);
    expect(rank([st(1, 5, { finalsTieOrder: 1 }), st(2, 5)])).toEqual([1, 2]);
  });

  it('orders by wins when nothing manual is set', () => {
    expect(rank([st(1, 5, { wins: 1 }), st(2, 5, { wins: 3 })])).toEqual([2, 1]);
  });

  it('counts back on places, then on the most recent race, using the sessions', () => {
    const r1 = race(1, { orderIndex: 1, isComplete: true, results: [result(1, 1, { points: 4 }), result(2, 2, { points: 3 }), result(3, 3, { points: 2 })] });
    const r2 = race(2, { orderIndex: 2, isComplete: true, results: [result(1, 3, { points: 2 }), result(2, 2, { points: 3 }), result(3, 1, { points: 4 })] });
    const sess = [session(1, [heat(1, [1, 2, 3], [r1, r2])])];
    // 1 and 3 each have a win and a 3rd; 2 has two seconds and no win. All level on 6 points.
    // Team 3's latest race (4 points) beats team 1's (2 points), so 3 goes ahead of 1.
    const rows = [st(2, 6), st(1, 6), st(3, 6)];
    expect(rank(rows, sess)).toEqual([3, 1, 2]);
  });

  it('falls back to the most recent race when places are identical', () => {
    const r1 = race(1, { orderIndex: 1, isComplete: true, results: [result(1, 1, { points: 5 }), result(2, 1, { points: 3 })] });
    const r2 = race(2, { orderIndex: 2, isComplete: true, results: [result(1, 2, { points: 1 }), result(2, 2, { points: 3 })] });
    const sess = [session(1, [heat(1, [1, 2], [r1, r2])])];
    expect(rank([st(1, 6), st(2, 6)], sess)).toEqual([2, 1]);
  });

  it('ignores sit-outs, eliminations, unplaced and out-of-range placings when counting back', () => {
    const r1 = race(1, { orderIndex: 1, isComplete: true, results: [
      result(1, 1, { points: 0, isSitOut: true }), result(1, 11, { points: 0 }), result(1, null, { points: 0, eliminated: true }),
      result(2, 1, { points: 0, eliminated: true }), result(2, 12, { points: 0 }),
    ] });
    const sess = [session(1, [heat(1, [1, 2], [r1])])];
    expect(rank([st(1, 0), st(2, 0)], sess)).toEqual([1, 2]);
  });

  it('inside finals orders level teams by final points, then final placings, then final recent points', () => {
    const finalHeat = (results1: ReturnType<typeof result>[], results2: ReturnType<typeof result>[]) => heat(2, [1, 2], [
      race(10, { orderIndex: 1, isComplete: true, results: results1 }),
      race(11, { orderIndex: 2, isComplete: true, results: results2 }),
    ], { label: 'A Final', raceRoundStage: 2 });
    const tier = (id: number, extra: Extra = {}) => st(id, 5, { finalTier: 0, ...extra });
    // Explicit final points on the rows decide first.
    expect(rank([tier(1, { finalPoints: 3 } as Extra), tier(2, { finalPoints: 4 } as Extra)])).toEqual([2, 1]);
    // Otherwise final points are summed from the finals themselves.
    const byPoints = [session(1, [finalHeat([result(1, 2, { points: 3 }), result(2, 1, { points: 4 })], [])])];
    expect(rank([tier(1), tier(2)], byPoints)).toEqual([2, 1]);
    // Equal totals: more wins in the final decides.
    const byPlace = [session(1, [finalHeat([result(1, 1, { points: 3 }), result(2, 2, { points: 3 })], [result(1, 1, { points: 3 }), result(2, 3, { points: 3 })])])];
    expect(rank([tier(2), tier(1)], byPlace)).toEqual([1, 2]);
    // Equal places: most recent final points decide.
    const byRecent = [session(1, [finalHeat([result(1, 1, { points: 5 }), result(2, 1, { points: 1 })], [result(1, 2, { points: 1 }), result(2, 2, { points: 5 })])])];
    expect(rank([tier(1), tier(2)], byRecent)).toEqual([2, 1]);
    // Nothing to separate them keeps the input order; a team with no results is not compared by placings.
    expect(rank([tier(1), tier(2)])).toEqual([1, 2]);
  });
});

describe('tie-break reasons on the toplist', () => {
  const rs = (id: number, results: ReturnType<typeof result>[], orderIndex = id) => race(id, { orderIndex, isComplete: true, name: `G${id}`, results });

  it('says nothing for a team with no points and no results anywhere', () => {
    const list = buildToplist([st(1, 0), st(2, 0)], [], [], SECTION, null);
    expect(list.rows.map((r) => r.tieBreakReason)).toEqual([null, null]);
  });

  it('flags a dead heat as level with run-off wording on both teams when nothing separates them', () => {
    const list = buildToplist([st(1, 3), st(2, 3)], [], [], SECTION, null);
    expect(list.rows.map((r) => r.tieBreakReason)).toEqual(['Level on points and countback (run-off if on cut-off)', 'Level on points and countback (run-off if on cut-off)']);
    expect(toplistNote(list.rows[1])).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it('explains through the results when races exist, even for the same total', () => {
    const sess = [session(1, [heat(1, [1, 2], [rs(1, [result(1, 1, { points: 3 }), result(2, 1, { points: 3 })])])])];
    const list = buildToplist([st(1, 3), st(2, 3)], sess, [], SECTION, null);
    expect(list.rows[0].tieBreakReason).toBe('Level on points and countback (run-off if on cut-off)');
    expect(list.rows[1].tieBreakReason).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it('does not repeat the reason on the second of a pair when the first had a real reason', () => {
    const sess = [session(1, [heat(1, [1, 2], [rs(1, [result(1, 1, { points: 4 }), result(2, 2, { points: 3 })]), rs(2, [result(1, 3, { points: 2 }), result(2, 2, { points: 3 })])])])];
    const list = buildToplist([st(1, 6), st(2, 6)], sess, [], SECTION, null);
    expect(list.rows[0].tieBreakReason).toMatch(/^Ahead of /);
    expect(list.rows[1].tieBreakReason).toBeNull();
  });

  it('treats totals within a tenth as tied and says it was settled by order', () => {
    const list = buildToplist([st(1, 5.05, { tieBreakOrder: 1 }), st(2, 5, { tieBreakOrder: 2 })], [], [], SECTION, null);
    expect(list.rows[0].tieBreakReason).toBe('Settled by run-off / referee order');
  });

  it('gives no reason between teams in different finals tiers', () => {
    const list = buildToplist([st(1, 5, { finalTier: 0 }), st(2, 5, { finalTier: 1 })], [], [], SECTION, null);
    expect(list.rows.map((r) => r.tieBreakReason)).toEqual([null, null]);
  });

  it('keeps a backend reason on the row it belongs to without copying it to the next team', () => {
    const list = buildToplist([st(1, 5, { tieBreakReason: 'Because' }), st(2, 5)], [], [], SECTION, null);
    expect(list.rows[0].tieBreakReason).toBe('Because');
    expect(list.rows[1].tieBreakReason).toBeNull();
  });

  it('copies a backend reason of the first team only when it is the run-off wording', () => {
    const list = buildToplist([st(1, 5, { tieBreakReason: 'Level on points and countback (run-off if on cut-off)' }), st(2, 5)], [], [], SECTION, null);
    expect(list.rows[1].tieBreakReason).toBe('Level on points and countback (run-off if on cut-off)');
    const other = buildToplist([st(1, 5, { tieBreakReason: 'Ahead on something' }), st(2, 5, { tieBreakOrder: 3 })], [], [], SECTION, null);
    expect(other.rows[1].tieBreakReason).toBeNull();
  });

  it('explains from wins when the second team differs only by wins', () => {
    const list = buildToplist([st(1, 5, { wins: 2 }), st(2, 5, { wins: 1 })], [], [], SECTION, null);
    expect(list.rows[0].tieBreakReason).toBe('Ahead of Team 2 on Countback (2× 1st places vs 1× 1st place)');
  });

  it('treats a manual order on only one of two level teams as unresolved', () => {
    const list = buildToplist([st(1, 5, { tieBreakOrder: 1 }), st(2, 5)], [], [], SECTION, null);
    expect(list.rows.map((r) => r.tieBreakReason)).toEqual(['Level on points and countback (run-off if on cut-off)', 'Level on points and countback (run-off if on cut-off)']);
  });
});

describe('explainTieBreak direct cases', () => {
  const sessionWith = (results: Record<number, ReturnType<typeof result>[]>, heatExtra: Partial<Heat> = {}, sessionExtra: Partial<Session> = {}) =>
    session(1, [heat(1, [1, 2], Object.entries(results).map(([id, rs]) => race(Number(id), { orderIndex: Number(id), isComplete: true, name: `G${id}`, results: rs })), heatExtra)], sessionExtra);

  it('returns a stored reason straight away and nothing for clearly different totals', () => {
    expect(explainTieBreak(st(1, 5, { tieBreakReason: 'Stored' }), st(2, 1), [], SECTION)).toBe('Stored');
    expect(explainTieBreak(st(1, 5), st(2, 4.8), [], SECTION)).toBeNull();
  });

  it('settles totals that differ by a hair as referee order', () => {
    expect(explainTieBreak(st(1, 5.05), st(2, 5), [], SECTION)).toBe('Settled by run-off / referee order');
  });

  it('only calls it referee order when the manual orders differ', () => {
    expect(explainTieBreak(st(1, 5, { tieBreakOrder: 2 }), st(2, 5, { tieBreakOrder: 2 }), [], SECTION)).toBe('Level on points and countback (run-off if on cut-off)');
    expect(explainTieBreak(st(1, 5, { tieBreakOrder: 1 }), st(2, 5), [], SECTION)).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it('says nothing for zero-point teams that have not raced while nothing is scored', () => {
    expect(explainTieBreak(st(1, 0), st(2, 0), [], SECTION)).toBeNull();
    const unscored = session(1, [heat(1, [1, 2], [race(1)])]);
    expect(explainTieBreak(st(1, 0), st(2, 0), [unscored], SECTION)).toBeNull();
    const otherSection = { ...sessionWith({ 1: [result(1, 1, { points: 3 })] }), competitionSectionId: 77 };
    expect(explainTieBreak(st(1, 0), st(2, 0), [otherSection as Session], SECTION)).toBeNull();
    const scored = sessionWith({ 1: [result(1, 1, { points: 0 }), result(2, 2, { points: 0 })] });
    expect(explainTieBreak(st(1, 0), st(2, 0), [scored], SECTION)).toBe('Ahead of Team 2 on Countback (1× 1st place vs 0× 1st places)');
  });

  it('compares counts at each place and favours the one with more', () => {
    const sess = sessionWith({ 1: [result(1, 1, { points: 4 }), result(2, 2, { points: 3 })], 2: [result(1, 2, { points: 3 }), result(2, 1, { points: 4 })], 3: [result(1, 2, { points: 3 }), result(2, 3, { points: 2 })] });
    expect(explainTieBreak(st(1, 10), st(2, 9.95 + 0.05), [sess], SECTION)).toBe('Ahead of Team 2 on Countback (2× 2nd places vs 1× 2nd place)');
  });

  it('falls back to referee order when the lower team wins the countback', () => {
    const sess = sessionWith({ 1: [result(1, 2, { points: 3 }), result(2, 1, { points: 4 })] });
    expect(explainTieBreak(st(1, 7), st(2, 7), [sess], SECTION)).toBe('Settled by run-off / referee order');
  });

  it('falls back to the standing wins when there are no placed results', () => {
    expect(explainTieBreak(st(1, 3, { wins: 2 }), st(2, 3, { wins: 0 }), [], SECTION)).toBe('Ahead of Team 2 on Countback (2× 1st places vs 0× 1st places)');
    expect(explainTieBreak(st(1, 3, { wins: 1 }), st(2, 3, { wins: 0 }), [], SECTION)).toBe('Ahead of Team 2 on Countback (1× 1st place vs 0× 1st places)');
    expect(explainTieBreak(st(1, 3, { wins: 0 }), st(2, 3, { wins: 2 }), [], SECTION)).toBe('Settled by run-off / referee order');
    const noWins = { ...st(1, 3), wins: undefined } as unknown as StandingRow;
    expect(explainTieBreak(noWins, { ...noWins, teamId: 2 }, [], SECTION)).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it('uses the last shared race when countback is level', () => {
    const sess = sessionWith({
      1: [result(1, 2, { points: 3 }), result(2, 1, { points: 4 })],
      2: [result(1, 1, { points: 4 }), result(2, 2, { points: 3 })],
    });
    expect(explainTieBreak(st(1, 7), st(2, 7), [sess], SECTION)).toBe('Ahead on Last Race (1st in G2 vs 2nd)');
  });

  it('describes last race with points or elimination when there is no placing', () => {
    const elim = sessionWith({ 1: [result(1, 1, { points: 4 }), result(2, null, { points: 0, eliminated: true })] });
    // Team 2 has no wins, so countback already decides this; use equal places via no placings at all.
    const noPlaces = sessionWith({ 1: [result(1, null, { points: 3 }), result(2, null, { points: 0, eliminated: true })] });
    expect(explainTieBreak(st(1, 3), st(2, 3), [noPlaces], SECTION)).toBe('Ahead on Last Race (3 pts in G1 vs elim.)');
    const pointsOnly = sessionWith({ 1: [result(1, null, { points: 3 }), result(2, null, { points: 1 })] });
    expect(explainTieBreak(st(1, 3), st(2, 3), [pointsOnly], SECTION)).toBe('Ahead on Last Race (3 pts in G1 vs 1 pts)');
    const placedVsNot = sessionWith({ 1: [result(1, 4, { points: 1 }), result(2, null, { points: 1 })] });
    expect(explainTieBreak(st(1, 1), st(2, 1), [placedVsNot], SECTION)).toBe('Ahead of Team 2 on Countback (1× 4th place vs 0× 4th places)');
    expect(explainTieBreak(st(1, 4), st(2, 0 + 4), [elim], SECTION)).toMatch(/^Ahead of Team 2 on Countback/);
  });

  it('skips races only one of the teams rode and does not credit the lower team', () => {
    const sess = sessionWith({ 1: [result(1, null, { points: 3 })], 2: [result(1, null, { points: 1 }), result(2, null, { points: 2 })] });
    expect(explainTieBreak(st(1, 4), st(2, 4), [sess], SECTION)).toBe('Settled by run-off / referee order'.replace('Settled by run-off / referee order', 'Level on points and countback (run-off if on cut-off)'));
  });

  it('treats equal placing and points in the last race as no difference', () => {
    const sess = sessionWith({ 1: [result(1, 1, { points: 4 }), result(2, 1, { points: 4 })] });
    expect(explainTieBreak(st(1, 4), st(2, 4), [sess], SECTION)).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it('prefers the A-Final comparison: points, then placings, and ignores finals only one team rode', () => {
    const finalOnly = (r1: ReturnType<typeof result>[], r2: ReturnType<typeof result>[] = []) => sessionWith(
      r2.length ? { 1: r1, 2: r2 } : { 1: r1 }, { label: 'A Final', raceRoundStage: 2 });
    expect(explainTieBreak(st(1, 9), st(2, 9), [finalOnly([result(1, 1, { points: 5 }), result(2, 2, { points: 4 })])], SECTION)).toBe('Ahead on A-Final placing');
    // Equal final points but a different spread of places.
    const spread = finalOnly([result(1, 1, { points: 3 }), result(2, 2, { points: 3 })], [result(1, 3, { points: 3 }), result(2, 2, { points: 3 })]);
    expect(explainTieBreak(st(1, 9), st(2, 9), [spread], SECTION)).toBe('Ahead on A-Final placing');
    // Equal everything in the final falls through to the other checks.
    const same = finalOnly([result(1, 1, { points: 3 }), result(2, 1, { points: 3 })]);
    expect(explainTieBreak(st(1, 3), st(2, 3), [same], SECTION)).toBe('Level on points and countback (run-off if on cut-off)');
    // Only one team rode the final.
    const oneSided = finalOnly([result(1, 1, { points: 3 })]);
    expect(explainTieBreak(st(1, 3), st(2, 3), [oneSided], SECTION)).toMatch(/^Ahead of Team 2 on Countback/);
    // Eliminated or unplaced results are not counted as places.
    const elim = finalOnly([result(1, null, { points: 3, eliminated: true }), result(2, 2, { points: 3, eliminated: true })], [result(1, 1, { points: 3, eliminated: true }), result(2, null, { points: 3 })]);
    expect(explainTieBreak(st(1, 6), st(2, 6), [elim], SECTION)).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it('ignores races with no results and races neither team rode', () => {
    const sess = session(1, [heat(1, [1, 2], [race(1), race(2, { isComplete: true, results: [result(5, 1, { points: 3 })] })])]);
    expect(explainTieBreak(st(1, 3), st(2, 3), [sess], SECTION)).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it('only looks at race sessions in this section, in running order', () => {
    const later = session(2, [heat(2, [1, 2], [race(2, { isComplete: true, name: 'Late', results: [result(1, 1, { points: 4 }), result(2, 2, { points: 3 })] })])], { orderIndex: 2 });
    const earlier = session(1, [heat(1, [1, 2], [race(1, { isComplete: true, name: 'Early', results: [result(1, 2, { points: 3 }), result(2, 1, { points: 4 })] })])], { orderIndex: 1 });
    const brk = session(3, [heat(3, [1, 2], [race(3, { isComplete: true, results: [result(1, 1, { points: 9 })] })])], { kind: 1 });
    expect(explainTieBreak(st(1, 7), st(2, 7), [later, brk, earlier], SECTION)).toBe('Ahead on Last Race (1st in Late vs 2nd)');
  });
});

describe('final groups and team detail ordering', () => {
  const finalOf = (id: number, results: ReturnType<typeof result>[], extra: Partial<Heat> = {}) =>
    heat(id, [1, 2, 3], [race(id * 10, { isComplete: true, results })], { label: 'A Final', raceRoundStage: 2, ...extra });

  it('breaks equal final points by overall standing, then by name, and leaves unscored entrants last', () => {
    const f = finalOf(1, [result(1, 1, { points: 3 }), result(2, 2, { points: 3 }), result(4, 3, { points: 3 })]);
    f.races[0].results[0].teamName = 'Zed';
    f.races[0].results[1].teamName = 'Amy';
    f.races[0].results[2].teamName = 'Bea';
    const list = buildToplist([st(2, 9), st(1, 5)], [session(1, [f])], [], SECTION, null);
    expect(list.finals[0].rows.map((r) => [r.teamId, r.place])).toEqual([[2, 1], [1, 1], [4, 1], [3, null]]);
  });

  it('breaks an unranked tie by name and sorts several finals by session and heat order', () => {
    const f1 = finalOf(1, [result(7, 1, { points: 2 }), result(8, 1, { points: 2 })], { orderIndex: 2 });
    f1.races[0].results[0].teamName = 'Zed';
    f1.races[0].results[1].teamName = 'Amy';
    const f2 = finalOf(2, [result(9, 1, { points: 2 })], { orderIndex: 1, label: 'B Final' });
    const later = session(2, [heat(3, [1], [race(30, { isComplete: true, results: [result(1, 1, { points: 1 })] })], { label: 'C Final', raceRoundStage: 2 })], { orderIndex: 5 });
    const list = buildToplist([], [session(1, [f1, f2], { orderIndex: 1 }), later], [], SECTION, null);
    expect(list.finals.map((g) => g.label)).toEqual(['B Final', 'A Final', 'C Final']);
    expect(list.finals[1].rows.slice(0, 2).map((r) => r.teamName)).toEqual(['Amy', 'Zed']);
  });

  it('labels a final with the session name when the heat label lacks the word, and handles no label', () => {
    const f = finalOf(1, [result(1, 1, { points: 1 })], { label: null, raceRoundStage: 2 });
    const named = session(1, [f], { name: 'Seniors' });
    expect(buildToplist([st(1, 1)], [named], [], SECTION, null).finals[0].label).toBe('Seniors');
    const bare = heat(2, [1], [race(2, { isComplete: true, results: [result(1, 1, { points: 1 })] })], { label: 'Decider', raceRoundStage: 2 });
    expect(buildToplist([st(1, 1)], [session(1, [bare], { name: '' })], [], SECTION, null).finals[0].label).toBe('Decider');
  });

  it('skips final heats with no results', () => {
    const empty = finalOf(1, []);
    empty.races = [race(1)];
    expect(buildToplist([st(1, 1)], [session(1, [empty])], [], SECTION, null).finals).toEqual([]);
  });

  it('detail: names come from standings first, a team in two finals keeps its first final, and a team with no part has null points', () => {
    const f1 = finalOf(1, [result(1, 1, { points: 4 })], { label: 'A Final' });
    const f2 = finalOf(2, [result(1, 2, { points: 2 })], { label: 'B Final' });
    const q = heat(3, [1, 2], [race(3, { isComplete: true, results: [result(1, 1, { points: 4 })] })], { label: 'H1' });
    const other = heat(4, [3], [race(4)], { label: 'H2' });
    const list = buildToplist([st(1, 6), st(2, 0)], [session(1, [q, other, f1, f2])], [], SECTION, null);
    const one = list.detail.get(1)!;
    expect(one.final).toEqual({ label: 'A Final', place: 1, points: 4 });
    expect(one.blocks.map((b) => b.key)).toEqual(['final-1', 'final-2', 'session-1']);
    expect(one.blocks[2].label).toBe('Session 1 · H1');
    const two = list.detail.get(2)!;
    // Team 2 was drawn into the final but has no result there yet, so it has a final with no place.
    expect(two.final).toEqual({ label: 'A Final', place: null, points: null });
    expect(two.blocks.find((b) => b.kind === 'session')?.points).toBe(0);
    expect(two.qualifyingPosition).toBe(2);
    // Team 3 is not in the standings but was drawn into the finals, so it still gets a sheet.
    expect(list.detail.get(3)).toMatchObject({ teamName: 'Team 3', qualifyingPosition: null, qualifyingPoints: 0 });
  });

  it('detail: a team in no heat of a session has null points and a plain label', () => {
    const a = session(1, [heat(1, [1], [race(1, { isComplete: true, results: [result(1, 1, { points: 2 })] })])], { orderIndex: 1 });
    const b = session(2, [heat(2, [2], [race(2)])], { orderIndex: 2 });
    const list = buildToplist([st(1, 2), st(2, 0)], [a, b], [], SECTION, null);
    const blocks = list.detail.get(1)!.blocks;
    expect(blocks.map((x) => [x.label, x.points])).toEqual([['Session 1', 2], ['Session 2', null]]);
  });
});

describe('by game odds and ends', () => {
  it('keeps one group per game name ignoring case, skips unnamed or empty races, and labels heats by session when there are several', () => {
    const s1 = session(1, [
      heat(2, [1, 2], [race(2, { name: ' Flags ', orderIndex: 2, results: [result(1, 1, { points: 4 }), result(2, 2, { points: 3 })] })], { orderIndex: 2, label: ' ' }),
      heat(1, [1, 2], [race(1, { name: '', results: [result(1, 1, { points: 9 })] }), race(3, { name: 'Ring' })], { orderIndex: 1, label: 'Red' }),
    ], { orderIndex: 1 });
    const s2 = session(2, [heat(3, [1, 2], [race(4, { name: 'flags', results: [result(2, 1, { points: 4 }), result(1, null, { points: 3 })] })], { label: 'Blue' })], { orderIndex: 2 });
    const list = buildToplist([st(1, 7), st(2, 7)], [s1, s2], [], SECTION, null);
    expect(list.byGame).toHaveLength(1);
    expect(list.byGame[0].name).toBe('Flags');
    expect(list.byGame[0].rows.map((r) => [r.heatLabel, r.teamId, r.position, r.joint])).toEqual([
      ['S1 · Heat 2', 1, 1, true], ['S2 · Blue', 2, 1, true], ['S1 · Heat 2', 2, 3, true], ['S2 · Blue', 1, 3, true],
    ]);
  });

  it('leaves out a game whose only results are from hors concours teams', () => {
    const s = session(1, [heat(1, [1], [race(1, { name: 'Flags', results: [result(1, 1, { points: 4 })] })])]);
    expect(buildToplist([st(1, 4)], [s], [team(1, { isHorsConcours: true })], SECTION, null).byGame).toEqual([]);
  });

  it('sorts by points, then placing (unplaced last), then name', () => {
    const rs = [result(1, null, { points: 2 }), result(2, 2, { points: 2 }), result(3, 1, { points: 2 })];
    rs[0].teamName = 'Zed'; rs[1].teamName = 'Amy'; rs[2].teamName = 'Bea';
    const s = session(1, [heat(1, [1, 2, 3], [race(1, { name: 'Flags', results: rs })])]);
    expect(buildToplist([st(1, 2)], [s], [], SECTION, null).byGame[0].rows.map((r) => r.teamName)).toEqual(['Bea', 'Amy', 'Zed']);
  });
});

describe('toplistNote variants', () => {
  it('describes withdrawn, run-off, unavailable and plural races left, joining parts', () => {
    expect(toplistNote(row({ withdrawn: true, bonus: 1, tieBreakReason: 'x' }))).toBe('Withdrawn · 1 tack bonus point');
    expect(toplistNote(row({ runoff: true, position: 3, tieBreakReason: 'x', bonus: 2 }))).toBe('Joint 3rd · run-off · 2 tack bonus points');
    expect(toplistNote(row({ neededUnavailable: true }))).toBe('Qualification calculation unavailable');
    expect(toplistNote(row({ racesLeft: 1 }))).toBe('1 race left');
    expect(toplistNote(row({ racesLeft: 3, tieBreakReason: 'Ahead' }))).toBe('3 races left · Ahead');
    expect(toplistNote(row({ needed: 2 }))).toBe('2 pts needed for the A Final (normal finishes)');
  });
});

describe('tie-break facts ordering and odd results', () => {
  const rank = (rows: StandingRow[], sessions: Session[]) => names(buildToplist(rows, sessions, [], SECTION, null));
  const raceOf = (id: number, results: ReturnType<typeof result>[], extra: Partial<ReturnType<typeof race>> = {}) =>
    race(id, { isComplete: true, results, ...extra });

  it('orders sessions, heats and races that share an order index by id when counting recent points back', () => {
    const early = session(1, [heat(1, [1, 2], [raceOf(1, [result(1, null, { points: 1 }), result(2, null, { points: 4 })])])], { orderIndex: 1 });
    const late = session(2, [heat(2, [1, 2], [raceOf(2, [result(1, null, { points: 4 }), result(2, null, { points: 1 })])])], { orderIndex: 1 });
    expect(rank([st(2, 5), st(1, 5)], [late, early])).toEqual([1, 2]);

    const sameHeatOrder = session(3, [
      heat(4, [1, 2], [raceOf(4, [result(1, null, { points: 4 }), result(2, null, { points: 1 })])], { orderIndex: 1 }),
      heat(3, [1, 2], [raceOf(3, [result(1, null, { points: 1 }), result(2, null, { points: 4 })])], { orderIndex: 1 }),
    ]);
    expect(rank([st(2, 5), st(1, 5)], [sameHeatOrder])).toEqual([1, 2]);

    const sameRaceOrder = session(5, [heat(5, [1, 2], [
      raceOf(7, [result(1, null, { points: 4 }), result(2, null, { points: 1 })], { orderIndex: 1 }),
      raceOf(6, [result(1, null, { points: 1 }), result(2, null, { points: 4 })], { orderIndex: 1 }),
    ])]);
    expect(rank([st(2, 5), st(1, 5)], [sameRaceOrder])).toEqual([1, 2]);
  });

  it('counts final placings only for finishers placed 1 to 10', () => {
    const finalHeat = heat(2, [1, 2], [
      raceOf(1, [result(1, 11, { points: 2 }), result(2, 1, { points: 2, eliminated: true })], { orderIndex: 1 }),
      raceOf(2, [result(1, null, { points: 2 }), result(2, 10, { points: 2 })], { orderIndex: 2 }),
    ], { label: 'A Final', raceRoundStage: 2 });
    const rows = [st(1, 4, { finalTier: 0 }), st(2, 4, { finalTier: 0 })];
    // Team 2 has a 10th place that counts; team 1's 11th and null placings and team 2's eliminated 1st do not.
    expect(rank(rows, [session(1, [finalHeat])])).toEqual([2, 1]);
  });

  it('treats a missing wins figure on a standing as zero when explaining a tie', () => {
    const noWins = (id: number) => ({ ...st(id, 5), wins: undefined } as unknown as StandingRow);
    const list = buildToplist([noWins(1), noWins(2)], [], [], SECTION, null);
    expect(list.rows.map((r) => r.tieBreakReason)).toEqual(['Level on points and countback (run-off if on cut-off)', 'Level on points and countback (run-off if on cut-off)']);
  });

  it('treats a missing races-run figure as zero before anything is scored', () => {
    const noRuns = (id: number) => ({ ...st(id, 0), racesRun: undefined } as unknown as StandingRow);
    expect(explainTieBreak(noRuns(1), noRuns(2), [], SECTION)).toBeNull();
  });

  it('counts finals points by team even when only one side of the pair has results', () => {
    const finalHeat = heat(2, [1, 2], [raceOf(1, [result(2, 1, { points: 3 })])], { label: 'A Final', raceRoundStage: 2 });
    const both = heat(3, [1, 2], [raceOf(2, [result(1, 1, { points: 3 }), result(2, 2, { points: 1 })])], { label: 'B Final', raceRoundStage: 2 });
    expect(explainTieBreak(st(1, 4), st(2, 4), [session(1, [finalHeat, both])], SECTION)).toBe('Ahead on A-Final placing');
  });
});

describe('points-needed search edge cases', () => {
  const rowsFor = (points: number[]) => points.map((p, i) => standing(i + 1, p));

  it('breaks entry and race ordering ties by id and ignores entrants missing from the standings', () => {
    const h = baseHeat(1, {
      entries: [
        { id: 3, teamId: 3, teamName: 'C', laneIndex: 0 },
        { id: 2, teamId: 2, teamName: 'B', laneIndex: 0 },
        { id: 9, teamId: 9, teamName: 'Z', laneIndex: 1 },
        { id: 1, teamId: 1, teamName: 'A', laneIndex: 2 },
      ],
      races: [race(8, { orderIndex: 1 }), race(7, { orderIndex: 1 })],
    });
    const list = buildToplist(rowsFor([10, 8, 5]), [session(1, [h], { lanesPerHeat: 4 })], [], SECTION, 2);
    const third = list.rows.find((r) => r.teamId === 3)!;
    expect(third.out).toBe(true);
    expect(third.racesLeft).toBe(2);
    expect(third.neededUnavailable).toBeUndefined();
  });

  it('shares the same one-point slots in qualifier races when searching several rivals', () => {
    const h = heat(1, [1, 2, 3, 4, 5, 6], [race(1), race(2), race(3)], { raceRoundStage: 1 });
    const list = buildToplist(rowsFor([9, 8, 7, 6, 5, 4]), [session(1, [h])], [], SECTION, 3);
    const out = list.rows.filter((r) => r.out);
    expect(out.length).toBe(3);
    for (const r of out) expect(r.neededUnavailable).toBeUndefined();
  });
});
