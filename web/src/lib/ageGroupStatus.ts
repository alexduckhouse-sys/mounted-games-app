import type { Session } from '../types';
import { computeTimings, formatTime } from './time';
import { timetableRows } from './timetableRows';

export interface AgeGroupStatus {
  /** A heat for this age group is running now. */
  live: boolean;
  /** The time of its next heat ("09:05"), or null when nothing is left to run. */
  next: string | null;
}

/** For each age group (by section id): is a heat on now, and when is the next one? Uses the public timetable's times. */
export function ageGroupStatuses(sessions: Session[], sectionIds: number[]): Map<number, AgeGroupStatus> {
  const rows = timetableRows(sessions, computeTimings(sessions), false).filter((row) => row.heat);
  const out = new Map<number, AgeGroupStatus>();
  for (const id of sectionIds) {
    const mine = rows.filter((row) => row.session.competitionSectionId === id);
    const next = mine.find((row) => row.status !== 'finished' && row.status !== 'live');
    out.set(id, { live: mine.some((row) => row.status === 'live'), next: next?.effective ? formatTime(next.effective) : null });
  }
  return out;
}
