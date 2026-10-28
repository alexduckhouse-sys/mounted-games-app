import { describe, expect, it } from 'vitest';
import type { Heat, Session, StandingRow } from '../types';
import { heat, race, result, session, standing } from '../test/factories';
import { buildToplist, explainTieBreak, sectionScoreVersion } from './toplist';

const SECTION = 5;
const field = (id: number, ids: number[], races: Heat['races'], extra: Partial<Heat> = {}) => heat(id, {
  entries: ids.map((teamId) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: teamId })),
  races, ...extra,
});
const programme = (heats: Heat[], extra: Partial<Session> = {}) => session(1, { heats, ...extra });
const ranked = (rows: StandingRow[], sessions: Session[] = []) => buildToplist(rows, sessions, [], SECTION, 0);
const explanation = (sessions: Session[], above: Partial<StandingRow> = {}, below: Partial<StandingRow> = {}) =>
  explainTieBreak(standing(1, 8, above), standing(2, 8, below), sessions, SECTION);

describe('toplist server tie decisions', () => {
  it.each(['finalsTieOrder', 'tieBreakOrder', 'finalPlace', 'place'] as const)(
    'uses distinct %s values before countback and leaves equal decisions tied', (key) => {
      const first = { ...standing(1, 8), [key]: 2 };
      const second = { ...standing(2, 8), [key]: 1 };
      expect(ranked([first, second]).rows.map(({ teamId, position, joint }) => [teamId, position, joint]))
        .toEqual([[2, 1, false], [1, 2, false]]);
      expect(ranked([first, { ...second, [key]: 2 }]).rows.map(({ joint }) => joint)).toEqual([true, true]);
      expect(ranked([first, standing(2, 8)]).rows.map(({ joint }) => joint)).toEqual([true, true]);
    },
  );

  it('uses supplied final points for teams with equal totals in the same final', () => {
    expect(ranked([standing(1, 8, { finalTier: 0, finalPoints: 3 }), standing(2, 8, { finalTier: 0, finalPoints: 5 })]).rows.map(({ teamId, position }) => [teamId, position])).toEqual([[2, 1], [1, 2]]);
  });

  it('uses recorded final points when standings do not supply them', () => {
    const finals = programme([field(1, [1, 2], [race(1, { results: [result(1, 2, { points: 3 }), result(2, 1, { points: 5 })] })], { label: 'A Final' })]);
    expect(ranked([standing(1, 8, { finalTier: 0 }), standing(2, 8, { finalTier: 0 })], [finals]).rows.map(({ teamId }) => teamId)).toEqual([2, 1]);
  });

  it('breaks a final points tie by final countback even when qualifying favours the other team', () => {
    const qualifying = programme([field(1, [1, 2], [race(1, { results: [result(1, 1, { points: 4 }), result(2, 2, { points: 3 })] })])]);
    const finals = session(2, { heats: [field(2, [1, 2], [race(2, { results: [result(1, 2, { points: 4 }), result(2, 1, { points: 4 })] })], { label: 'A Final' })] });
    expect(ranked([standing(1, 8, { finalTier: 0 }), standing(2, 8, { finalTier: 0 })], [qualifying, finals]).rows.map(({ teamId }) => teamId)).toEqual([2, 1]);
  });

  it('uses the most recent final result after equal final points and countback', () => {
    const finals = programme([field(1, [1, 2], [
      race(1, { results: [result(1, 1, { points: 5 }), result(2, 2, { points: 3 })] }),
      race(2, { results: [result(1, 2, { points: 3 }), result(2, 1, { points: 5 })] }),
    ], { label: 'A Final' })]);
    expect(ranked([standing(1, 8, { finalTier: 0 }), standing(2, 8, { finalTier: 0 })], [finals]).rows.map(({ teamId, joint }) => [teamId, joint])).toEqual([[2, false], [1, false]]);
  });

  it('keeps final teams tied when every final result is identical', () => {
    const finals = programme([field(1, [1, 2], [race(1, { results: [result(1, 1, { points: 4 }), result(2, 1, { points: 4 })] })], { label: 'A Final' })]);
    expect(ranked([standing(1, 8, { finalTier: 0 }), standing(2, 8, { finalTier: 0 })], [finals]).rows.map(({ joint }) => joint)).toEqual([true, true]);
  });
});

