import { describe, expect, it } from 'vitest';
import type { Heat, Session } from '../types';
import { heat as baseHeat, race, result, session as baseSession, team } from '../test/factories';
import { buildToplist, finalLineups } from './toplist';

const SECTION = 9;
const OTHER = 77;
const drawn = (teamIds: number[]): Heat['entries'] => teamIds.map((teamId, lane) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: lane }));
const heat = (id: number, teamIds: number[], extra: Partial<Heat> = {}) => baseHeat(id, { entries: drawn(teamIds), ...extra });
const session = (id: number, heats: Heat[], extra: Partial<Session> = {}) =>
  baseSession(id, { competitionSectionId: SECTION, name: 'Seniors heats', orderIndex: id, heats, ...extra });
const teams = [team(1, { competitionSectionId: SECTION }), team(2, { competitionSectionId: SECTION }), team(3, { competitionSectionId: SECTION }), team(8, { competitionSectionId: OTHER })];
const lineups = (sessions: Session[], sectionId = SECTION) => finalLineups(sessions, teams, sectionId);

describe('finalLineups', () => {
  it('lists a drawn final with its team names in lane order, without places or points', () => {
    const lanes: Heat['entries'] = [
      { id: 1, teamId: 3, teamName: 'Team 3', laneIndex: 2 },
      { id: 2, teamId: 1, teamName: 'Team 1', laneIndex: 0 },
      { id: 3, teamId: 2, teamName: 'Team 2', laneIndex: 1 },
    ];
    const result = lineups([session(2, [baseHeat(5, { label: 'A Final', raceRoundStage: 2, entries: lanes })], { name: 'Seniors finals' })]);
    expect(result).toEqual([{ id: 5, label: 'A Final', teams: [{ teamId: 1, teamName: 'Team 1' }, { teamId: 2, teamName: 'Team 2' }, { teamId: 3, teamName: 'Team 3' }] }]);
  });

  it('includes only finals that have been drawn and leaves out heats that are not finals', () => {
    const sessions = [
      session(1, [heat(1, [1, 2, 3], { label: 'Heat 1' })]),
      session(2, [heat(2, [], { label: 'A Final', raceRoundStage: 2 }), heat(3, [1, 2], { label: 'B Final', raceRoundStage: 2 })], { name: 'Seniors finals' }),
    ];
    expect(lineups(sessions).map((l) => l.label)).toEqual(['B Final']);
  });

  it('shows a final before it has any results and keeps drawing the same teams once it has', () => {
    const waiting = session(2, [heat(2, [1, 2], { label: 'A Final', raceRoundStage: 2, races: [race(2)] })]);
    const decided = session(2, [heat(2, [1, 2], { label: 'A Final', raceRoundStage: 2, races: [race(2, { isComplete: true, results: [result(2, 1, { points: 4 }), result(1, 2, { points: 2 })] })] })]);
    expect(lineups([waiting])[0].teams.map((t) => t.teamId)).toEqual([1, 2]);
    expect(lineups([decided])[0].teams.map((t) => t.teamId)).toEqual([1, 2]);
  });

  it('uses a heat label that says Final as it is, otherwise the session name then the heat name', () => {
    const sessions = [
      session(1, [heat(1, [1], { label: 'A Final' })], { name: 'Anything' }),
      session(2, [heat(2, [2], { label: ' Run-off ', raceRoundStage: 2 })], { name: 'Seniors finals' }),
      session(3, [heat(3, [3], { raceRoundStage: 2 })], { name: 'Seniors finals' }),
      session(4, [heat(4, [1], { label: 'Final', raceRoundStage: 2 })], { name: 'Seniors finals' }),
    ];
    expect(lineups(sessions).map((l) => l.label)).toEqual(['A Final', 'Seniors finals · Run-off', 'Seniors finals', 'Final']);
  });

  it('puts finals in running order, sessions then heats', () => {
    const sessions = [
      session(3, [heat(30, [1], { label: 'C Final', orderIndex: 1 })], { orderIndex: 3 }),
      session(2, [heat(21, [1], { label: 'B Final', orderIndex: 2 }), heat(20, [2], { label: 'A Final', orderIndex: 1 })], { orderIndex: 2 }),
    ];
    expect(lineups(sessions).map((l) => l.label)).toEqual(['A Final', 'B Final', 'C Final']);
  });

  it('keeps to the age group: its own sessions, and a mixed session only when its teams are drawn', () => {
    const own = session(1, [heat(1, [1, 2], { label: 'A Final' })]);
    const elsewhere = session(2, [heat(2, [8], { label: 'A Final' })], { competitionSectionId: OTHER });
    const mixed = session(3, [heat(3, [1, 8], { label: 'B Final' })], { competitionSectionId: OTHER });
    const sessions = [own, elsewhere, mixed];
    expect(lineups(sessions).map((l) => l.id)).toEqual([1, 3]);
    expect(lineups(sessions, OTHER).map((l) => l.id)).toEqual([2, 3]);
    expect(lineups(sessions, 12)).toEqual([]);
  });

  it('in a mixed session lists a final with any of the age group\'s teams (all its riders) and skips one with only other groups\' teams', () => {
    const mixed = session(3, [
      heat(31, [1, 8], { label: 'A Final', orderIndex: 1 }),
      heat(32, [8], { label: 'B Final', orderIndex: 2 }),
    ], { competitionSectionId: OTHER, name: 'Combined finals' });
    expect(lineups([mixed]).map((l) => [l.id, l.teams.map((t) => t.teamId)])).toEqual([[31, [1, 8]]]);
    expect(lineups([mixed], OTHER).map((l) => [l.id, l.teams.map((t) => t.teamId)])).toEqual([[31, [1, 8]], [32, [8]]]);
  });

  it('returns nothing when no final is drawn, and needs no standings at all to list one that is', () => {
    expect(lineups([])).toEqual([]);
    expect(lineups([session(1, [heat(1, [1, 2, 3], { label: 'Heat 1' }), heat(2, [1, 2], { label: 'Heat 2' })])])).toEqual([]);
    // Nothing scored and no standings: buildToplist has no rows, yet the drawn final still shows by name.
    const drawnOnly = [session(2, [heat(5, [3, 1], { label: 'A Final', raceRoundStage: 2, races: [race(5)] })], { name: 'Seniors finals' })];
    expect(buildToplist([], drawnOnly, teams, SECTION, null).rows).toEqual([]);
    expect(lineups(drawnOnly)).toEqual([{ id: 5, label: 'A Final', teams: [{ teamId: 3, teamName: 'Team 3' }, { teamId: 1, teamName: 'Team 1' }] }]);
  });

  it('lists the lanes as drawn: hors concours teams are not filtered out, and a heat with no lanes is skipped', () => {
    const hc = [team(1, { competitionSectionId: SECTION, isHorsConcours: true }), team(2, { competitionSectionId: SECTION })];
    const sessions = [session(2, [heat(5, [1, 2], { label: 'A Final', raceRoundStage: 2 }), heat(6, [], { label: 'B Final', raceRoundStage: 2 })])];
    expect(finalLineups(sessions, hc, SECTION).map((l) => [l.id, l.teams.map((t) => t.teamId)])).toEqual([[5, [1, 2]]]);
  });

  it('ignores break sessions and a competition with no age group chosen', () => {
    const interval = session(1, [heat(1, [1], { label: 'A Final' })], { kind: 1 });
    expect(lineups([interval])).toEqual([]);
    expect(lineups([session(2, [heat(2, [1], { label: 'A Final' })])], -1)).toEqual([]);
  });

  it('does not change the headings of the final results', () => {
    const sessions = [
      session(1, [heat(1, [1, 2], { label: 'Heat 1', races: [race(1, { isComplete: true, results: [result(1, 1, { points: 3 })] })] })]),
      session(2, [heat(2, [1, 2], { label: 'A Final', raceRoundStage: 2, races: [race(2, { isComplete: true, results: [result(1, 1, { points: 3 })] })] }), heat(3, [1], { label: 'Run-off', raceRoundStage: 2, orderIndex: 3, races: [race(3, { isComplete: true, results: [result(1, 1, { points: 1 })] })] })], { name: 'Seniors finals' }),
    ];
    expect(buildToplist([], sessions, teams, SECTION, null).finals.map((g) => g.label)).toEqual(['A Final', 'Seniors finals · Run-off']);
  });
});
