import { beforeEach, describe, expect, it, vi } from 'vitest';
import { competition, session } from '../test/factories';
import {
  clearStatus, hazardOf, hazardRuns, HOUR, isEventDay, isSnoozed, openArenas, parseForecastHours, parsePauseReason,
  pauseState, racingToCome, readSnoozes, snoozeUntil, suggestedRestart, upcomingHazard, weatherLineState, writeSnoozes,
  type ForecastHour,
} from './weatherAlert';

const day = Date.UTC(2026, 10, 2, 0, 0, 0);
const at = (hours: number, minutes = 0) => day + (hours * 60 + minutes) * 60_000;
const hour = (h: number, extra: Partial<ForecastHour> = {}): ForecastHour => ({ startsAt: at(h), weatherCode: 3, rainMm: 0, rainChance: 10, ...extra });
const thunder = (h: number) => hour(h, { weatherCode: 95 });
const dry = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => hour(from + i));

describe('parseForecastHours', () => {
  const body = (extra = {}) => ({
    utc_offset_seconds: 3600,
    hourly: {
      time: ['2026-11-02T13:00', '2026-11-02T14:00', 'nope', 7],
      weather_code: [3, 95, 3, 3],
      precipitation: [0, 4.5, 0, 0],
      precipitation_probability: [10, 90, 0, 0],
    },
    ...extra,
  });

  it('turns venue-zone times into real instants using the offset', () => {
    const hours = parseForecastHours(body());
    expect(hours).toHaveLength(2);
    expect(hours![0].startsAt).toBe(Date.UTC(2026, 10, 2, 12, 0));
    expect(hours![1]).toEqual({ startsAt: Date.UTC(2026, 10, 2, 13, 0), weatherCode: 95, rainMm: 4.5, rainChance: 90 });
  });

  it('keeps times that carry their own zone, and reads zoneless ones as device time without an offset', () => {
    const zoned = parseForecastHours({ hourly: { time: ['2026-11-02T13:00:00+01:00'] } });
    expect(zoned![0].startsAt).toBe(Date.UTC(2026, 10, 2, 12, 0));
    const local = parseForecastHours({ hourly: { time: ['2026-11-02T13:00'] } });
    expect(local![0].startsAt).toBe(new Date('2026-11-02T13:00').getTime());
  });

  it('leaves out values that are missing instead of treating them as dry', () => {
    const hours = parseForecastHours({ hourly: { time: ['2026-11-02T13:00'], weather_code: [null], precipitation: ['x'] }, utc_offset_seconds: 0 });
    expect(hours![0]).toMatchObject({ weatherCode: null, rainMm: null, rainChance: null });
  });

  it('sorts the hours', () => {
    const hours = parseForecastHours({ utc_offset_seconds: 0, hourly: { time: ['2026-11-02T15:00', '2026-11-02T14:00'] } });
    expect(hours!.map((h) => h.startsAt)).toEqual([at(14), at(15)]);
  });

  it('gives up quietly on anything that is not a forecast', () => {
    expect(parseForecastHours(null)).toBeNull();
    expect(parseForecastHours('x')).toBeNull();
    expect(parseForecastHours({})).toBeNull();
    expect(parseForecastHours({ hourly: { time: 'x' } })).toBeNull();
    expect(parseForecastHours({ hourly: { time: [] } })).toBeNull();
    expect(parseForecastHours(body({ error: 'weather_unavailable' }))).toBeNull();
    expect(parseForecastHours(body({ fallback: { weather_code: [3] } }))).toBeNull();
  });
});

describe('hazardOf', () => {
  it.each([95, 96, 99])('calls weather code %i thunder', (weatherCode) => {
    expect(hazardOf(hour(14, { weatherCode }))).toBe('thunder');
  });

  it('does not call other storms-ish codes thunder', () => {
    expect(hazardOf(hour(14, { weatherCode: 82 }))).toBeNull();
    expect(hazardOf(hour(14, { weatherCode: null }))).toBeNull();
  });

  it('calls 4 mm an hour heavy rain whatever the chance', () => {
    expect(hazardOf(hour(14, { rainMm: 4, rainChance: 0 }))).toBe('rain');
    expect(hazardOf(hour(14, { rainMm: 3.9, rainChance: 30 }))).toBeNull();
  });

  it('calls 2.5 mm heavy rain when the chance is high', () => {
    expect(hazardOf(hour(14, { rainMm: 2.5, rainChance: 70 }))).toBe('rain');
    expect(hazardOf(hour(14, { rainMm: 2.5, rainChance: 69 }))).toBeNull();
    expect(hazardOf(hour(14, { rainMm: 2.4, rainChance: 100 }))).toBeNull();
    expect(hazardOf(hour(14, { rainMm: 3, rainChance: null }))).toBeNull();
  });

  it('puts thunder before rain in the same hour, and ignores a missing amount', () => {
    expect(hazardOf(hour(14, { weatherCode: 95, rainMm: 9 }))).toBe('thunder');
    expect(hazardOf(hour(14, { rainMm: null }))).toBeNull();
  });
});

