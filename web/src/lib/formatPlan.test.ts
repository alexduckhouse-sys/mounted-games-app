import { describe, expect, it } from 'vitest';
import { defaultEventStart, describeHeats, heatSizes, planTimetable, type PlanSession } from './formatPlan';

const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m);
const session = (id: number, extra: Partial<PlanSession> = {}): PlanSession => ({
  id, name: `Session ${id}`, arena: 'Main arena', orderIndex: id, raceCount: 4, minutesPerHeat: 10, lanes: 4, teamCount: 8, ...extra,
});

describe('heatSizes and describeHeats', () => {
  it('splits as evenly as possible without going over the lanes', () => {
    expect(heatSizes(8, 4)).toEqual([4, 4]);
    expect(heatSizes(10, 4)).toEqual([4, 3, 3]);
    expect(heatSizes(3, 6)).toEqual([3]);
    expect(heatSizes(7, 0)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(heatSizes(0, 4)).toEqual([]);
    expect(heatSizes(-1, 4)).toEqual([]);
  });

  it('puts the sizes in words', () => {
    expect(describeHeats([3, 3])).toBe('2 heats of 3');
    expect(describeHeats([4])).toBe('1 heat of 4');
    expect(describeHeats([4, 3, 3])).toBe('3 heats (4, 3, 3)');
    expect(describeHeats([])).toBe('no teams yet');
  });
});

describe('defaultEventStart', () => {
  it('starts the day at nine when no time was set, and keeps a set time', () => {
    expect(defaultEventStart(new Date(2026, 9, 31, 0, 0))).toEqual(at(9));
    expect(defaultEventStart(at(8, 30))).toEqual(at(8, 30));
  });
});

describe('planTimetable', () => {
  it('runs each arena on its own clock, in order, with a gap between sessions', () => {
    const rows = planTimetable({
      eventStart: at(9), fixed: [],
      sessions: [session(1), session(2), session(3, { arena: 'Arena 2', teamCount: 4 })],
    });
    // Session 1: 2 heats x 4 races x 10 min = 80 min.
    expect(rows[0]).toMatchObject({ id: 1, start: at(9), end: at(10, 20), minutes: 80, sizes: [4, 4] });
    expect(rows[1].start).toEqual(at(10, 30));
    expect(rows[2]).toMatchObject({ id: 3, start: at(9), minutes: 40 });
  });

  it('follows the order index, not the order given', () => {
    const rows = planTimetable({ eventStart: at(9), fixed: [], sessions: [session(2, { orderIndex: 1 }), session(1, { orderIndex: 2 })] });
    expect(rows.map((row) => row.id)).toEqual([2, 1]);
    expect(rows[1].start).toEqual(at(10, 30));
  });

  it('waits for a break, whether it is for every arena or just this one', () => {
    const lunch = { start: at(9, 30), end: at(10, 0), arena: '' };
    const rows = planTimetable({ eventStart: at(9), fixed: [lunch], sessions: [session(1), session(2, { arena: 'Arena 2' })] });
    // 80 minutes from 09:00 would run through lunch, so session 1 waits until 10:00.
    expect(rows[0].start).toEqual(at(10, 0));
    expect(rows[1].start).toEqual(at(10, 0));
    const onlyMain = planTimetable({ eventStart: at(9), fixed: [{ ...lunch, arena: ' MAIN ARENA ' }], sessions: [session(1), session(2, { arena: 'Arena 2' })] });
    expect(onlyMain[0].start).toEqual(at(10, 0));
    expect(onlyMain[1].start).toEqual(at(9, 0));
  });

  it('moves past several breaks in a row, and lets a session that fits before a break go first', () => {
    const fixed = [{ start: at(10), end: at(10, 15), arena: '' }, { start: at(10, 15), end: at(10, 30), arena: '' }];
    const long = planTimetable({ eventStart: at(9), fixed, sessions: [session(1)] });
    expect(long[0].start).toEqual(at(10, 30));
    const short = planTimetable({ eventStart: at(9), fixed, sessions: [session(1, { raceCount: 1, minutesPerHeat: 10 })] });
    expect(short[0].start).toEqual(at(9));
  });

  it('gives a session with no teams no time, so the next one starts straight away', () => {
    const rows = planTimetable({ eventStart: at(9), fixed: [], sessions: [session(1, { teamCount: 0 }), session(2)] });
    expect(rows[0]).toMatchObject({ minutes: 0, sizes: [] });
    expect(rows[1].start).toEqual(at(9));
  });
});
