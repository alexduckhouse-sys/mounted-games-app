import type { CompetitionDetail, Session } from '../types';
import { computeTimings } from './time';
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

/** The arena to show on a heat row: only when the competition runs more than one. */
export function arenaToShow(session: Session, arenas: readonly string[]): string | null {
  return arenas.length > 1 ? session.arenaName?.trim() || null : null;
}