describe('hazardRuns', () => {
  it('joins hazard hours into one storm, across a single clear hour', () => {
    const hours = [...dry(12, 14), thunder(14), thunder(15), hour(16), thunder(17), ...dry(18, 22)];
    expect(hazardRuns(hours, 'thunder')).toEqual([{ kind: 'thunder', startsAt: at(14), endsAt: at(18) }]);
  });

  it('keeps storms apart when more than an hour is clear between them', () => {
    const hours = [thunder(13), hour(14), hour(15), thunder(16)];
    expect(hazardRuns(hours, 'thunder')).toEqual([
      { kind: 'thunder', startsAt: at(13), endsAt: at(14) },
      { kind: 'thunder', startsAt: at(16), endsAt: at(17) },
    ]);
  });

  it('is empty when the kind never happens', () => {
    expect(hazardRuns(dry(10, 20), 'rain')).toEqual([]);
  });
});

describe('upcomingHazard', () => {
  const hours = [...dry(10, 15), thunder(15), thunder(16), ...dry(17, 20)];

  it('waits until the storm is within two hours', () => {
    expect(upcomingHazard(hours, at(12, 59))).toBeNull();
    expect(upcomingHazard(hours, at(13, 0))).toEqual({ kind: 'thunder', startsAt: at(15), endsAt: at(17) });
  });

  it('keeps showing a storm that is under way, and stops when it has ended', () => {
    expect(upcomingHazard(hours, at(16, 30))?.endsAt).toBe(at(17));
    expect(upcomingHazard(hours, at(17, 0))).toBeNull();
  });

  it('prefers thunder to heavy rain, and finds rain on its own', () => {
    const both = [hour(14, { rainMm: 6 }), thunder(15)];
    expect(upcomingHazard(both, at(13, 30))?.kind).toBe('thunder');
    expect(upcomingHazard([hour(14, { rainMm: 6 })], at(13, 30))).toEqual({ kind: 'rain', startsAt: at(14), endsAt: at(15) });
  });
});

describe('clearStatus', () => {
  const hours = [...dry(10, 14), thunder(14), thunder(15), ...dry(16, 22)];

  it('is not clear while thunder is under way or due soon', () => {
    expect(clearStatus(hours, 'thunder', at(13, 50), at(14, 30)).clear).toBe(false);
    expect(clearStatus(hours, 'thunder', at(13, 50), at(12, 30)).clear).toBe(false);
  });

  it('waits 30 minutes after the last thunder, then says since when', () => {
    expect(clearStatus(hours, 'thunder', at(14, 5), at(16, 29))).toEqual({ clear: false, since: at(16) });
    expect(clearStatus(hours, 'thunder', at(14, 5), at(16, 30))).toEqual({ clear: true, since: at(16) });
  });

  it('waits 30 minutes after the pause too, so a forecast that drops the storm cannot clear it at once', () => {
    const nothing = dry(10, 22);
    expect(clearStatus(nothing, 'thunder', at(14, 10), at(14, 20))).toEqual({ clear: false, since: at(14, 10) });
    expect(clearStatus(nothing, 'thunder', at(14, 10), at(14, 40))).toEqual({ clear: true, since: at(14, 10) });
  });

  it('is not held up by a storm more than two hours away', () => {
    const later = [...dry(10, 14), thunder(14), ...dry(15, 19), thunder(19)];
    expect(clearStatus(later, 'thunder', at(14, 0), at(15, 45)).clear).toBe(true);
    expect(clearStatus(later, 'thunder', at(14, 0), at(17, 30)).clear).toBe(false);
  });

  it('waits a quarter of an hour for rain', () => {
    const wet = [hour(14, { rainMm: 6 }), ...dry(15, 20)];
    expect(clearStatus(wet, 'rain', at(14, 0), at(15, 10)).clear).toBe(false);
    expect(clearStatus(wet, 'rain', at(14, 0), at(15, 15)).clear).toBe(true);
  });
});

describe('suggestedRestart', () => {
  it('is 30 minutes after thunder ends, to the next 5 minutes', () => {
    expect(suggestedRestart({ kind: 'thunder', startsAt: at(14), endsAt: at(15, 2) }, at(14, 10))).toBe(at(15, 35));
  });

  it('is when the rain ends', () => {
    expect(suggestedRestart({ kind: 'rain', startsAt: at(14), endsAt: at(15) }, at(14, 10))).toBe(at(15));
  });

  it('never suggests a time in the past', () => {
    expect(suggestedRestart({ kind: 'rain', startsAt: at(14), endsAt: at(15) }, at(16, 1))).toBe(at(16, 5));
  });
});

