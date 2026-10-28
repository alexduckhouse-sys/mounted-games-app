import type { CompetitionDetail, Session } from '../types';
import { parsePausedAtMs } from './time.ts';
import { dayKey } from './timetableDay.ts';

/**
 * Weather alerts for organisers: which hours of the forecast count as dangerous, which of them are worth a line in
 * the top bar, and when racing may start again. Everything here is a pure function of the forecast, the clock, the
 * sessions' pause notes and this device's snoozes, so a flapping forecast cannot leave stale state behind.
 * The thresholds are written down in docs/plans/2026-10-27-weather-alerts.md.
 */

export type Hazard = 'thunder' | 'rain';

export interface ForecastHour {
  /** The start of the hour, as a Unix time in milliseconds. */
  startsAt: number;
  weatherCode: number | null;
  /** Millimetres of rain in the hour. */
  rainMm: number | null;
  /** Chance of rain, 0 to 100. */
  rainChance: number | null;
}

/** A stretch of hazardous hours: one storm. `endsAt` is the end of its last hour. */
export interface HazardRun {
  kind: Hazard;
  startsAt: number;
  endsAt: number;
}

const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
/** A hazard shows once it starts within this long (or is under way). */
export const LOOKAHEAD_MS = 2 * HOUR;
/** Thunder codes in Open-Meteo's WMO table: thunderstorm, with slight hail, with heavy hail. */
export const THUNDER_CODES: readonly number[] = [95, 96, 99];
/** Heavy rain: at least this many mm in an hour (the Met Office's "heavy" line)... */
export const HEAVY_RAIN_MM = 4;
/** ...or at least this many mm when the chance of rain is high. */
export const LIKELY_RAIN_MM = 2.5;
export const LIKELY_RAIN_CHANCE = 70;
/** How long after the last hazard hour racing may restart. Thunder: the usual 30-minute rule. */
export const WAIT_MS: Record<Hazard, number> = { thunder: 30 * MINUTE, rain: 15 * MINUTE };
/** Hazard hours with at most this long between them count as one storm. */
const MERGE_GAP_MS = HOUR;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The hours from `/api/weather/forecast`, or null when the answer is the API's error fallback or has no hours.
 * Times come without a zone, in the venue's zone, so `utc_offset_seconds` turns them into real instants.
 */
export function parseForecastHours(data: unknown): ForecastHour[] | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as { error?: unknown; fallback?: unknown; utc_offset_seconds?: unknown; hourly?: Record<string, unknown> };
  if (body.error || body.fallback || !body.hourly || !Array.isArray(body.hourly.time)) return null;
  const offset = body.utc_offset_seconds;
  const column = (name: string): unknown[] => (Array.isArray(body.hourly?.[name]) ? body.hourly[name] as unknown[] : []);
  const codes = column('weather_code');
  const rain = column('precipitation');
  const chance = column('precipitation_probability');
  const hours: ForecastHour[] = [];
  body.hourly.time.forEach((raw, i) => {
    if (typeof raw !== 'string') return;
    const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
    const startsAt = zoned ? Date.parse(raw) : finite(offset) ? Date.parse(`${raw}Z`) - offset * 1000 : Date.parse(raw);
    if (!Number.isFinite(startsAt)) return;
    hours.push({
      startsAt,
      weatherCode: finite(codes[i]) ? codes[i] : null,
      rainMm: finite(rain[i]) ? rain[i] : null,
      rainChance: finite(chance[i]) ? chance[i] : null,
    });
  });
  return hours.length > 0 ? hours.sort((a, b) => a.startsAt - b.startsAt) : null;
}

/** What is wrong with this hour, if anything. Thunder wins over rain. */
export function hazardOf(hour: ForecastHour): Hazard | null {
  if (hour.weatherCode != null && THUNDER_CODES.includes(hour.weatherCode)) return 'thunder';
  const mm = hour.rainMm;
  if (mm == null) return null;
  if (mm >= HEAVY_RAIN_MM) return 'rain';
  if (mm >= LIKELY_RAIN_MM && (hour.rainChance ?? 0) >= LIKELY_RAIN_CHANCE) return 'rain';
  return null;
}

/** Every storm of one kind in the forecast, in time order. */
export function hazardRuns(hours: ForecastHour[], kind: Hazard): HazardRun[] {
  const runs: HazardRun[] = [];
  for (const hour of hours) {
    if (hazardOf(hour) !== kind) continue;
    const last = runs.at(-1);
    if (last && hour.startsAt - last.endsAt <= MERGE_GAP_MS) last.endsAt = hour.startsAt + HOUR;
    else runs.push({ kind, startsAt: hour.startsAt, endsAt: hour.startsAt + HOUR });
  }
  return runs;
}

/** The storm to warn about: under way now or starting within two hours. Thunder comes before rain. */
export function upcomingHazard(hours: ForecastHour[], now: number): HazardRun | null {
  for (const kind of ['thunder', 'rain'] as const) {
    const run = hazardRuns(hours, kind).find((r) => r.endsAt > now && r.startsAt <= now + LOOKAHEAD_MS);
    if (run) return run;
  }
  return null;
}

/**
 * Whether racing that was paused for `kind` may start again: no hazard of that kind is under way or due in the
 * next two hours, and the wait has passed since the last one ended (or since the pause, if the forecast never
 * showed one). `since` is the time to show: when the last hazard ended, or when racing stopped.
 */
