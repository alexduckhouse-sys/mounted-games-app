import { describe, expect, it } from 'vitest';
import { parseForecastHours } from './weatherAlert';
import { windPrompt, windSnoozed, venueDay, WIND_FRESH_MS, readWindSnooze, writeWindSnooze } from './windForecast';
const now = Date.parse('2026-10-25T00:30:00Z');
const hours = (mph: number, fetchedAt = now) => parseForecastHours({ fetchedAt: new Date(fetchedAt).toISOString(), timezone: 'Europe/London',
  gustIntervals: [1, 2].map(h => ({ startsAt: Date.parse('2026-10-25T00:00:00Z') / 1000 + (h - 1) * 3600, endsAt: Date.parse('2026-10-25T00:00:00Z') / 1000 + h * 3600, gustMph: mph })),
  hourly: { time: [Date.parse('2026-10-25T01:00:00Z') / 1000, Date.parse('2026-10-25T02:00:00Z') / 1000] } });
describe('wind awareness', () => {
  it('keeps UTC intervals distinct over the repeated BST hour and includes the preceding hour', () => {
    const p = windPrompt(hours(35), now)!;
    expect(p.startsAt).toBe(Date.parse('2026-10-25T00:00:00Z'));
    expect(p.endsAt).toBe(Date.parse('2026-10-25T02:00:00Z'));
    expect(p.peakMph).toBeCloseTo(35); expect(p.severity).toBe(2);
  });
  it('applies thresholds and hysteresis without treating missing or old data as calm', () => {
    expect(windPrompt(hours(24.99), now)).toBeNull();
    const p = windPrompt(hours(35), now)!;
    expect(windPrompt(hours(34), now, p)?.severity).toBe(2);
    expect(windPrompt(hours(32), now, p)?.severity).toBe(1);
    expect(windPrompt(hours(22), now, p)).toBeNull();
    expect(windPrompt(null, now)).toBeNull();
    expect(windPrompt(hours(90, now - WIND_FRESH_MS - 1), now)).toBeNull();
  });
  it('breaks a snooze for escalation, a 5mph increase, another arena or period', () => {
    const p = windPrompt(hours(26), now)!; const saved = { ...p, arena: 'Main' };
    expect(windSnoozed(p, saved, 'Main')).toBe(true);
    expect(windSnoozed({ ...p, severity: 2 }, saved, 'Main')).toBe(false);
    expect(windSnoozed({ ...p, peakMph: 31 }, saved, 'Main')).toBe(false);
    expect(windSnoozed({ ...p, endsAt: p.endsAt + 1 }, saved, 'Main')).toBe(false);
    expect(windSnoozed(p, saved, 'Second')).toBe(false);
    writeWindSnooze(5, saved); expect(readWindSnooze(5)).toEqual(saved);
  });
  it('selects venue calendar dates across midnight and ignores malformed gusts', () => {
    expect(venueDay(new Date('2026-06-01T23:30:00Z'), 'Europe/London')).toBe('2026-06-02');
    expect(venueDay(new Date('2026-10-25T23:30:00Z'), 'Europe/London')).toBe('2026-10-25');
    const h = parseForecastHours({ fetchedAt: new Date(now).toISOString(), hourly: { time: [now / 1000, now / 1000 + 3600], wind_gusts_10m: [null, -1] } });
    expect(windPrompt(h, now)).toBeNull();
  });
});
