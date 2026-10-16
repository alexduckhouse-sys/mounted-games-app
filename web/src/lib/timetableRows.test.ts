import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { heat, race, session } from '../test/factories';
import { computeTimings, type SessionTiming } from './time';
import {
  groupRowsBySession, hiddenFinishedKeys, sessionOrdinals, sessionTitle, statusLabel, timetableRows, timetableStatus,
  type TimetableRow, type TimetableStatus,
} from './timetableRows';

const scheduled = new Date('2026-06-01T09:00:00Z');
const delayed = new Date('2026-06-01T09:12:00Z');
const done = race(1, { isComplete: true });

describe('timetableStatus', () => {
  it('lets finished and live win over delay, and reports the delay anyway', () => {
    expect(timetableStatus(true, true, scheduled, delayed)).toEqual({ status: 'finished', delayMinutes: 12 });
    expect(timetableStatus(false, true, scheduled, delayed).status).toBe('live');
  });

  it('is late when running behind and on time otherwise', () => {
    expect(timetableStatus(false, false, scheduled, delayed)).toEqual({ status: 'late', delayMinutes: 12 });
    expect(timetableStatus(false, false, delayed, scheduled)).toEqual({ status: 'on-time', delayMinutes: 0 });
    expect(timetableStatus(false, false, scheduled, scheduled).status).toBe('on-time');
  });

  it('is on time when either time is unknown', () => {
    expect(timetableStatus(false, false, null, null).status).toBe('on-time');
    expect(timetableStatus(false, false, scheduled, null).delayMinutes).toBe(0);
    expect(timetableStatus(false, false, null, delayed).delayMinutes).toBe(0);
  });
});

describe('statusLabel', () => {
  it.each<[TimetableStatus, number, string]>([
    ['live', 0, 'On now'],
    ['late', 8, '+8 min'],
    ['on-time', 0, 'On time'],
    ['finished', 12, 'Finished'],
  ])('says %s (%i) as %j', (status, delay, label) => {
    expect(statusLabel(status, delay)).toBe(label);
  });
});

describe('timetableRows', () => {
  it('marks only the first unfinished heat of a running session as live', () => {
    const rows = timetableRows([session(1, { status: 1, heats: [heat(1, { races: [done] }), heat(2), heat(3)] })], new Map(), false);
    expect(rows.map((row) => row.status)).toEqual(['finished', 'live', 'on-time']);
  });

  it('treats a heat with a finish time as finished', () => {
    const rows = timetableRows([session(1, { status: 1, heats: [heat(1, { finishedAt: 'x' }), heat(2)] })], new Map(), false);
    expect(rows.map((row) => row.status)).toEqual(['finished', 'live']);
  });

  it('finishes every row of a finished session even when heat data is incomplete', () => {
    const rows = timetableRows([session(1, { status: 2, heats: [heat(1), heat(2)] })], new Map(), false);
    expect(rows.every((row) => row.status === 'finished')).toBe(true);
  });

  it('has no live heat when the session is not running', () => {
    const rows = timetableRows([session(1, { status: 0, heats: [heat(1)] })], new Map(), false);
    expect(rows[0].status).toBe('on-time');
  });

  it('hides qualifier heats unless asked, keeping each remaining heat’s own time and finals group', () => {
    const sessions = [session(1, { heats: [heat(1, { raceRoundStage: 1 }), heat(2, { raceRoundStage: 2 })] })];
    const timings = new Map<number, SessionTiming>([[1, {
      sessionId: 1, scheduled, effective: scheduled, effectiveEnd: null, shifted: false,
      heats: [{ heatId: 1, scheduled, effective: scheduled, shifted: false }, { heatId: 2, scheduled, effective: delayed, shifted: true }],
    }]]);
    const rows = timetableRows(sessions, timings, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ effective: delayed, group: 'Finals', status: 'late', delayMinutes: 12 });
    expect(timetableRows(sessions, timings, true)).toHaveLength(2);
  });

  it('groups a heat as finals by its label or its session name too', () => {
    const rows = timetableRows([
      session(1, { orderIndex: 1, heats: [heat(1, { label: 'Grand Final' })] }),
      session(2, { orderIndex: 2, name: 'Seniors Finals', heats: [heat(2)] }),
      session(3, { orderIndex: 3, name: 'Seniors', heats: [heat(3, { label: 'Heat 1' })] }),
    ], new Map(), true);
    expect(rows.map((row) => row.group)).toEqual(['Finals', 'Finals', 'Heats']);
  });

  it('keeps breaks and sessions still waiting for heats as one row each', () => {
    const rows = timetableRows([
      session(1, { kind: 1, name: 'Lunch', heats: [heat(1)] }),
      session(2, { orderIndex: 2 }),
    ], new Map(), false);
    expect(rows.map((row) => [row.key, row.heat])).toEqual([['session-1', null], ['session-2', null]]);
  });

  it('treats a legacy break flag as a break and marks a running break live', () => {
    const legacy = { ...session(1, { isBreak: true, status: 1, heats: [heat(1)] }), kind: undefined } as unknown as Session;
    const rows = timetableRows([legacy], new Map(), false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'session-1', heat: null, status: 'live' });
  });

  it('sorts rows by effective time, then session order, then heat order, with undated rows last', () => {
    const rows = timetableRows([
      session(1, { orderIndex: 1, heats: [heat(1)] }),
      session(2, { orderIndex: 2, scheduledStart: scheduled.toISOString(), heats: [heat(2)] }),
      session(3, { orderIndex: 3, scheduledStart: scheduled.toISOString(), heats: [heat(4, { orderIndex: 2 }), heat(3, { orderIndex: 1 })] }),
    ], computeTimings([
      session(1, { orderIndex: 1, heats: [heat(1)] }),
      session(2, { orderIndex: 2, scheduledStart: scheduled.toISOString(), heats: [heat(2)] }),
      session(3, { orderIndex: 3, scheduledStart: scheduled.toISOString(), heats: [heat(4, { orderIndex: 2 }), heat(3, { orderIndex: 1 })] }),
    ]), true);
    expect(rows.map((row) => row.key)).toEqual(['heat-2', 'heat-3', 'heat-4', 'heat-1']);
  });

  it('sorts two undated rows by session order', () => {
    const rows = timetableRows([session(2, { orderIndex: 2 }), session(1, { orderIndex: 1 })], new Map(), true);
    expect(rows.map((row) => row.key)).toEqual(['session-1', 'session-2']);
  });
});

