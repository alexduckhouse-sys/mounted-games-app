import { tr } from '../i18n/translate';
import type { CompetitionDetail, DeclarationForm, Heat, Session, Team } from '../types';
import { arenaNames, arenaToShow } from './following';
import { displaySectionName } from './section';
import { computeTimings, formatDelayDuration, formatTime, roundTo5Min } from './time';
import { LATE_THRESHOLD_MINUTES } from './timetableRows';

/** One heat a team of mine races in. */
export interface TeamHeatRow {
  competitionId: number;
  competitionName: string;
  heatId: number;
  label: string;
  sessionName: string;
  /** Only set when the competition runs more than one arena. */
  arenaName: string | null;
  lane: number | null;
  scheduled: Date | null;
  effective: Date | null;
  shifted: boolean;
  /** Minutes behind the plan; 0 unless it is at least the late threshold. */
  delayMinutes: number;
  status: 'over' | 'live' | 'upcoming';
}

/** A team's heats at its competition, in running order. Breaks and briefings push later heats back but are not listed. */
export function heatRowsForTeam(team: Pick<Team, 'id'>, comp: CompetitionDetail): TeamHeatRow[] {
  // Time every session, breaks and briefings included, so a lunch break pushes the afternoon heats
  // later; only then keep the races.
  const timings = computeTimings(comp.sessions);
  const sessions: Session[] = comp.sessions.filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0);
  const arenas = arenaNames(sessions);
  const rows: TeamHeatRow[] = [];
  for (const sess of sessions) {
    const heatsInOrder: Heat[] = sess.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const sessTiming = timings.get(sess.id);
    heatsInOrder.forEach((h, idx) => {
      const entry = h.entries.find((e) => e.teamId === team.id);
      if (!entry) return;
      const t = sessTiming?.heats[idx];
      const allDone = h.races.length > 0 && h.races.every((r) => r.isComplete);
      const live = sess.status === 1 && !allDone
        && h.id === heatsInOrder.find((x) => !(x.races.length > 0 && x.races.every((r) => r.isComplete)))?.id;
      const drift = t?.scheduled && t.effective ? Math.max(0, Math.round((t.effective.getTime() - t.scheduled.getTime()) / 60_000)) : 0;
      rows.push({
        competitionId: comp.id,
        competitionName: comp.name,
        heatId: h.id,
        label: h.label ?? `Heat ${idx + 1}`,
        sessionName: sess.name,
        arenaName: arenaToShow(sess, arenas),
        lane: entry.laneIndex,
        scheduled: t?.scheduled ?? null,
        effective: t?.effective ?? null,
        shifted: t?.shifted ?? false,
        delayMinutes: drift >= LATE_THRESHOLD_MINUTES ? drift : 0,
        status: allDone ? 'over' : live ? 'live' : 'upcoming',
      });
    });
  }
  rows.sort((a, b) => {
    const ta = a.effective?.getTime() ?? a.scheduled?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = b.effective?.getTime() ?? b.scheduled?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
  return rows;
}

/** The next heat still to run (or on now), if any. */
export function nextHeatRow(rows: readonly TeamHeatRow[]): TeamHeatRow | undefined {
  return rows.find((row) => row.status !== 'over');
}

/** The heat's time, rounded to five minutes like the rest of the app. */
export function heatTime(row: Pick<TeamHeatRow, 'effective' | 'scheduled'>): string {
  return formatTime(roundTo5Min(row.effective ?? row.scheduled));
}

/** "Open · Heat 3, lane 2 · Arena 2", with "+6 min" added when the heat is running late. */
export function heatSummary(row: TeamHeatRow, section: string | null | undefined): string {
  const where = `${row.label}${row.lane != null ? tr('account.teams.laneSuffix', { n: row.lane }) : ''}${row.arenaName ? ` · ${row.arenaName}` : ''}`;
  return [displaySectionName(section), where, row.delayMinutes > 0 ? `+${formatDelayDuration(row.delayMinutes)}` : ''].filter(Boolean).join(' · ');
}

/** Teams that need a declaration form: mine to look after, at an event that hasn't finished, with no form in yet. */
export function teamsNeedingForms(teams: readonly Team[], forms: readonly Pick<DeclarationForm, 'teamId'>[], comps: ReadonlyMap<number, CompetitionDetail>, now: Date): Team[] {
  const inTeams = new Set(forms.map((form) => form.teamId));
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return teams.filter((team) => {
    if (team.relationship !== 'trainer' && team.relationship !== 'manager') return false;
    if (team.isWithdrawn || inTeams.has(team.id)) return false;
    const comp = comps.get(team.competitionId);
    if (!comp || comp.isArchived) return false;
    const end = new Date(comp.endDate ?? comp.startDate);
    return Number.isNaN(end.getTime()) || end.getTime() >= startOfToday;
  });
}
