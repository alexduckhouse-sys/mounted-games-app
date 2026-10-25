import type { Heat, Session } from '../types';

export function roundTo5Min(d: Date | null): Date | null {
  if (!d) return null;
  const ms = 5 * 60 * 1000;
  return new Date(Math.round(d.getTime() / ms) * ms);
}

export function formatTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export interface HeatTiming {
  heatId: number;
  scheduled: Date | null;
  effective: Date | null;
  shifted: boolean;
}

export interface SessionTiming {
  sessionId: number;
  scheduled: Date | null;
  effective: Date | null;
  /** End of session in effective time (used for cascading to the next session). */
  effectiveEnd: Date | null;
  shifted: boolean;
  heats: HeatTiming[];
}

function heatDurationMinutes(h: Heat, s: Session): number {
  if (h.durationMinutes) return h.durationMinutes;
  if (s.minutesPerHeat) return s.minutesPerHeat;
  return 30;
}

function sessionDurationMinutes(s: Session): number {
  if (s.kind === 1 || s.kind === 2 || s.kind === 3) {
    return s.durationMinutes ?? 0;
  }
  const heats = s.heats ?? [];
  if (heats.length === 0) return s.durationMinutes ?? 0;
  return heats.reduce((sum, h) => sum + heatDurationMinutes(h, s), 0);
}

/** Running delay and end of the last session placed for one arena (or for the whole event). */
interface Lane {
  offsetMs: number;
  lastEffectiveEnd: Date | null;
}

const arenaKey = (s: Session) => s.arenaName?.trim() ?? '';

/**
 * Walks the sessions in order. When a session has `startedAt` we anchor on the
 * real start; the resulting offset cascades forward to every later session of
 * the same arena that hasn't started yet. Returns scheduled + effective times
 * for the session and each of its heats with a `shifted` flag if the two differ
 * by at least 5 minutes.
 *
 * Arenas run independently: each named arena has its own offset and its own
 * "previous session ended" cursor, so Arena 1 running late never moves Arena 2.
 * Sessions with no arena (whole-event breaks and briefings) are placed after
 * the arenas: they take the largest delay of any arena so far (never less than
 * on schedule) and wait for the last arena session before them to end, because
 * everyone needs to be free for them. They don't hold the arenas back in turn;
 * each arena carries on with its own delay. When no session names an arena
 * (a single-arena event) everything shares one lane, as before.
 */
export function computeTimings(sessions: Session[]): Map<number, SessionTiming> {
  const ordered = sessions.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const result = new Map<number, SessionTiming>();
  const hasArenas = ordered.some((s) => arenaKey(s) !== '');
  const lanes = new Map<string, Lane>();
  const laneFor = (key: string): Lane => {
    let lane = lanes.get(key);
    if (!lane) { lane = { offsetMs: 0, lastEffectiveEnd: null }; lanes.set(key, lane); }
    return lane;
  };

  for (const s of ordered) {
    const key = hasArenas ? arenaKey(s) : '';
    let lane: Lane;
    if (key === '' && hasArenas) {
      // Whole-event item: a throwaway lane built from every arena so far.
      const all = [...lanes.values()];
      lane = {
        offsetMs: Math.max(0, ...all.map((l) => l.offsetMs)),
        lastEffectiveEnd: all.reduce<Date | null>((latest, l) => (l.lastEffectiveEnd && (!latest || l.lastEffectiveEnd > latest) ? l.lastEffectiveEnd : latest), null),
      };
    } else {
      lane = laneFor(key);
    }

    const rawScheduled = s.scheduledStart ? new Date(s.scheduledStart) : null;
    const shiftMatch = s.notes?.match(/\[shift:([+-]?\d+)\]/);
    const manualShiftMs = shiftMatch ? parseInt(shiftMatch[1], 10) * 60_000 : 0;
    const scheduled = rawScheduled ? new Date(rawScheduled.getTime() - manualShiftMs) : null;
    let effective: Date | null = null;

    if (s.startedAt) {
      effective = new Date(s.startedAt);
      if (scheduled) lane.offsetMs = effective.getTime() - scheduled.getTime();
    } else if (scheduled && rawScheduled) {
      effective = manualShiftMs !== 0
        ? new Date(rawScheduled.getTime())
        : new Date(scheduled.getTime() + lane.offsetMs);
      if (manualShiftMs !== 0) lane.offsetMs = manualShiftMs;
      // Don't let an early-shifted session start before the previous one ended.
      if (lane.lastEffectiveEnd && effective < lane.lastEffectiveEnd) {
        effective = new Date(lane.lastEffectiveEnd);
        lane.offsetMs = effective.getTime() - scheduled.getTime();
      }
    } else if (lane.lastEffectiveEnd) {
      effective = new Date(lane.lastEffectiveEnd);
    }

    const heats = (s.heats ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const heatTimings: HeatTiming[] = [];
    let heatCursor = effective ? new Date(effective) : null;
    let scheduledCursor = scheduled ? new Date(scheduled) : null;

    for (const h of heats) {
      const dur = heatDurationMinutes(h, s);
      // Per-heat scheduledStart, when set, pins the heat: it carries the session's delay, and never
      // starts before the heat ahead of it has finished.
      const rawPinned = h.scheduledStart ? new Date(h.scheduledStart) : null;
      const pinned = rawPinned ? new Date(rawPinned.getTime() - (!h.finishedAt ? manualShiftMs : 0)) : null;
      const hScheduled = pinned ?? (scheduledCursor ? new Date(scheduledCursor) : null);
      let hEffective: Date | null = null;
      if (h.startedAt) {
        hEffective = new Date(h.startedAt);
      } else if (pinned && rawPinned) {
        const delayed = manualShiftMs !== 0 ? rawPinned.getTime() : pinned.getTime() + lane.offsetMs;
        hEffective = new Date(heatCursor ? Math.max(delayed, heatCursor.getTime()) : delayed);
      } else if (heatCursor) {
        hEffective = new Date(heatCursor);
      }
      // Only flag a shift once the delta is at least 5 minutes — smaller
      // drifts round away to the same 5-min slot anyway and just look noisy.
      const hShifted = !!(hScheduled && hEffective
        && Math.abs(hEffective.getTime() - hScheduled.getTime()) >= 5 * 60_000);
      heatTimings.push({ heatId: h.id, scheduled: hScheduled, effective: hEffective, shifted: hShifted });
      // The next heat follows when this one actually runs, so a late or early start carries on.
      heatCursor = hEffective ? new Date(hEffective.getTime() + dur * 60_000) : null;
      const advanceFromScheduled = pinned ?? scheduledCursor;
      scheduledCursor = advanceFromScheduled ? new Date(advanceFromScheduled.getTime() + dur * 60_000) : null;
    }

    const dur = sessionDurationMinutes(s);
    // A race session ends when its last heat does (heats can run early or late); breaks and the like have their own length.
    const isBreakLike = s.kind === 1 || s.kind === 2 || s.kind === 3;
    const effectiveEnd: Date | null = !isBreakLike && heats.length > 0 && heatCursor
      ? new Date(heatCursor)
      : effective ? new Date(effective.getTime() + dur * 60_000) : null;
    if (effectiveEnd) lane.lastEffectiveEnd = effectiveEnd;

    const shifted = !!(scheduled && effective
      && Math.abs(effective.getTime() - scheduled.getTime()) >= 5 * 60_000);

    result.set(s.id, { sessionId: s.id, scheduled, effective, effectiveEnd, shifted, heats: heatTimings });
  }

  return result;
}
