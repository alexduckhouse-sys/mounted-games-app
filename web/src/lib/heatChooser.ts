import type { TimetableRow } from './timetableRows.ts';
import { displaySectionName } from './section.ts';

export interface HeatChoiceRow {
  heatId: number;
  sessionId: number;
  time: Date | null;
  label: string;
  /** "finished" and "live" are named on the row; "later" says nothing. */
  status: 'finished' | 'live' | 'later';
  current: boolean;
}

export interface HeatChoiceGroup {
  key: string;
  /** The age group's name as shown ("Seniors"). */
  section: string;
  rows: HeatChoiceRow[];
}

/** A local calendar day as `2026-10-29`, so heats on the same day can be told apart without slicing strings. */
function dayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The heats of one day grouped by age group, for the "Change heat" sheet. Groups come in the order their first heat
 * runs; within a group heats are in running order. The day is the one the current heat is on (every heat when the
 * current one has no time). Rows that are not heats (breaks, sessions without a draw) are left out.
 */
export function heatChooserGroups(rows: TimetableRow[], currentHeatId: number | null, heatLabel: (row: TimetableRow) => string): HeatChoiceGroup[] {
  const heatRows = rows.filter((row) => row.heat != null && (row.session.kind ?? (row.session.isBreak ? 1 : 0)) === 0);
  const current = heatRows.find((row) => row.heat?.id === currentHeatId);
  const currentTime = current ? current.effective ?? current.scheduled : null;
  const day = currentTime ? dayOf(currentTime) : null;
  const groups = new Map<string, HeatChoiceGroup>();
  for (const row of heatRows) {
    const time = row.effective ?? row.scheduled;
    if (day && time && dayOf(time) !== day) continue;
    const name = displaySectionName(row.session.sectionName || row.session.name);
    const key = row.session.competitionSectionId != null ? `section-${row.session.competitionSectionId}` : `name-${name}`;
    const group = groups.get(key) ?? { key, section: name, rows: [] };
    group.rows.push({
      heatId: row.heat!.id,
      sessionId: row.session.id,
      time,
      label: heatLabel(row),
      status: row.status === 'finished' ? 'finished' : row.status === 'live' ? 'live' : 'later',
      current: row.heat!.id === currentHeatId,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}
