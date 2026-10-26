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

/**
 * Formats a non-negative delay in minutes for display: under 60 minutes as
 * "25 min", and 60 minutes or more as "1h 34m" or "2h".
 */
export function formatDelayDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

/**
 * Formats a signed minute shift for badges and banners: under 60 minutes as
 * "+15m" / "-10m", and 60 minutes or more as "+1h 34m" / "-2h".
 */
export function formatShiftDelta(deltaMinutes: number): string {
  const sign = deltaMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(Math.round(deltaMinutes));
  if (abs < 60) return `${sign}${abs}m`;
  const hours = Math.floor(abs / 60);
  const rem = abs % 60;
  return rem === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${rem}m`;
}

export function parsePausedAtMs(notes?: string | null): number | null {
  const match = notes?.match(/\[paused:(\d+)\]/);
  const timestamp = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= 253402300799999 ? timestamp : null;
}

export interface PacePrediction {
  avgMinutesPerRace: number | null;
  multiplier: number;
  sampleRaces: number;
  sampleHeats: number;
}

/**
 * Learns the actual minutes-per-race pace from completed heats in the timetable
 * (or falls back to an optional historical average) and returns a multiplier
 * clamped to [0.75, 1.5] for scaling remaining heat durations.
 */
export function predictMinutesPerRace(
  sessions: Session[],
  historicalAvgMinutesPerRace?: number | null,
): PacePrediction {
  let actualTotalMinutes = 0;
  let plannedTotalMinutes = 0;
  let sampleRaces = 0;
  let sampleHeats = 0;

  for (const s of sessions) {
    if (s.kind === 1 || s.kind === 2 || s.kind === 3) continue;
    for (const h of s.heats ?? []) {
      const races = h.races ?? [];
      const completedRaces = races.filter((r) => r.isComplete || !!r.finishedAt);
      const isFinished = !!h.finishedAt || (races.length > 0 && races.every((r) => r.isComplete || !!r.finishedAt));
      const raceCount = h.finishedAt ? races.length : completedRaces.length;
      if (!isFinished || raceCount === 0) continue;

      const firstRaceStart = races
        .map((r) => r.startedAt)
        .filter((t): t is string => !!t)
        .sort()[0];
      const firstHeat = (s.heats ?? []).every((other) => other.orderIndex >= h.orderIndex);
      const startStamp = h.startedAt ?? firstRaceStart ?? (firstHeat ? s.startedAt : null);
      const endStamp = h.finishedAt ?? races
        .map((r) => r.finishedAt)
        .filter((t): t is string => !!t)
        .sort()
        .at(-1);

      if (!startStamp || !endStamp) continue;
      const actualMinutes = (new Date(endStamp).getTime() - new Date(startStamp).getTime()) / 60_000;
      const minutesPerRace = actualMinutes / raceCount;
      if (!Number.isFinite(minutesPerRace) || minutesPerRace < 0.5 || minutesPerRace > 15) continue;

      actualTotalMinutes += actualMinutes;
      plannedTotalMinutes += heatDurationMinutes(h, s);
      sampleRaces += raceCount;
      sampleHeats += 1;
    }
  }

  if ((sampleHeats >= 2 || sampleRaces >= 5) && plannedTotalMinutes > 0) {
    const rawMultiplier = actualTotalMinutes / plannedTotalMinutes;
    const multiplier = Math.min(1.5, Math.max(0.75, rawMultiplier));
    const avgMinutesPerRace = Math.round((actualTotalMinutes / sampleRaces) * 10) / 10;
    return { avgMinutesPerRace, multiplier, sampleRaces, sampleHeats };
  }

  if (historicalAvgMinutesPerRace != null && historicalAvgMinutesPerRace >= 0.5 && historicalAvgMinutesPerRace <= 15) {
    const plannedPerRace = 6;
    const multiplier = Math.min(1.5, Math.max(0.75, historicalAvgMinutesPerRace / plannedPerRace));
    return {
      avgMinutesPerRace: Math.round(historicalAvgMinutesPerRace * 10) / 10,
      multiplier,
      sampleRaces,
      sampleHeats,
    };
  }

  return { avgMinutesPerRace: null, multiplier: 1, sampleRaces, sampleHeats };
}

export interface ComputeTimingsOptions {
  nowMs?: number;
  historicalAvgMinutesPerRace?: number | null;
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
  pauseOffsetMs: number;
  lastEffectiveEnd: Date | null;
}

const arenaKey = (s: Session) => s.arenaName?.trim() ?? '';
const calendarDayKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

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
export function computeTimings(sessions: Session[], options?: ComputeTimingsOptions): Map<number, SessionTiming> {
  const ordered = sessions.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const result = new Map<number, SessionTiming>();
  const nowMs = options?.nowMs ?? Date.now();
  const pace = predictMinutesPerRace(ordered, options?.historicalAvgMinutesPerRace);
  const hasArenas = ordered.some((s) => arenaKey(s) !== '');
  const lanes = new Map<string, Lane>();
  const lastDayByArena = new Map<string, string>();
  let lastDayKey = '';
  const laneFor = (key: string): Lane => {
    let lane = lanes.get(key);
    if (!lane) { lane = { offsetMs: 0, pauseOffsetMs: 0, lastEffectiveEnd: null }; lanes.set(key, lane); }
    return lane;
  };

  for (const s of ordered) {
    const key = hasArenas ? arenaKey(s) : '';
    const rawScheduled = s.scheduledStart ? new Date(s.scheduledStart) : null;
    const shiftMatch = s.notes?.match(/\[shift:([+-]?\d+)\]/);
    const manualShiftMs = shiftMatch ? parseInt(shiftMatch[1], 10) * 60_000 : 0;
    const scheduled = rawScheduled ? new Date(rawScheduled.getTime() - manualShiftMs) : null;
    const dayKey = scheduled
      ? calendarDayKey(scheduled)
      : (lastDayByArena.get(key) ?? lastDayKey);
    if (scheduled) {
      lastDayByArena.set(key, dayKey);
      lastDayKey = dayKey;
    }

    let lane: Lane;
    if (key === '' && hasArenas) {
      // Whole-event item: a throwaway lane built from every arena on the same day so far.
      const dayPrefix = `${dayKey}::`;
      const all = [...lanes.entries()]
        .filter(([k]) => k.startsWith(dayPrefix))
        .map(([, l]) => l);
      lane = {
        offsetMs: Math.max(0, ...all.map((l) => l.offsetMs + l.pauseOffsetMs)) - Math.max(0, ...all.map((l) => l.pauseOffsetMs)),
        pauseOffsetMs: Math.max(0, ...all.map((l) => l.pauseOffsetMs)),
        lastEffectiveEnd: all.reduce<Date | null>((latest, l) => (l.lastEffectiveEnd && (!latest || l.lastEffectiveEnd > latest) ? l.lastEffectiveEnd : latest), null),
      };
    } else {
      lane = laneFor(`${dayKey}::${key}`);
    }

    const previousPauseMs = lane.pauseOffsetMs;
    const pausedAtMs = s.status !== 2 ? parsePausedAtMs(s.notes) : null;
    const pauseMs = (pausedAtMs != null ? Math.max(0, nowMs - pausedAtMs) : 0);
    lane.pauseOffsetMs = hasArenas && key === '' ? Math.max(previousPauseMs, pauseMs) : pauseMs;

    let effective: Date | null = null;

    if (s.startedAt) {
      effective = new Date(s.startedAt);
      if (scheduled) lane.offsetMs = effective.getTime() - scheduled.getTime();
    } else if (scheduled && rawScheduled) {
      if (manualShiftMs !== 0) lane.offsetMs = manualShiftMs;
      effective = new Date(scheduled.getTime() + lane.offsetMs + lane.pauseOffsetMs);
      // Don't let an early-shifted session start before the previous one ended.
      if (lane.lastEffectiveEnd && effective < lane.lastEffectiveEnd) {
        effective = new Date(lane.lastEffectiveEnd);
        lane.offsetMs = effective.getTime() - scheduled.getTime() - lane.pauseOffsetMs;
      }
    } else if (lane.lastEffectiveEnd) {
      effective = new Date(lane.lastEffectiveEnd.getTime() + Math.max(0, lane.pauseOffsetMs - previousPauseMs));
    }

    const heats = (s.heats ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const heatTimings: HeatTiming[] = [];
    let heatCursor = effective ? new Date(effective) : null;
    let scheduledCursor = scheduled ? new Date(scheduled) : null;

    let pauseApplied = !s.startedAt;
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
        const delayed = (manualShiftMs !== 0 ? rawPinned.getTime() : pinned.getTime() + lane.offsetMs) + (h.finishedAt ? 0 : lane.pauseOffsetMs);
        if (!h.finishedAt) pauseApplied = true;
        hEffective = new Date(heatCursor ? Math.max(delayed, heatCursor.getTime()) : delayed);
      } else if (heatCursor) {
        hEffective = new Date(heatCursor.getTime() + (!h.finishedAt && !pauseApplied ? lane.pauseOffsetMs : 0));
        if (!h.finishedAt) pauseApplied = true;
      }
      const orderedRaces = h.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      const isSingleRaceFinishedHeat = orderedRaces.length === 1 && !!h.finishedAt && !orderedRaces[0]?.startedAt && !!s.startedAt && new Date(s.startedAt).getTime() < new Date(h.finishedAt).getTime();
      const r0Stamp = isSingleRaceFinishedHeat ? null : (orderedRaces[0]?.startedAt ?? orderedRaces[0]?.finishedAt);
      if (hScheduled && r0Stamp) {
        const r0Time = new Date(r0Stamp);
        const firstRaceTakenMs = r0Time.getTime() - hScheduled.getTime();
        if (firstRaceTakenMs > 5 * 60_000) {
          const firstRaceDelayMs = firstRaceTakenMs - 2 * 60_000;
          const autoStamped = Boolean(
            (s.startedAt && Math.abs(new Date(s.startedAt).getTime() - r0Time.getTime()) <= 5_000)
            || (h.startedAt && Math.abs(new Date(h.startedAt).getTime() - r0Time.getTime()) <= 5_000),
          );
          if (autoStamped) {
            lane.offsetMs = firstRaceDelayMs;
            hEffective = new Date(hScheduled.getTime() + firstRaceDelayMs);
            if (h === heats[0]) effective = hEffective;
          } else {
            lane.offsetMs = Math.max(lane.offsetMs, firstRaceDelayMs);
          }
        }
      }
      const halfIdx = Math.floor(orderedRaces.length / 2) - 1;
      const rHalfStamp = halfIdx >= 1 ? (orderedRaces[halfIdx].finishedAt ?? orderedRaces[halfIdx].startedAt) : null;
      if (hScheduled && rHalfStamp) {
        const expectedHalfStartMs = hScheduled.getTime() + (halfIdx / orderedRaces.length) * dur * 60_000;
        const halfTakenMs = new Date(rHalfStamp).getTime() - expectedHalfStartMs;
        if (halfTakenMs > 5 * 60_000) {
          lane.offsetMs = Math.max(lane.offsetMs, halfTakenMs - 2 * 60_000);
        }
      }

      // Only flag a shift once the delta is at least 5 minutes — smaller
      // drifts round away to the same 5-min slot anyway and just look noisy.
      const hShifted = !!(hScheduled && hEffective
        && Math.abs(hEffective.getTime() - hScheduled.getTime()) >= 5 * 60_000);
      heatTimings.push({ heatId: h.id, scheduled: hScheduled, effective: hEffective, shifted: hShifted });
      // The next heat follows when this one actually runs, so a late or early start carries on.
      const nextStartMs = hEffective
        ? (hScheduled ? Math.max(hEffective.getTime(), hScheduled.getTime() + lane.offsetMs) : hEffective.getTime())
        : null;
      const effectiveDur = !h.finishedAt && pace.multiplier !== 1 ? Math.round(dur * pace.multiplier) : dur;
      const heatPauseMs = h.startedAt && !h.finishedAt && !pauseApplied ? lane.pauseOffsetMs : 0;
      if (heatPauseMs) pauseApplied = true;
      heatCursor = nextStartMs != null ? new Date(nextStartMs + effectiveDur * 60_000 + heatPauseMs) : null;
      const advanceFromScheduled = pinned ?? scheduledCursor;
      scheduledCursor = advanceFromScheduled ? new Date(advanceFromScheduled.getTime() + dur * 60_000) : null;
    }

    const dur = sessionDurationMinutes(s);
    // A race session ends when its last heat does (heats can run early or late); breaks and the like have their own length.
    const isBreakLike = s.kind === 1 || s.kind === 2 || s.kind === 3;
    const effectiveEnd: Date | null = !isBreakLike && heats.length > 0 && heatCursor
      ? new Date(heatCursor)
      : effective ? new Date(effective.getTime() + dur * 60_000 + (s.startedAt ? lane.pauseOffsetMs : 0)) : null;
    if (effectiveEnd) lane.lastEffectiveEnd = effectiveEnd;

    const shifted = !!(scheduled && effective
      && Math.abs(effective.getTime() - scheduled.getTime()) >= 5 * 60_000);

    result.set(s.id, { sessionId: s.id, scheduled, effective, effectiveEnd, shifted, heats: heatTimings });
  }

  return result;
}
