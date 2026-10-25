import type { CompetitionDetail, Session } from '../types';
import { displaySectionName } from './section';
import { computeTimings, formatDelayDuration, formatTime } from './time';
import { timetableRows } from './timetableRows';

/** Uses the public timetable's timings and statuses, including pinned heat times. */
export function followedHeats(competition: CompetitionDetail, teamIds: ReadonlySet<number>) {
  const teams = new Map(competition.teams.filter((t) => teamIds.has(t.id)).map((t) => [t.id, t]));
  return timetableRows(competition.sessions, computeTimings(competition.sessions), true)
    .filter((row) => row.heat && (row.session.kind ?? 0) === 0)
    .flatMap((row) => {
      const entries = row.heat!.entries.filter((e) => teams.has(e.teamId));
      if (!entries.length) return [];
      const scores = entries.map((entry) => {
        const results = row.heat!.races.filter((race) => race.isComplete)
          .flatMap((race) => race.results.filter((result) => result.teamId === entry.teamId));
        return { team: teams.get(entry.teamId)!, lane: entry.laneIndex,
          points: results.reduce((sum, result) => sum + result.points, 0), racesRun: results.length };
      });
      return [{ ...row, scores }];
    });
}

/** Distinct arena names used by a competition's sessions, in session order. */
export function arenaNames(sessions: readonly Session[]): string[] {
  return [...new Set(sessions.flatMap((session) => session.arenaName?.trim() || []))];
}

export type FollowedHeat = ReturnType<typeof followedHeats>[number];

/** Where a followed team stands: its next heat, nothing left to run, or not drawn into a heat yet. */
export type TeamNext =
  | { kind: 'heat'; row: FollowedHeat; lane: number }
  | { kind: 'done' }
  | { kind: 'undrawn' };

/** Each followed team's next unfinished heat, by team id. Teams that aren't at the event are left out. */
export function nextHeats(competition: CompetitionDetail, teamIds: ReadonlySet<number>): Map<number, TeamNext> {
  const rows = followedHeats(competition, teamIds);
  const next = new Map<number, TeamNext>();
  for (const team of competition.teams) {
    if (!teamIds.has(team.id)) continue;
    const mine = rows.filter((row) => row.scores.some((score) => score.team.id === team.id));
    const upcoming = mine.find((row) => row.status !== 'finished');
    if (upcoming) next.set(team.id, { kind: 'heat', row: upcoming, lane: upcoming.scores.find((score) => score.team.id === team.id)!.lane });
    else next.set(team.id, mine.length ? { kind: 'done' } : { kind: 'undrawn' });
  }
  return next;
}

/** "Heat 3", or the label the organiser gave the heat. */
export function heatName(row: Pick<FollowedHeat, 'heat' | 'heatIndex'>): string {
  return row.heat!.label || `Heat ${row.heatIndex + 1}`;
}

export interface NextSummary {
  /** "Open · Heat 3, lane 2 · Arena 2" */
  sub: string;
  /** "10:54", or a dash when there is no heat to wait for. */
  time: string;
  /** The small words under the time: "Next heat", "On now", "+6 min", "Heats TBC". */
  label: string;
  tone: 'ok' | 'late' | 'live' | 'wait';
}

/** The words on a followed team's row: age group, heat and lane, then the time and how it is going. */
export function summariseNext(team: { sectionName?: string | null }, next: TeamNext | undefined, arenas: readonly string[]): NextSummary {
  const section = displaySectionName(team.sectionName);
  const lead = (rest: string) => [section, rest].filter(Boolean).join(' · ');
  if (next?.kind === 'heat') {
    const { row, lane } = next;
    const arena = arenaToShow(row.session, arenas);
    const where = `${heatName(row)}, lane ${lane}${arena ? ` · ${arena}` : ''}`;
    const tone = row.status === 'live' ? 'live' : row.status === 'late' ? 'late' : 'ok';
    const label = tone === 'live' ? 'On now' : tone === 'late' ? `+${formatDelayDuration(row.delayMinutes)}` : 'Next heat';
    return { sub: lead(where), time: formatTime(row.effective), label, tone };
  }
  if (next?.kind === 'done') return { sub: lead('finished'), time: '–', label: 'Heats done', tone: 'wait' };
  return { sub: lead('not drawn yet'), time: '–', label: 'Heats TBC', tone: 'wait' };
}

/** The arena to show on a heat row: only when the competition runs more than one. */
export function arenaToShow(session: Session, arenas: readonly string[]): string | null {
  return arenas.length > 1 ? session.arenaName?.trim() || null : null;
}