export function clearStatus(hours: ForecastHour[], kind: Hazard, pausedAt: number, now: number): { clear: boolean; since: number } {
  const wait = WAIT_MS[kind];
  const relevant = hours.filter((h) => hazardOf(h) === kind && h.startsAt < now + LOOKAHEAD_MS);
  const blocking = relevant.some((h) => h.startsAt + HOUR > now - wait);
  const lastEnd = relevant.length > 0 ? Math.max(...relevant.map((h) => h.startsAt + HOUR)) : null;
  const quietSince = Math.max(lastEnd ?? 0, pausedAt);
  return { clear: !blocking && now - quietSince >= wait, since: lastEnd ?? pausedAt };
}

/** The time the pause sheet suggests for restarting: after the storm and the wait, to the next 5 minutes. */
export function suggestedRestart(run: HazardRun, now: number): number {
  const at = Math.max(now, run.endsAt) + (run.kind === 'thunder' ? WAIT_MS.thunder : 0);
  return Math.ceil(at / (5 * MINUTE)) * 5 * MINUTE;
}

/** "Not now" for one kind of hazard hides every storm of that kind that starts before this time. */
export type Snoozes = Partial<Record<Hazard, number>>;

export const snoozeUntil = (run: HazardRun) => run.endsAt + HOUR;
export const isSnoozed = (snoozes: Snoozes, run: HazardRun) => (snoozes[run.kind] ?? 0) >= run.startsAt;

const snoozeKey = (competitionId: number) => `mg.weather.snooze.${competitionId}`;

export function readSnoozes(competitionId: number): Snoozes {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(snoozeKey(competitionId)) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const { thunder, rain } = parsed as Record<string, unknown>;
    return { ...(finite(thunder) ? { thunder } : {}), ...(finite(rain) ? { rain } : {}) };
  } catch {
    return {};
  }
}

export function writeSnoozes(competitionId: number, snoozes: Snoozes): void {
  try { localStorage.setItem(snoozeKey(competitionId), JSON.stringify(snoozes)); } catch { /* storage blocked: the snooze lasts until the page closes */ }
}

// ---- What the sessions say ----

const sessionKind = (session: Session) => session.kind ?? (session.isBreak ? 1 : 0);
const arenaOf = (session: Session) => session.arenaName?.trim() ?? '';
const unfinished = (session: Session) => session.status !== 2;

/** Why a session was paused, from the `[pausefor:thunder]` tag the pause request leaves in its notes. */
export function parsePauseReason(notes?: string | null): Hazard | null {
  const reason = notes?.match(/\[pausefor:(thunder|rain)\]/)?.[1];
  return reason === 'thunder' || reason === 'rain' ? reason : null;
}

export interface PauseState {
  /** Every unfinished session is paused (for any reason). */
  allPaused: boolean;
  /** Sessions paused for weather, if there are any. */
  weather: { kind: Hazard; pausedAt: number; arenas: string[] } | null;
}

export function pauseState(sessions: Session[]): PauseState {
  const open = sessions.filter(unfinished);
  const paused = open.filter((s) => parsePausedAtMs(s.notes) != null);
  const forWeather = paused.filter((s) => parsePauseReason(s.notes) != null);
  const weather = forWeather.length === 0 ? null : {
    kind: forWeather.some((s) => parsePauseReason(s.notes) === 'thunder') ? 'thunder' as const : 'rain' as const,
    pausedAt: Math.min(...forWeather.map((s) => parsePausedAtMs(s.notes) as number)),
    arenas: [...new Set(forWeather.map(arenaOf))],
  };
  return { allPaused: open.length > 0 && paused.length === open.length, weather };
}

/** The arenas that still have something to run. */
export function openArenas(sessions: Session[]): string[] {
  return [...new Set(sessions.filter(unfinished).map(arenaOf).filter(Boolean))];
}

const calendarDay = (iso: string) => /^\d{4}-\d{2}-\d{2}/.exec(iso)?.[0] ?? dayKey(new Date(iso));

/** True on a day of the event: its start to end dates, or a day with a scheduled session. */
export function isEventDay(competition: Pick<CompetitionDetail, 'startDate' | 'endDate'>, sessions: Session[], now: Date): boolean {
  const today = dayKey(now);
  const start = calendarDay(competition.startDate);
  const end = calendarDay(competition.endDate ?? competition.startDate);
  if (start && end && today >= start && today <= end) return true;
  return sessions.some((s) => s.scheduledStart && dayKey(new Date(s.scheduledStart)) === today);
}

/** True while at least one race session has yet to finish. */
export const racingToCome = (sessions: Session[]) => sessions.some((s) => sessionKind(s) === 0 && unfinished(s));

export type WeatherLineState =
  | { phase: 'none' }
  | { phase: 'warn'; run: HazardRun }
  | { phase: 'paused'; kind: Hazard; forecastKnown: boolean }
  | { phase: 'clear'; kind: Hazard; since: number };

/**
 * The one line to show, if any. `hours` is null when there is no usable forecast (no coordinates, offline, an error):
 * then only the "paused" line can show, and it stops promising to say when it's clear.
 */
export function weatherLineState(input: { now: number; hours: ForecastHour[] | null; sessions: Session[]; snoozes: Snoozes }): WeatherLineState {
  const { now, hours, sessions, snoozes } = input;
  const { weather } = pauseState(sessions);
  if (weather) {
    if (!hours) return { phase: 'paused', kind: weather.kind, forecastKnown: false };
    const status = clearStatus(hours, weather.kind, weather.pausedAt, now);
    return status.clear
      ? { phase: 'clear', kind: weather.kind, since: status.since }
      : { phase: 'paused', kind: weather.kind, forecastKnown: true };
  }
  const run = hours ? upcomingHazard(hours, now) : null;
  return run && !isSnoozed(snoozes, run) ? { phase: 'warn', run } : { phase: 'none' };
}