describe('toplist legacy and partial score data', () => {
  it('treats a legacy non-break session as racing and ignores legacy breaks', () => {
    const qualifying = programme([field(1, [1], [race(1, { results: [result(1, 1, { points: 2 })] })])], { kind: undefined });
    const interval = session(2, { ...qualifying, id: 2, kind: undefined, isBreak: true });
    const list = ranked([standing(1, 2)], [qualifying, interval]);
    expect(list.sessionsTotal).toBe(1);
    expect(list.bySession.cells.get(1)).toEqual([2]);
    expect(sectionScoreVersion([qualifying, interval], SECTION)).toBe(sectionScoreVersion([qualifying], SECTION));
  });

  it('fingerprints null placings, elimination, sit-outs and status for score refreshes', () => {
    const scores = programme([field(1, [2, 1], [race(1, { results: [
      result(2, null, { eliminated: true, status: 2 }), result(1, null, { isSitOut: true }),
    ] })])]);
    expect(sectionScoreVersion([scores], SECTION)).toBe('h:1::0:[1,2]|r:1:0:[1=/0/0//1,2=/0/1/2/0]');
  });

  it('keeps competition finals separate when qualifying and finals share one session', () => {
    const mixed = programme([
      field(1, [1, 2], [race(1, { results: [result(1, 1, { points: 2 })] })]),
      field(2, [1, 2], [race(2, { results: [result(2, 1, { points: 4 })] })], { label: 'A Final' }),
    ]);
    const list = ranked([standing(1, 2), standing(2, 4)], [mixed]);
    expect(list.bySession.cells.get(1)).toEqual([2, 0]);
    expect(list.bySession.cells.get(2)).toEqual([0, 4]);
    expect(list.detail.get(2)?.blocks.find(({ kind }) => kind === 'session')?.points).toBe(0);
    expect(list.byGame.map(({ name }) => name)).toEqual(['Race 1']);
  });

  it('ignores null, eliminated and out-of-range placings in countback while retaining their points', () => {
    const final = programme([field(1, [1, 2], [
      race(1, { results: [result(1, null, { points: 2 }), result(2, 11, { points: 2 })] }),
      race(2, { results: [result(1, 1, { eliminated: true })] }),
    ], { label: 'A Final' })]);
    const list = ranked([standing(1, 2, { finalTier: 0 }), standing(2, 2, { finalTier: 0 })], [final]);
    expect(list.finals[0].rows.map(({ points }) => points)).toEqual([2, 2]);
    expect(list.rows[0].teamId).toBe(2);
  });

  it('orders equal-index sessions, heats and races by stable IDs for last-race countback', () => {
    const sessions = [2, 1].map((sessionId) => session(sessionId, { orderIndex: 0, heats: [2, 1].map((heatId) =>
      field(heatId, [1, 2], [2, 1].map((raceId) => race(raceId, { orderIndex: 0, results: [
        result(1, null, { points: raceId === 2 ? 1 : 3 }), result(2, null, { points: raceId === 2 ? 3 : 1 }),
      ] })), { orderIndex: 0 })) }));
    expect(ranked([standing(1, 8), standing(2, 8)], sessions).rows.map(({ teamId }) => teamId)).toEqual([2, 1]);
  });

  it('leaves a withdrawn team outside the final with no projected gain', () => {
    const list = buildToplist([standing(1, 8), standing(2, 4, { withdrawn: true })],
      [programme([field(1, [2], [race(1)])])], [], SECTION, 1);
    expect(list.rows[1]).toMatchObject({ out: true, needed: null, withdrawn: true });
  });

  it('allows unranked entrants to consume finishing slots in the qualification calculation', () => {
    const list = buildToplist([standing(1, 8), standing(2, 7), standing(3, 5)],
      [programme([field(1, [4, 3, 5, 6], [race(2, { orderIndex: 0 }), race(1, { orderIndex: 0 })], {
        entries: [4, 3, 5, 6].map((teamId) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: 0 })),
      })])], [], SECTION, 2);
    expect(list.rows[2]).toMatchObject({ out: true, needed: 3 });
  });
});

