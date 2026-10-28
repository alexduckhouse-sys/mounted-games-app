import type { CompetitionDetail, VolunteerShift } from '../types';
import { computeTimings } from './time';
import { timetableRows, type TimetableRow } from './timetableRows';

/** A followed team's heat-level duty with the heat it falls in, so the Following card can time it like a heat line. */
export interface TeamDuty { shift: VolunteerShift; row: TimetableRow }

/** Staff or the team has said the steward is at the duty. */
export const isDutyHere = (shift: Pick<VolunteerShift, 'attendanceStatus'>): boolean => {
  const status = (shift.attendanceStatus ?? 'Assigned').toLowerCase();
  return status === 'teamsayshere' || status === 'here';
};

/**
 * Each followed team's next heat duty, by team id: the earliest one whose heat hasn't finished. A duty whose heat has
 * been scored is gone, and so is one for a heat the timetable no longer has.
 */
export function nextDuties(competition: CompetitionDetail, shifts: readonly VolunteerShift[], teamIds: ReadonlySet<number>): Map<number, TeamDuty> {
  const rows = new Map<number, TimetableRow>();
  for (const row of timetableRows(competition.sessions, computeTimings(competition.sessions), true)) if (row.heat) rows.set(row.heat.id, row);
  const next = new Map<number, TeamDuty>();
  for (const shift of shifts) {
    if (shift.heatId == null || shift.assignedTeamId == null || !teamIds.has(shift.assignedTeamId)) continue;
    const row = rows.get(shift.heatId);
    if (!row || row.status === 'finished') continue;
    const best = next.get(shift.assignedTeamId);
    const when = row.effective?.getTime() ?? Infinity;
    const bestWhen = best ? best.row.effective?.getTime() ?? Infinity : Infinity;
    if (!best || when < bestWhen || (when === bestWhen && (shift.laneNumber ?? 0) < (best.shift.laneNumber ?? 0))) next.set(shift.assignedTeamId, { shift, row });
  }
  return next;
}
