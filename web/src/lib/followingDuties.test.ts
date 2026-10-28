import { describe, expect, it } from 'vitest';
import { competition, heat, session, team } from '../test/factories';
import type { VolunteerShift } from '../types';
import { isDutyHere, nextDuties } from './followingDuties';

const shift = (id: number, extra: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id, competitionId: 1, role: 'Scorer', requiredCount: 1, claimedCount: 0, remainingCount: 1, isFilled: false, claims: [], heatId: 1, assignedTeamId: 1, ...extra,
});

describe('isDutyHere', () => {
  it('counts the team’s word and staff’s check-in, but not an assigned or missing duty', () => {
    expect(isDutyHere({ attendanceStatus: 'TeamSaysHere' })).toBe(true);
    expect(isDutyHere({ attendanceStatus: 'Here' })).toBe(true);
    expect(isDutyHere({ attendanceStatus: 'Assigned' })).toBe(false);
    expect(isDutyHere({ attendanceStatus: 'Missing' })).toBe(false);
    expect(isDutyHere({})).toBe(false);
  });
});

describe('nextDuties', () => {
  const comp = competition({ teams: [team(1), team(2)], sessions: [
    session(1, { scheduledStart: '2026-07-01T09:00:00Z', status: 1, heats: [
      heat(1, { scheduledStart: '2026-07-01T09:00:00Z', finishedAt: '2026-07-01T09:10:00Z' }),
      heat(2, { scheduledStart: '2026-07-01T09:30:00Z' }),
      heat(3, { scheduledStart: '2026-07-01T10:00:00Z' }),
    ] }),
    session(2, { kind: 1, isBreak: true, scheduledStart: '2026-07-01T11:00:00Z' }),
  ] });
  it('picks each followed team’s earliest duty whose heat hasn’t been scored', () => {
    const duties = nextDuties(comp, [
      shift(1, { heatId: 1 }), shift(2, { heatId: 3 }), shift(3, { heatId: 2 }), shift(4, { heatId: 2, assignedTeamId: 2 }), shift(5, { heatId: 3, assignedTeamId: 2 }),
    ], new Set([1]));
    expect([...duties.keys()]).toEqual([1]);
    expect(duties.get(1)!.shift.id).toBe(3);
    expect(duties.get(1)!.row.heat!.id).toBe(2);
  });
  it('ignores whole-event duties, unassigned duties, other teams and heats that no longer exist', () => {
    const duties = nextDuties(comp, [shift(1, { heatId: null }), shift(2, { assignedTeamId: null, heatId: 2 }), shift(3, { heatId: 99 }), shift(4, { heatId: 2, assignedTeamId: 2 })], new Set([1]));
    expect(duties.size).toBe(0);
  });
  it('breaks a tie between two duties in one heat by lane, and puts a heat with no time last', () => {
    const tied = nextDuties(comp, [shift(1, { heatId: 2, laneNumber: 3 }), shift(2, { heatId: 2, laneNumber: 1 }), shift(3, { heatId: 2, laneNumber: 2 }), shift(4, { heatId: 2 })], new Set([1]));
    expect(tied.get(1)!.shift.id).toBe(4);
    expect(nextDuties(comp, [shift(1, { heatId: 2 }), shift(2, { heatId: 2, laneNumber: 2 })], new Set([1])).get(1)!.shift.id).toBe(1);
    const noTimes = competition({ teams: [team(1)], sessions: [session(1, { heats: [heat(1), heat(2, { scheduledStart: '2026-07-01T09:30:00Z' })] })] });
    expect(nextDuties(noTimes, [shift(1, { heatId: 1 }), shift(2, { heatId: 2 })], new Set([1])).get(1)!.shift.id).toBe(2);
    expect(nextDuties(noTimes, [shift(1, { heatId: 2 }), shift(2, { heatId: 1 })], new Set([1])).get(1)!.shift.id).toBe(1);
  });
});
