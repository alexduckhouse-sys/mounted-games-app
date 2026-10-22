import { describe, expect, it } from 'vitest';
import type { Heat, Session } from '../types';
import { heat as baseHeat, race, result, session as baseSession, standing, team as baseTeam } from '../test/factories';
import { buildToplist, ordinal, toplistNote, type ToplistRow } from './toplist';

const SECTION = 9;
const entries = (teamIds: number[]): Heat['entries'] => teamIds.map((teamId, lane) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: lane }));
const heat = (id: number, teamIds: number[], races: Heat['races'], extra: Partial<Heat> = {}) => baseHeat(id, { entries: entries(teamIds), races, ...extra });
const session = (id: number, heats: Heat[], extra: Partial<Session> = {}) => baseSession(id, { competitionSectionId: SECTION, sectionName: 'Seniors', name: 'Seniors heats', heats, ...extra });
const scored = (id: number, ...pairs: [teamId: number, points: number][]) => race(id, { isComplete: true, results: pairs.map(([teamId, points]) => result(teamId, 1, { points })) });
const team = (id: number, extra: Parameters<typeof baseTeam>[1] = {}) => baseTeam(id, { competitionSectionId: SECTION, ...extra });
const row = (extra: Partial<ToplistRow>): ToplistRow => ({ teamId: 1, teamName: 'T', points: 0, position: 1, joint: false, runoff: false, out: false, needed: null, racesLeft: 0, withdrawn: false, ...extra });

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
    const sessions = [session(1, [heat(1, [3], [race(1), race(2)])])];
    const list = buildToplist([standing(1, 10), standing(2, 8), standing(3, 5)], sessions, [], SECTION, 2);
    expect(list.cutAfter).toBe(1);
    expect(list.runoff).toBeNull();
    expect(list.rows.map((r) => r.out)).toEqual([false, false, true]);
    expect(list.rows[2]).toMatchObject({ needed: 4, racesLeft: 2 });
    expect(toplistNote(list.rows[2])).toBe('4 needed to make the final');
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

describe('toplistNote', () => {
  it('prefers the run-off, then what is needed, then races left', () => {
    expect(toplistNote(row({ runoff: true, position: 3, needed: 2, racesLeft: 4 }))).toBe('Joint 3rd · run-off');
    expect(toplistNote(row({ needed: 2, racesLeft: 4 }))).toBe('2 needed to make the final');
    expect(toplistNote(row({ racesLeft: 1 }))).toBe('1 race left');
    expect(toplistNote(row({ racesLeft: 4 }))).toBe('4 races left');
    expect(toplistNote(row({ withdrawn: true, racesLeft: 4 }))).toBe('Withdrawn');
  });

  it('has nothing to say when there is nothing worth saying', () => {
    expect(toplistNote(row({}))).toBeNull();
  });

  it('still says how many are needed when the figure is zero', () => {
    expect(toplistNote(row({ needed: 0 }))).toBe('0 needed to make the final');
  });
});