describe('toplist tie explanation boundaries', () => {
  it('preserves the backend explanation even when totals differ', () => {
    expect(explanation([], { tieBreakReason: 'Settled by the referee' }, { totalPoints: 3 })).toBe('Settled by the referee');
  });

  it('explains a fractional run-off adjustment', () => {
    expect(explanation([], { totalPoints: 8.01 })).toBe('Settled by run-off / referee order');
  });

  it('does not invent a tie explanation before anybody has ridden', () => {
    expect(explanation([], { totalPoints: 0, racesRun: undefined }, { totalPoints: 0, racesRun: undefined })).toBeNull();
  });

  it('explains a zero-point tie when results show both teams rode', () => {
    const played = programme([field(1, [1, 2], [race(1, { results: [result(1, null, { eliminated: true }), result(2, null, { eliminated: true })] })])]);
    expect(explanation([played], { totalPoints: 0 }, { totalPoints: 0 })).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it.each([
    [1, undefined, 'Ahead of Team 2 on Countback (1× 1st place vs 0× 1st places)'],
    [3, 1, 'Ahead of Team 2 on Countback (3× 1st places vs 1× 1st place)'],
    [undefined, 1, 'Settled by run-off / referee order'],
  ])('explains summary-only wins %s against %s', (wins, otherWins, expected) => {
    expect(explanation([], { wins: wins as number | undefined }, { wins: otherWins as number | undefined })).toBe(expected);
  });

  it('falls back to the referee decision when detailed countback favours the lower row', () => {
    const played = programme([field(1, [1, 2], [race(1, { results: [result(1, 2, { points: 3 }), result(2, 1, { points: 4 })] })])]);
    expect(explanation([played])).toBe('Settled by run-off / referee order');
  });

  it('uses singular and plural countback wording accurately', () => {
    const played = programme([field(1, [1, 2], [1, 2].map((id) => race(id, { results: [
      result(1, 1, { points: 4 }), result(2, id === 1 ? 1 : 2, { points: 4 }),
    ] }))) ]);
    expect(explanation([played])).toBe('Ahead of Team 2 on Countback (2× 1st places vs 1× 1st place)');
  });

  it.each([
    [true, 'Ahead on Last Race (2 pts in Race 1 vs elim.)'],
    [false, 'Ahead on Last Race (2 pts in Race 1 vs 0 pts)'],
  ])('describes an unplaced last-race award against an eliminated=%s opponent', (eliminated, expected) => {
    const played = programme([field(1, [1, 2], [race(1, { results: [result(1, null, { points: 2 }), result(2, null, { eliminated })] })])]);
    expect(explanation([played])).toBe(expected);
  });

  it('uses a last-race placing when the opponent has none and total countback is equal', () => {
    const played = programme([field(1, [1, 2], [
      race(1, { results: [result(1, null), result(2, 1, { points: 4 })] }),
      race(2, { results: [result(1, 1, { points: 4 }), result(2, null)] }),
    ])]);
    expect(explanation([played])).toBe('Ahead on Last Race (1st in Race 2 vs 0 pts)');
  });

  it('adds finals in different heats without treating missing results as placings', () => {
    const finals = programme([
      field(1, [1], [race(1, { results: [result(1, null, { points: 4 })] })], { label: 'A Final' }),
      field(2, [2], [race(2, { results: [result(2, null, { points: 4 })] })], { label: 'A Final' }),
      field(3, [3], [race(3, { results: [result(3, 1, { points: 4 })] })], { label: 'B Final' }),
    ]);
    expect(explanation([finals])).toBe('Level on points and countback (run-off if on cut-off)');
  });

  it('explains final countback when final totals are level', () => {
    const finals = programme([field(1, [1, 2], [race(1, { results: [result(1, 1, { points: 4 }), result(2, 2, { points: 4 })] })], { label: 'A Final' })]);
    expect(explanation([finals])).toBe('Ahead on A-Final placing');
  });
});
