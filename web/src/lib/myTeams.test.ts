import { describe, expect, it } from 'vitest';
import { competition, heat, race, session, team } from '../test/factories';
import { heatRowsForTeam, heatSummary, heatTime, nextHeatRow, teamsNeedingForms } from './myTeams';

const entry = (teamId: number, laneIndex = 2) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex });
const at = (h: number, m: number) => new Date(2026, 5, 1, h, m).toISOString();

describe('heatRowsForTeam', () => {
  it('lists only the team’s heats, in running order, with lane and arena when there are several', () => {
    const comp = competition({ id: 7, name: 'Spring', sessions: [
      session(1, { arenaName: 'Main', scheduledStart: at(9, 0), heats: [heat(1, { entries: [entry(1, 3)] }), heat(2, { entries: [entry(2)] })] }),
      session(2, { arenaName: 'Ring 2', scheduledStart: at(8, 0), heats: [heat(3, { label: 'A Final', entries: [entry(1, 1)] })] }),
    ] });
    const rows = heatRowsForTeam(team(1), comp);
    expect(rows.map((row) => [row.heatId, row.label, row.lane, row.arenaName, row.competitionName])).toEqual([
      [3, 'A Final', 1, 'Ring 2', 'Spring'], [1, 'Heat 1', 3, 'Main', 'Spring'],
    ]);
    expect(heatRowsForTeam(team(9), comp)).toEqual([]);
  });

  it('counts a break before the heat, so an afternoon heat is not shown too early', () => {
    const comp = competition({ sessions: [
      session(1, { orderIndex: 1, scheduledStart: at(9, 0), heats: [heat(1, { durationMinutes: 30, entries: [entry(1)] })] }),
      session(2, { orderIndex: 2, kind: 1, isBreak: true, durationMinutes: 45 }),
      session(3, { orderIndex: 3, heats: [heat(3, { label: 'Afternoon', durationMinutes: 30, entries: [entry(1)] })] }),
    ] });
    const afternoon = heatRowsForTeam(team(1), comp).find((row) => row.label === 'Afternoon')!;
    expect(afternoon.effective?.getHours()).toBe(10);
    expect(afternoon.effective?.getMinutes()).toBe(15);
  });

  it('marks finished, running and waiting heats, and says how late a heat is', () => {
    const comp = competition({ sessions: [session(1, { status: 1, scheduledStart: at(9, 0), startedAt: at(9, 8), heats: [
      heat(1, { entries: [entry(1)], startedAt: at(9, 8), races: [race(1, { isComplete: true })] }),
      heat(2, { entries: [entry(1)] }),
      heat(3, { entries: [entry(1)] }),
    ] })] });
    const rows = heatRowsForTeam(team(1), comp);
    expect(rows.map((row) => row.status)).toEqual(['over', 'live', 'upcoming']);
    expect(rows[2].delayMinutes).toBe(8);
    expect(rows[1].delayMinutes).toBe(8);
    expect(nextHeatRow(rows)?.heatId).toBe(2);
    expect(nextHeatRow(rows.slice(0, 1))).toBeUndefined();
  });

  it('copes with a heat that has no time at all', () => {
    const rows = heatRowsForTeam(team(1), competition({ sessions: [session(1, { heats: [heat(1, { entries: [entry(1)] })] })] }));
    expect(rows[0]).toMatchObject({ scheduled: null, effective: null, delayMinutes: 0 });
    expect(heatTime(rows[0])).toBe('—');
  });
});

describe('heatSummary and heatTime', () => {
  const base = { competitionId: 1, competitionName: 'C', heatId: 1, label: 'Heat 3', sessionName: 's', arenaName: 'Arena 2', lane: 2, scheduled: null, effective: null, shifted: false, delayMinutes: 6, status: 'upcoming' as const };
  it('puts age group, heat, lane, arena and delay on one line', () => {
    expect(heatSummary(base, 'Teams Open')).toBe('Open · Heat 3, lane 2 · Arena 2 · +6 min');
    expect(heatSummary({ ...base, lane: null, arenaName: null, delayMinutes: 0 }, null)).toBe('Heat 3');
  });
  it('rounds the time to five minutes', () => {
    expect(heatTime({ ...base, effective: new Date(2026, 5, 1, 10, 52), scheduled: null })).toBe(heatTime({ ...base, effective: new Date(2026, 5, 1, 10, 50), scheduled: null }));
    expect(heatTime({ ...base, effective: null, scheduled: new Date(2026, 5, 1, 10, 50) })).not.toBe('—');
  });
});

describe('teamsNeedingForms', () => {
  const now = new Date(2026, 5, 1, 12, 0);
  const comps = new Map([
    [1, competition({ id: 1, startDate: '2026-06-01T00:00:00', endDate: null })],
    [2, competition({ id: 2, startDate: '2026-05-01T00:00:00', endDate: '2026-05-02T00:00:00' })],
    [3, competition({ id: 3, startDate: '2026-06-10T00:00:00', isArchived: true })],
    [4, competition({ id: 4, startDate: 'whenever' })],
  ]);
  const mine = (id: number, competitionId: number, extra = {}) => team(id, { competitionId, relationship: 'trainer', ...extra });
  it('asks for a form from a trainer or manager with none in, at an event still to come', () => {
    const teams = [mine(1, 1), mine(2, 1, { relationship: 'manager' }), mine(3, 1), mine(4, 1, { relationship: 'supporter' }), mine(5, 1, { isWithdrawn: true }),
      mine(6, 2), mine(7, 3), mine(8, 99), mine(9, 4)];
    expect(teamsNeedingForms(teams, [{ teamId: 3 }], comps, now).map((t) => t.id)).toEqual([1, 2, 9]);
  });
});