describe('snoozes', () => {
  const run = { kind: 'thunder' as const, startsAt: at(14), endsAt: at(16) };

  it('hides the storm, a shifted version of it, and nothing else', () => {
    const snoozes = { thunder: snoozeUntil(run) };
    expect(snoozeUntil(run)).toBe(at(17));
    expect(isSnoozed(snoozes, run)).toBe(true);
    expect(isSnoozed(snoozes, { ...run, startsAt: at(16), endsAt: at(18) })).toBe(true);
    expect(isSnoozed(snoozes, { ...run, startsAt: at(17, 30), endsAt: at(19) })).toBe(false);
    expect(isSnoozed(snoozes, { ...run, kind: 'rain' })).toBe(false);
    expect(isSnoozed({}, run)).toBe(false);
  });

  describe('storage', () => {
    beforeEach(() => localStorage.clear());

    it('remembers a snooze for each event', () => {
      writeSnoozes(4, { thunder: 5, rain: 6 });
      expect(readSnoozes(4)).toEqual({ thunder: 5, rain: 6 });
      expect(readSnoozes(5)).toEqual({});
    });

    it('ignores anything odd that was stored', () => {
      localStorage.setItem('mg.weather.snooze.4', '{"thunder":"x","rain":7}');
      expect(readSnoozes(4)).toEqual({ rain: 7 });
      localStorage.setItem('mg.weather.snooze.4', 'null');
      expect(readSnoozes(4)).toEqual({});
      localStorage.setItem('mg.weather.snooze.4', '{nope');
      expect(readSnoozes(4)).toEqual({});
    });

    it('carries on when storage is blocked', () => {
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      expect(readSnoozes(4)).toEqual({});
      expect(() => writeSnoozes(4, { thunder: 1 })).not.toThrow();
      get.mockRestore();
      set.mockRestore();
    });
  });
});

describe('what the sessions say', () => {
  it('reads why a session was paused', () => {
    expect(parsePauseReason('x [paused:5] [pausefor:thunder]')).toBe('thunder');
    expect(parsePauseReason('[pausefor:rain]')).toBe('rain');
    expect(parsePauseReason('[pausefor:snow]')).toBeNull();
    expect(parsePauseReason(null)).toBeNull();
  });

  it('finds the sessions paused for weather, the oldest pause and the arenas', () => {
    const state = pauseState([
      session(1, { arenaName: 'Main Arena', notes: `[paused:${at(14, 5)}] [pausefor:thunder]` }),
      session(2, { arenaName: ' Second Arena ', notes: `[paused:${at(14, 0)}] [pausefor:rain]` }),
      session(3, { arenaName: 'Main Arena', notes: `[paused:${at(13, 0)}]` }),
      session(4, { arenaName: 'Main Arena', status: 2, notes: `[paused:${at(9, 0)}] [pausefor:thunder]` }),
    ]);
    expect(state.weather).toEqual({ kind: 'thunder', pausedAt: at(14, 0), arenas: ['Main Arena', 'Second Arena'] });
    expect(state.allPaused).toBe(true);
  });

  it('reports rain when only rain paused racing, and nothing for a pause with no reason', () => {
    expect(pauseState([session(1, { notes: `[paused:${at(14)}] [pausefor:rain]` })]).weather?.kind).toBe('rain');
    const plain = pauseState([session(1, { notes: `[paused:${at(14)}]` }), session(2)]);
    expect(plain).toEqual({ allPaused: false, weather: null });
    expect(pauseState([])).toEqual({ allPaused: false, weather: null });
  });

  it('lists the arenas that still have something to run', () => {
    expect(openArenas([session(1, { arenaName: 'A' }), session(2, { arenaName: 'A ' }), session(3, { arenaName: 'B', status: 2 }), session(4)])).toEqual(['A']);
  });

  it('knows whether racing is still to come', () => {
    expect(racingToCome([session(1, { status: 2 }), session(2, { kind: 1, isBreak: true })])).toBe(false);
    expect(racingToCome([session(1, { status: 2 }), session(2, { status: 1 })])).toBe(true);
    expect(racingToCome([session(1, { kind: undefined, isBreak: true })])).toBe(false);
    expect(racingToCome([session(1, { kind: undefined, isBreak: false })])).toBe(true);
    expect(racingToCome([])).toBe(false);
  });
});

