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
  if (s.minutesPerHeat) return s.minutesPerHeat * Math.max(1, h.races.length);
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

/**
 * Walks all sessions in order. When a session has `startedAt` we anchor on the
 * real start; the resulting offset cascades forward to every later session that
 * hasn't started yet. Returns scheduled + effective times for the session and
 * each of its heats with a `shifted` flag if the two differ by ≥1 minute.
 */
export function computeTimings(sessions: Session[]): Map<number, SessionTiming> {
  const ordered = sessions.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const result = new Map<number, SessionTiming>();
  let offsetMs = 0;
  let lastEffectiveEnd: Date | null = null;

  for (const s of ordered) {
    const scheduled = s.scheduledStart ? new Date(s.scheduledStart) : null;
    let effective: Date | null = null;

    if (s.startedAt) {
      effective = new Date(s.startedAt);
      if (scheduled) offsetMs = effective.getTime() - scheduled.getTime();
    } else if (scheduled) {
      effective = new Date(scheduled.getTime() + offsetMs);
      // Don't let an early-shifted session start before the previous one ended.
      if (lastEffectiveEnd && effective < lastEffectiveEnd) {
        effective = new Date(lastEffectiveEnd);
        if (scheduled) offsetMs = effective.getTime() - scheduled.getTime();
      }
    } else if (lastEffectiveEnd) {
      effective = new Date(lastEffectiveEnd);
    }

    const heats = (s.heats ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const heatTimings: HeatTiming[] = [];
    let heatCursor = effective ? new Date(effective) : null;
    let scheduledCursor = scheduled ? new Date(scheduled) : null;

    for (const h of heats) {
      const dur = heatDurationMinutes(h, s);
      let hScheduled = scheduledCursor ? new Date(scheduledCursor) : null;
      let hEffective: Date | null = null;
      if (h.startedAt) {
        hEffective = new Date(h.startedAt);
      } else if (heatCursor) {
        hEffective = new Date(heatCursor);
      }
      const hShifted = !!(hScheduled && hEffective
        && Math.abs(hEffective.getTime() - hScheduled.getTime()) >= 60_000);
      heatTimings.push({ heatId: h.id, scheduled: hScheduled, effective: hEffective, shifted: hShifted });
      if (heatCursor) heatCursor = new Date(heatCursor.getTime() + dur * 60_000);
      if (scheduledCursor) scheduledCursor = new Date(scheduledCursor.getTime() + dur * 60_000);
    }

    const dur = sessionDurationMinutes(s);
    const effectiveEnd = effective ? new Date(effective.getTime() + dur * 60_000) : null;
    if (effectiveEnd) lastEffectiveEnd = effectiveEnd;

    const shifted = !!(scheduled && effective
      && Math.abs(effective.getTime() - scheduled.getTime()) >= 60_000);

    result.set(s.id, { sessionId: s.id, scheduled, effective, effectiveEnd, shifted, heats: heatTimings });
  }

  return result;
}
