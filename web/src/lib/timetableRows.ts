import type { Heat, Session } from '../types';
import { displaySectionName } from './section.ts';
import { formatDelayDuration, type HeatTiming, type SessionTiming } from './time.ts';

export type TimetableStatus = 'on-time' | 'late' | 'live' | 'finished';
export const TIMETABLE_COLOURS = { 'on-time': '#2E8B4F', late: '#C08308', live: '#2563EB', finished: '#A3A39B' } as const;

/** A row only counts as running late from this many minutes; smaller drifts round away and just look noisy. */
export const LATE_THRESHOLD_MINUTES = 5;

export function timetableStatus(finished: boolean, live: boolean, scheduled: Date | null, effective: Date | null): { status: TimetableStatus; delayMinutes: number } {
  const drift = scheduled && effective ? Math.max(0, Math.round((effective.getTime() - scheduled.getTime()) / 60_000)) : 0;
  const delayMinutes = drift >= LATE_THRESHOLD_MINUTES ? drift : 0;
  return { status: finished ? 'finished' : live ? 'live' : delayMinutes > 0 ? 'late' : 'on-time', delayMinutes };
}

/** The words on a row's status pill: "On now", "+8 min", "+1h 34m", "On time" or "Finished". */
export function statusLabel(status: TimetableStatus, delayMinutes: number): string {
  if (status === 'finished') return 'Finished';
  if (status === 'live') return 'On now';
  return status === 'late' ? `+${formatDelayDuration(delayMinutes)}` : 'On time';
}

export interface TimetableRow {
  key: string;
  session: Session;
  heat: Heat | null;
  heatIndex: number;
  group: 'Heats' | 'Finals';
  scheduled: Date | null;
  effective: Date | null;
  status: TimetableStatus;
  delayMinutes: number;
}

export function timetableRows(sessions: Session[], timings: Map<number, SessionTiming>, showQualifiers: boolean): TimetableRow[] {
  const rows: TimetableRow[] = [];
  for (const session of [...sessions].sort((a, b) => a.orderIndex - b.orderIndex)) {
    const timing = timings.get(session.id);
    const heats = [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex);
    const active = session.status === 1 ? heats.find((heat) => !heat.finishedAt && !(heat.races.length > 0 && heat.races.every((race) => race.isComplete))) : undefined;
    function add(heat: Heat | null, heatIndex: number, rowTiming: HeatTiming | SessionTiming | undefined) {
      const scheduled = rowTiming?.scheduled ?? null;
      const effective = rowTiming?.effective ?? scheduled;
      const finished = session.status === 2 || !!heat?.finishedAt || !!(heat && heat.races.length > 0 && heat.races.every((race) => race.isComplete));
      const live = heat ? heat.id === active?.id : session.status === 1;
      const isFinal = heat?.raceRoundStage === 2 || /\bfinals?\b/i.test(heat?.label ?? '') || /\bfinals?\b/i.test(session.name);
      rows.push({ key: heat ? `heat-${heat.id}` : `session-${session.id}`, session, heat, heatIndex, group: isFinal ? 'Finals' : 'Heats', scheduled, effective, ...timetableStatus(finished, live, scheduled, effective) });
    }
    if (heats.length === 0 || (session.kind ?? (session.isBreak ? 1 : 0)) !== 0) add(null, 0, timing);
    else heats.forEach((heat, index) => {
      if (!showQualifiers && heat.raceRoundStage === 1) return;
      add(heat, index, timing?.heats.find((item) => item.heatId === heat.id));
    });
  }
  return rows.sort((a, b) => (a.effective?.getTime() ?? Infinity) - (b.effective?.getTime() ?? Infinity) || a.session.orderIndex - b.session.orderIndex || a.heatIndex - b.heatIndex);
}

const isRace = (session: Session) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;

/** 1-based position of each race session among the sessions of its age group, in running order. */
export function sessionOrdinals(sessions: Session[]): Map<number, number> {
  const counts = new Map<string, number>();
  const ordinals = new Map<number, number>();
  for (const session of [...sessions].sort((a, b) => a.orderIndex - b.orderIndex)) {
    if (!isRace(session)) continue;
    const key = session.competitionSectionId != null ? `id-${session.competitionSectionId}` : `name-${session.sectionName ?? session.name}`;
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    ordinals.set(session.id, next);
  }
  return ordinals;
}

export interface TimetableGroup { key: string; session: Session; race: boolean; rows: TimetableRow[] }

/** Splits time-ordered rows into runs of the same session, so each session gets one heading. */
export function groupRowsBySession(rows: TimetableRow[]): TimetableGroup[] {
  const groups: TimetableGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.session.id === row.session.id) last.rows.push(row);
    else groups.push({ key: `${row.session.id}-${groups.length}`, session: row.session, race: isRace(row.session), rows: [row] });
  }
  return groups;
}

/** True when every row of a group has finished (an empty group is not finished). */
export function isGroupFinished(rows: { status: TimetableStatus }[]): boolean {
  return rows.length > 0 && rows.every((row) => row.status === 'finished');
}

/** The longest delay, in minutes, among a group's unfinished, non-live rows (0 when nothing is running late). */
export function groupMaxDelay(rows: { status: TimetableStatus; delayMinutes: number }[]): number {
  return Math.max(0, ...rows.filter((row) => row.status !== 'finished' && row.status !== 'live').map((row) => row.delayMinutes));
}

/** "Seniors Session 1": the age group (without "Teams") plus its session number. */
export function sessionTitle(session: Session, ordinals: Map<number, number>): string {
  return `${displaySectionName(session.sectionName || session.name)} Session ${ordinals.get(session.id) ?? 1}`;
}
