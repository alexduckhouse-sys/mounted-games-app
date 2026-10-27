import type { Session } from '../types';
import { computeTimings, parsePausedAtMs, roundTo5Min } from './time.ts';

const PAUSE_TAG = /\s*\[paused:\d+\]\s*/g;

/**
 * When the last race would finish if racing started again at `restartAt`, to the nearest 5 minutes; null when the
 * timetable has nothing left to run or no times to work from.
 *
 * It asks `computeTimings` rather than doing its own sums: a session paused at some time and "now" being the restart
 * time is exactly how the timetable already turns a pause into a delay and carries it through each arena's later
 * sessions. Unfinished sessions in the arena (all arenas when `arenaName` is empty) are treated as paused from the
 * pause they already have, or from `nowMs` if they are still running.
 */
export function estimateLastRaceFinish(
  sessions: Session[],
  restartAt: Date,
  { arenaName, nowMs }: { arenaName?: string | null; nowMs: number },
): Date | null {
  const arena = arenaName?.trim() ?? '';
  const stopped = (session: Session) => session.status !== 2 && (!arena || (session.arenaName?.trim() ?? '') === arena);
  const paused = sessions.map((session) => {
    if (!stopped(session)) return session;
    const since = parsePausedAtMs(session.notes) ?? nowMs;
    const notes = `${(session.notes ?? '').replace(PAUSE_TAG, ' ').trim()} [paused:${since}]`.trim();
    return { ...session, notes };
  });
  const timings = computeTimings(paused, { nowMs: restartAt.getTime() });
  let last: Date | null = null;
  for (const session of paused) {
    const isRace = (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
    const end = isRace && session.status !== 2 ? timings.get(session.id)?.effectiveEnd : null;
    if (end && (!last || end > last)) last = end;
  }
  return roundTo5Min(last);
}
