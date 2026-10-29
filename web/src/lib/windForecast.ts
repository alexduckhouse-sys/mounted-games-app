import type { ForecastHour } from './weatherAlert';

export interface WindPrompt { startsAt: number; endsAt: number; peakMph: number; severity: 1 | 2; fetchedAt: number }
export interface WindSnooze extends WindPrompt { arena: string }
export const WIND_FRESH_MS = 60 * 60_000;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Awareness prompts, not sporting rules or safe-to-race limits. */
export function windPrompt(hours: ForecastHour[] | null, now: number, previous?: WindPrompt | null,
  reviewMph = 25, officialMph = 35): WindPrompt | null {
  const candidates = (hours ?? []).filter(h => finite(h.gustMph) && finite(h.fetchedAt)
    && now - h.fetchedAt <= WIND_FRESH_MS && h.fetchedAt <= now + 60_000
    && h.startsAt > now && h.startsAt - 3_600_000 <= now + 2 * 3_600_000);
  if (!candidates.length) return null;
  const peak = Math.max(...candidates.map(h => h.gustMph as number));
  const review = previous ? reviewMph - 2 : reviewMph;
  if (peak < review) return null;
  const severity = peak >= (previous?.severity === 2 ? officialMph - 2 : officialMph) ? 2 : 1;
  const affected = candidates.filter(h => (h.gustMph as number) >= review);
  return { startsAt: Math.min(...affected.map(h => h.startsAt - 3_600_000)), endsAt: Math.max(...affected.map(h => h.startsAt)),
    peakMph: peak, severity, fetchedAt: Math.min(...affected.map(h => h.fetchedAt as number)) };
}
export function windSnoozed(prompt: WindPrompt, snooze: WindSnooze | null, arena: string): boolean {
  return !!snooze && snooze.arena === arena && prompt.startsAt >= snooze.startsAt && prompt.endsAt <= snooze.endsAt
    && prompt.severity <= snooze.severity && prompt.peakMph < snooze.peakMph + 5;
}
export function readWindSnooze(id: number): WindSnooze | null {
  try { const v = JSON.parse(localStorage.getItem(`mg.wind.snooze.${id}`) ?? 'null');
    return v && finite(v.startsAt) && finite(v.endsAt) && finite(v.peakMph) && (v.severity === 1 || v.severity === 2) && typeof v.arena === 'string' ? v : null;
  } catch { return null; }
}
export function writeWindSnooze(id: number, value: WindSnooze): void {
  try { localStorage.setItem(`mg.wind.snooze.${id}`, JSON.stringify(value)); } catch { /* Keep the in-memory snooze. */ }
}
export function venueDay(at: Date, zone?: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone ?? 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at); }
  catch { return at.toISOString().slice(0, 10); }
}