describe('isEventDay', () => {
  const when = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

  it('is true from the start date to the end date', () => {
    const c = competition({ startDate: '2026-11-02T00:00:00Z', endDate: '2026-11-03T00:00:00Z' });
    expect(isEventDay(c, [], when(2026, 11, 2))).toBe(true);
    expect(isEventDay(c, [], when(2026, 11, 3))).toBe(true);
    expect(isEventDay(c, [], when(2026, 11, 1))).toBe(false);
    expect(isEventDay(c, [], when(2026, 11, 4))).toBe(false);
  });

  it('is one day when there is no end date', () => {
    const c = competition({ startDate: '2026-11-02', endDate: null });
    expect(isEventDay(c, [], when(2026, 11, 2))).toBe(true);
    expect(isEventDay(c, [], when(2026, 11, 3))).toBe(false);
  });

  it('counts a day with a scheduled session', () => {
    const c = competition({ startDate: '2026-11-02' });
    const s = session(1, { scheduledStart: new Date(2026, 10, 5, 9).toISOString() });
    expect(isEventDay(c, [s], when(2026, 11, 5))).toBe(true);
    expect(isEventDay(c, [session(2)], when(2026, 11, 5))).toBe(false);
  });

  it('falls back to the device calendar for a date with no day in it', () => {
    const c = competition({ startDate: new Date(2026, 10, 2, 9).toISOString().replace(/^\d{4}-\d{2}-\d{2}/, 'x') });
    expect(isEventDay(c, [], when(2026, 11, 2))).toBe(false);
  });
});

describe('weatherLineState', () => {
  const storm = [...dry(10, 15), thunder(15), thunder(16), ...dry(17, 22)];
  const pausedFor = (kind: string, ms: number) => [session(1, { notes: `[paused:${ms}] [pausefor:${kind}]` })];

  it('warns about a storm that is near', () => {
    expect(weatherLineState({ now: at(13, 30), hours: storm, sessions: [session(1)], snoozes: {} }))
      .toEqual({ phase: 'warn', run: { kind: 'thunder', startsAt: at(15), endsAt: at(17) } });
  });

  it('says nothing when it is far off, snoozed, or there is no forecast', () => {
    expect(weatherLineState({ now: at(11), hours: storm, sessions: [session(1)], snoozes: {} })).toEqual({ phase: 'none' });
    expect(weatherLineState({ now: at(13, 30), hours: storm, sessions: [session(1)], snoozes: { thunder: at(18) } })).toEqual({ phase: 'none' });
    expect(weatherLineState({ now: at(13, 30), hours: null, sessions: [session(1)], snoozes: {} })).toEqual({ phase: 'none' });
  });

  it('still warns when racing is already paused for another reason', () => {
    const plain = [session(1, { notes: `[paused:${at(13)}]` })];
    expect(weatherLineState({ now: at(13, 30), hours: storm, sessions: plain, snoozes: {} }).phase).toBe('warn');
  });

  it('shows the paused line while the storm lasts, and the clear line after the wait', () => {
    const sessions = pausedFor('thunder', at(14, 45));
    expect(weatherLineState({ now: at(16, 15), hours: storm, sessions, snoozes: {} })).toEqual({ phase: 'paused', kind: 'thunder', forecastKnown: true });
    expect(weatherLineState({ now: at(17, 30), hours: storm, sessions, snoozes: {} })).toEqual({ phase: 'clear', kind: 'thunder', since: at(17) });
  });

  it('ignores snoozes once racing is paused for weather', () => {
    const sessions = pausedFor('thunder', at(14, 45));
    expect(weatherLineState({ now: at(16, 15), hours: storm, sessions, snoozes: { thunder: at(18) } }).phase).toBe('paused');
  });

  it('goes back to the paused line if the thunder comes back', () => {
    const sessions = pausedFor('thunder', at(14, 45));
    const flipped = [...dry(10, 17), ...dry(17, 18), thunder(18), ...dry(19, 22)];
    expect(weatherLineState({ now: at(17, 40), hours: storm, sessions, snoozes: {} }).phase).toBe('clear');
    expect(weatherLineState({ now: at(17, 40), hours: flipped, sessions, snoozes: {} }).phase).toBe('paused');
  });

  it('keeps the paused line, without the promise, when the forecast is missing', () => {
    expect(weatherLineState({ now: at(16), hours: null, sessions: pausedFor('rain', at(14)), snoozes: {} }))
      .toEqual({ phase: 'paused', kind: 'rain', forecastKnown: false });
  });

  it('does not warn about the next storm while racing is paused for weather', () => {
    const sessions = pausedFor('thunder', at(14, 0));
    const hours = [...dry(10, 14), thunder(14), ...dry(15, 17), thunder(17), ...dry(18, 22)];
    // At 15:45 the second storm is within two hours, so the pause stands.
    expect(weatherLineState({ now: at(15, 45), hours, sessions, snoozes: {} }).phase).toBe('paused');
  });
});

describe('HOUR', () => {
  it('is an hour', () => expect(HOUR).toBe(3_600_000));
});