describe('sessionOrdinals', () => {
  it('numbers race sessions within each age group in running order, skipping breaks', () => {
    const ordinals = sessionOrdinals([
      session(4, { orderIndex: 4, competitionSectionId: 10 }),
      session(1, { orderIndex: 1, competitionSectionId: 10 }),
      session(2, { orderIndex: 2, competitionSectionId: 20 }),
      session(3, { orderIndex: 3, kind: 1 }),
    ]);
    expect([1, 2, 3, 4].map((id) => ordinals.get(id))).toEqual([1, 1, undefined, 2]);
  });

  it('falls back to the section or session name when there is no section id', () => {
    const ordinals = sessionOrdinals([
      session(1, { orderIndex: 1, competitionSectionId: null, sectionName: 'Open' }),
      session(2, { orderIndex: 2, competitionSectionId: null, sectionName: 'Open' }),
      session(3, { orderIndex: 3, competitionSectionId: null, sectionName: null, name: 'Mystery' }),
      session(4, { orderIndex: 4, competitionSectionId: null, sectionName: null, name: 'Mystery' }),
    ]);
    expect([1, 2, 3, 4].map((id) => ordinals.get(id))).toEqual([1, 2, 1, 2]);
  });

  it('treats a legacy break flag as not a race', () => {
    const legacy = { ...session(1, { isBreak: true }), kind: undefined } as unknown as Session;
    expect(sessionOrdinals([legacy]).size).toBe(0);
  });
});

describe('groupRowsBySession', () => {
  it('splits time-ordered rows into runs of the same session', () => {
    const sessions = [
      session(1, { orderIndex: 1, heats: [heat(1), heat(2)] }),
      session(2, { orderIndex: 2, heats: [heat(3)] }),
      session(3, { orderIndex: 3, kind: 1, name: 'Lunch' }),
      session(4, { orderIndex: 4, heats: [heat(4)] }),
    ];
    const groups = groupRowsBySession(timetableRows(sessions, new Map(), false));
    expect(groups.map((group) => [group.session.id, group.race, group.rows.length])).toEqual([[1, true, 2], [2, true, 1], [3, false, 1], [4, true, 1]]);
  });

  it('starts a new group when a session comes back later, with a distinct key', () => {
    const rows = timetableRows([
      session(1, { orderIndex: 1, heats: [heat(1), heat(2)] }),
      session(2, { orderIndex: 2, heats: [heat(3)] }),
    ], new Map(), false);
    const interleaved = [rows[0], rows[2], rows[1]];
    const groups = groupRowsBySession(interleaved);
    expect(groups.map((group) => group.session.id)).toEqual([1, 2, 1]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(3);
  });

  it('returns nothing for no rows', () => {
    expect(groupRowsBySession([])).toEqual([]);
  });
});

describe('hiddenFinishedKeys', () => {
  const row = (status: TimetableStatus, time: number | null) => ({ status, effective: time == null ? null : new Date(time) }) as TimetableRow;

  it('keeps only the most recent finished group', () => {
    const groups = [
      { key: 'a', rows: [row('finished', 1000)] },
      { key: 'b', rows: [row('finished', 2000)] },
      { key: 'c', rows: [row('finished', 3000), row('live', 3500)] },
      { key: 'd', rows: [row('on-time', 4000)] },
    ];
    expect([...hiddenFinishedKeys(groups)]).toEqual(['a']);
  });

  it('hides nothing when at most one group has finished', () => {
    expect(hiddenFinishedKeys([{ key: 'a', rows: [row('finished', 1)] }]).size).toBe(0);
    expect(hiddenFinishedKeys([]).size).toBe(0);
    expect(hiddenFinishedKeys([{ key: 'a', rows: [] }]).size).toBe(0);
  });

  it('keeps the later group when two finish at the same time, and copes with undated rows', () => {
    const groups = [{ key: 'a', rows: [row('finished', 5)] }, { key: 'b', rows: [row('finished', 5)] }, { key: 'c', rows: [row('finished', null)] }];
    expect([...hiddenFinishedKeys(groups)].sort()).toEqual(['a', 'c']);
  });
});

describe('sessionTitle', () => {
  it('combines the age group without "Teams" and its session number', () => {
    expect(sessionTitle(session(1, { sectionName: 'Teams Seniors' }), new Map([[1, 3]]))).toBe('Seniors Session 3');
  });

  it('uses the session name when there is no age group, and session 1 when unnumbered', () => {
    expect(sessionTitle(session(1, { sectionName: null, name: 'Open' }), new Map())).toBe('Open Session 1');
  });
});
