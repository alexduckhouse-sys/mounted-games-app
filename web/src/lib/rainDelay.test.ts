import { describe, expect, it } from 'vitest';
import { heat, session } from '../test/factories';
import { estimateLastRaceFinish } from './rainDelay';

const day = Date.UTC(2026, 10, 2, 0, 0, 0);
const at = (hours: number, minutes = 0) => day + (hours * 60 + minutes) * 60_000;
const iso = (hours: number, minutes = 0) => new Date(at(hours, minutes)).toISOString();

/** Two 30-minute heats from 14:00 in the Main Arena, so racing ends at 15:00 when nothing goes wrong. */
const main = (extra = {}) => session(1, { arenaName: 'Main Arena', scheduledStart: iso(14), heats: [heat(1, { durationMinutes: 30 }), heat(2, { durationMinutes: 30 })], ...extra });
/** Three 30-minute heats from 14:30 in the Second Arena: 16:00 when nothing goes wrong. */
const second = () => session(2, { arenaName: 'Second Arena', scheduledStart: iso(14, 30), heats: [heat(3, { durationMinutes: 30 }), heat(4, { durationMinutes: 30 }), heat(5, { durationMinutes: 30 })] });

describe('estimateLastRaceFinish', () => {
  it('adds the whole pause to the end of the day', () => {
    // Stopped at 14:10, restarting at 14:40: thirty minutes lost, so 15:30 instead of 15:00.
    const finish = estimateLastRaceFinish([main()], new Date(at(14, 40)), { nowMs: at(14, 10) });
    expect(finish?.getTime()).toBe(at(15, 30));
  });

  it('keeps the pause an organiser already made rather than starting it now', () => {
    const paused = main({ notes: `Keep [paused:${at(14, 0)}]` });
    const finish = estimateLastRaceFinish([paused], new Date(at(14, 40)), { nowMs: at(14, 30) });
    expect(finish?.getTime()).toBe(at(15, 40));
  });

  it('pauses only the arena asked about and carries on with the rest', () => {
    const both = estimateLastRaceFinish([main(), second()], new Date(at(14, 40)), { nowMs: at(14, 10) });
    const mainOnly = estimateLastRaceFinish([main(), second()], new Date(at(14, 40)), { arenaName: 'Main Arena', nowMs: at(14, 10) });
    expect(both?.getTime()).toBe(at(16, 30));
    expect(mainOnly?.getTime()).toBe(at(16, 0));
  });

  it('ignores finished sessions and breaks', () => {
    const finished = session(2, { arenaName: 'Main Arena', scheduledStart: iso(18), status: 2, heats: [heat(3, { durationMinutes: 30 })] });
    const lunch = session(3, { kind: 1, isBreak: true, scheduledStart: iso(19), durationMinutes: 60, arenaName: 'Main Arena' });
    const finish = estimateLastRaceFinish([main(), finished, lunch], new Date(at(14, 10)), { nowMs: at(14, 10) });
    expect(finish?.getTime()).toBe(at(15, 0));
  });

  it('says nothing for sessions with no times at all', () => {
    const untimed = session(4, { arenaName: 'Main Arena', heats: [heat(6, { durationMinutes: 30 })] });
    expect(estimateLastRaceFinish([untimed], new Date(at(14, 40)), { nowMs: at(14, 10) })).toBeNull();
  });

  it('rounds to the nearest five minutes', () => {
    const finish = estimateLastRaceFinish([main()], new Date(at(14, 13)), { nowMs: at(14, 10) });
    expect(finish?.getTime()).toBe(at(15, 5));
  });

  it('says nothing when there is nothing left to run', () => {
    expect(estimateLastRaceFinish([main({ status: 2 })], new Date(at(14, 40)), { nowMs: at(14, 10) })).toBeNull();
    expect(estimateLastRaceFinish([], new Date(at(14, 40)), { nowMs: at(14, 10) })).toBeNull();
  });

  it('does not take time off when the restart is before the pause began', () => {
    const paused = main({ notes: `[paused:${at(14, 30)}]` });
    const finish = estimateLastRaceFinish([paused], new Date(at(14, 10)), { nowMs: at(14, 10) });
    expect(finish?.getTime()).toBe(at(15, 0));
  });
});
