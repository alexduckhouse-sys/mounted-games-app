import { describe, expect, it } from 'vitest';
import type { Heat, Session } from '../types';
import { heat, race, session } from '../test/factories';
import { computeTimings, formatTime, roundTo5Min } from './time';

const base = Date.UTC(2026, 5, 1, 9, 0, 0);
const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
const ms = (minutes: number) => base + minutes * 60_000;
const timeOf = (d: Date | null) => d?.getTime() ?? null;

describe('roundTo5Min', () => {
  it('rounds to the nearest five minutes', () => {
    expect(roundTo5Min(new Date(ms(2)))!.getTime()).toBe(ms(0));
    expect(roundTo5Min(new Date(ms(3)))!.getTime()).toBe(ms(5));
    expect(roundTo5Min(new Date(ms(5)))!.getTime()).toBe(ms(5));
  });

  it('passes null through', () => {
    expect(roundTo5Min(null)).toBeNull();
  });
});

describe('formatTime', () => {
  it('formats hours and minutes in the viewer’s locale', () => {
    const d = new Date(2026, 5, 1, 9, 5);
    expect(formatTime(d)).toBe(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  });

  it('shows a dash when there is no time', () => {
    expect(formatTime(null)).toBe('—');
  });
});

describe('computeTimings', () => {
  it('schedules heats back to back at 30 minutes each by default', () => {
    const timings = computeTimings([session(1, { scheduledStart: at(0), heats: [heat(1), heat(2)] })]).get(1)!;
    expect(timeOf(timings.scheduled)).toBe(ms(0));
    expect(timings.heats.map((h) => timeOf(h.scheduled))).toEqual([ms(0), ms(30)]);
    expect(timings.heats.map((h) => timeOf(h.effective))).toEqual([ms(0), ms(30)]);
    expect(timeOf(timings.effectiveEnd)).toBe(ms(60));
    expect(timings.shifted).toBe(false);
    expect(timings.heats.some((h) => h.shifted)).toBe(false);
  });

  it('uses a heat’s own duration, then minutes per heat, then the default', () => {
    const own = heat(1, { durationMinutes: 20 });
    const perRace = heat(2, { races: [race(1), race(2), race(3)] });
    const perHeat = heat(3);
    const timings = computeTimings([session(1, { scheduledStart: at(0), minutesPerHeat: 7, heats: [own, perRace, perHeat] })]).get(1)!;
    expect(timings.heats.map((h) => timeOf(h.scheduled))).toEqual([ms(0), ms(20), ms(27)]);
    expect(timeOf(timings.effectiveEnd)).toBe(ms(34));
    const fallback = computeTimings([session(1, { scheduledStart: at(0), heats: [heat(1), heat(2)] })]).get(1)!;
    expect(timeOf(fallback.heats[1].scheduled)).toBe(ms(30));
  });

  it('counts a heat with no races as one race when using minutes per heat', () => {
    const timings = computeTimings([session(1, { scheduledStart: at(0), minutesPerHeat: 7, heats: [heat(1), heat(2)] })]).get(1)!;
    expect(timeOf(timings.heats[1].scheduled)).toBe(ms(7));
  });

  it('anchors on the real start of a session and carries the delay to later sessions', () => {
    const timings = computeTimings([
      session(1, { orderIndex: 1, scheduledStart: at(0), startedAt: at(10), heats: [heat(1)] }),
      session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] }),
    ]);
    expect(timings.get(1)!.shifted).toBe(true);
    expect(timeOf(timings.get(2)!.scheduled)).toBe(ms(60));
    expect(timeOf(timings.get(2)!.effective)).toBe(ms(70));
    expect(timings.get(2)!.shifted).toBe(true);
    expect(timings.get(2)!.heats[0]).toMatchObject({ shifted: true });
  });

  it('does not flag a drift under five minutes', () => {
    const timings = computeTimings([session(1, { scheduledStart: at(0), startedAt: at(4), heats: [heat(1)] })]).get(1)!;
    expect(timings.shifted).toBe(false);
    expect(timings.heats[0].shifted).toBe(false);
  });

  it('flags a drift of exactly five minutes, early or late', () => {
    expect(computeTimings([session(1, { scheduledStart: at(0), startedAt: at(5) })]).get(1)!.shifted).toBe(true);
    expect(computeTimings([session(1, { scheduledStart: at(0), startedAt: at(-5) })]).get(1)!.shifted).toBe(true);
  });

  it('does not let an early session start before the previous one has ended', () => {
    const timings = computeTimings([
      session(1, { orderIndex: 1, scheduledStart: at(0), startedAt: at(-10), heats: [heat(1, { durationMinutes: 60 })] }),
      session(2, { orderIndex: 2, scheduledStart: at(30), heats: [heat(2)] }),
      session(3, { orderIndex: 3, scheduledStart: at(90), heats: [heat(3)] }),
    ]);
    // Session 1 really ends at 50; session 2 is held back from 20 to 50, and the 20 minute slip carries on.
    expect(timeOf(timings.get(2)!.effective)).toBe(ms(50));
    expect(timeOf(timings.get(3)!.effective)).toBe(ms(110));
  });

  it('lets an early session start early when the earlier ones are already done', () => {
    const timings = computeTimings([
      session(1, { orderIndex: 1, scheduledStart: at(0), startedAt: at(-10), heats: [heat(1)] }),
      session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] }),
    ]);
    expect(timeOf(timings.get(2)!.effective)).toBe(ms(50));
  });

  it('puts a session with no scheduled time straight after the previous one', () => {
    const timings = computeTimings([
      session(1, { orderIndex: 1, scheduledStart: at(0), heats: [heat(1)] }),
      session(2, { orderIndex: 2, heats: [heat(2), heat(3)] }),
    ]);
    const second = timings.get(2)!;
    expect(second.scheduled).toBeNull();
    expect(timeOf(second.effective)).toBe(ms(30));
    expect(second.heats.map((h) => timeOf(h.effective))).toEqual([ms(30), ms(60)]);
    expect(second.heats.map((h) => h.scheduled)).toEqual([null, null]);
    expect(second.shifted).toBe(false);
  });

  it('has no times at all for an unscheduled first session', () => {
    const timings = computeTimings([session(1, { heats: [heat(1)] })]).get(1)!;
    expect(timings).toMatchObject({ scheduled: null, effective: null, effectiveEnd: null, shifted: false });
    expect(timings.heats[0]).toMatchObject({ scheduled: null, effective: null, shifted: false });
  });

  it('uses the real start of a session that has no scheduled time without shifting later ones', () => {
    const timings = computeTimings([
      session(1, { orderIndex: 1, startedAt: at(15), heats: [heat(1)] }),
      session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] }),
    ]);
    expect(timeOf(timings.get(1)!.effective)).toBe(ms(15));
    expect(timeOf(timings.get(2)!.effective)).toBe(ms(60));
  });

  it('pins a heat with its own scheduled time and continues from there', () => {
    const timings = computeTimings([session(1, {
      scheduledStart: at(0),
      heats: [heat(1), heat(2, { scheduledStart: at(45) }), heat(3)],
    })]).get(1)!;
    expect(timings.heats.map((h) => timeOf(h.scheduled))).toEqual([ms(0), ms(45), ms(75)]);
    expect(timings.heats.map((h) => timeOf(h.effective))).toEqual([ms(0), ms(45), ms(75)]);
  });

  it('uses a heat’s real start and flags it once it is five minutes out', () => {
    const timings = computeTimings([session(1, {
      scheduledStart: at(0),
      heats: [heat(1, { startedAt: at(8) }), heat(2, { startedAt: at(33) })],
    })]).get(1)!;
    expect(timings.heats.map((h) => timeOf(h.effective))).toEqual([ms(8), ms(33)]);
    expect(timings.heats.map((h) => h.shifted)).toEqual([true, false]);
  });

  it('orders sessions and heats by their order index, not input order', () => {
    const timings = computeTimings([
      session(2, { orderIndex: 2, scheduledStart: at(30), heats: [heat(5, { orderIndex: 2 }), heat(4, { orderIndex: 1 })] }),
      session(1, { orderIndex: 1, scheduledStart: at(0), heats: [heat(1)] }),
    ]);
    expect([...timings.keys()]).toEqual([1, 2]);
    expect(timings.get(2)!.heats.map((h) => h.heatId)).toEqual([4, 5]);
  });

  describe('with more than one arena', () => {
    it('keeps a delay in one arena out of the other', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, arenaName: 'Arena 1', scheduledStart: at(0), startedAt: at(20), heats: [heat(1)] }),
        session(2, { orderIndex: 2, arenaName: 'Arena 2', scheduledStart: at(0), heats: [heat(2)] }),
        session(3, { orderIndex: 3, arenaName: 'Arena 1', scheduledStart: at(60), heats: [heat(3)] }),
        session(4, { orderIndex: 4, arenaName: 'Arena 2', scheduledStart: at(60), heats: [heat(4)] }),
      ]);
      expect(timeOf(timings.get(3)!.effective)).toBe(ms(80));
      expect(timings.get(3)!.shifted).toBe(true);
      expect(timeOf(timings.get(2)!.effective)).toBe(ms(0));
      expect(timeOf(timings.get(4)!.effective)).toBe(ms(60));
      expect(timings.get(4)!.shifted).toBe(false);
      expect(timings.get(4)!.heats[0].shifted).toBe(false);
    });

    it('lets each arena run early on its own', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, arenaName: 'Arena 1', scheduledStart: at(0), startedAt: at(-10), heats: [heat(1)] }),
        session(2, { orderIndex: 2, arenaName: 'Arena 2', scheduledStart: at(0), startedAt: at(15), heats: [heat(2)] }),
        session(3, { orderIndex: 3, arenaName: 'Arena 1', scheduledStart: at(60), heats: [heat(3)] }),
        session(4, { orderIndex: 4, arenaName: 'Arena 2', scheduledStart: at(60), heats: [heat(4)] }),
      ]);
      expect(timeOf(timings.get(3)!.effective)).toBe(ms(50));
      expect(timeOf(timings.get(4)!.effective)).toBe(ms(75));
    });

    it('holds an early session back only until the previous one in its own arena has ended', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, arenaName: 'Arena 1', scheduledStart: at(0), startedAt: at(-10), heats: [heat(1, { durationMinutes: 60 })] }),
        session(2, { orderIndex: 2, arenaName: 'Arena 2', scheduledStart: at(0), heats: [heat(2, { durationMinutes: 60 })] }),
        session(3, { orderIndex: 3, arenaName: 'Arena 1', scheduledStart: at(30), heats: [heat(3)] }),
        session(4, { orderIndex: 4, arenaName: 'Arena 2', scheduledStart: at(60), heats: [heat(4)] }),
      ]);
      expect(timeOf(timings.get(3)!.effective)).toBe(ms(50));
      expect(timeOf(timings.get(4)!.effective)).toBe(ms(60));
    });

    it('treats arena names with stray spacing as the same arena', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, arenaName: 'Arena 1', scheduledStart: at(0), startedAt: at(10), heats: [heat(1)] }),
        session(2, { orderIndex: 2, arenaName: ' Arena 1 ', scheduledStart: at(60), heats: [heat(2)] }),
      ]);
      expect(timeOf(timings.get(2)!.effective)).toBe(ms(70));
    });

    it('moves a whole-event break by the biggest arena delay, without holding other arenas back', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, arenaName: 'Arena 1', scheduledStart: at(0), startedAt: at(20), heats: [heat(1)] }),
        session(2, { orderIndex: 2, arenaName: 'Arena 2', scheduledStart: at(0), startedAt: at(10), heats: [heat(2)] }),
        session(3, { orderIndex: 3, kind: 1, isBreak: true, durationMinutes: 30, scheduledStart: at(60) }),
        session(4, { orderIndex: 4, arenaName: 'Arena 2', scheduledStart: at(90), heats: [heat(4)] }),
        session(5, { orderIndex: 5, arenaName: 'Arena 1', scheduledStart: at(90), heats: [heat(5)] }),
      ]);
      expect(timeOf(timings.get(3)!.effective)).toBe(ms(80));
      expect(timeOf(timings.get(3)!.effectiveEnd)).toBe(ms(110));
      expect(timings.get(3)!.shifted).toBe(true);
      expect(timeOf(timings.get(4)!.effective)).toBe(ms(100));
      expect(timeOf(timings.get(5)!.effective)).toBe(ms(110));
    });

    it('keeps a whole-event break on schedule when every arena is early or on time', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, arenaName: 'Arena 1', scheduledStart: at(0), startedAt: at(-10), heats: [heat(1)] }),
        session(2, { orderIndex: 2, arenaName: 'Arena 2', scheduledStart: at(0), heats: [heat(2)] }),
        session(3, { orderIndex: 3, kind: 2, durationMinutes: 15, scheduledStart: at(60) }),
      ]);
      expect(timeOf(timings.get(3)!.effective)).toBe(ms(60));
      expect(timings.get(3)!.shifted).toBe(false);
    });

    it('anchors a started whole-event item on its real start without moving the arenas', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, arenaName: 'Arena 1', scheduledStart: at(0), heats: [heat(1, { durationMinutes: 90 })] }),
        session(2, { orderIndex: 2, arenaName: 'Arena 2', scheduledStart: at(0), heats: [heat(2, { durationMinutes: 30 })] }),
        session(3, { orderIndex: 3, kind: 1, isBreak: true, durationMinutes: 20, startedAt: at(100), scheduledStart: at(60) }),
        session(4, { orderIndex: 4, arenaName: 'Arena 2', scheduledStart: at(120), heats: [heat(4)] }),
      ]);
      expect(timeOf(timings.get(3)!.effective)).toBe(ms(100));
      expect(timeOf(timings.get(4)!.effective)).toBe(ms(120));
    });

    it('places an unscheduled whole-event item after the latest arena session', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, arenaName: 'Arena 1', scheduledStart: at(0), heats: [heat(1, { durationMinutes: 45 })] }),
        session(2, { orderIndex: 2, arenaName: 'Arena 2', scheduledStart: at(0), heats: [heat(2, { durationMinutes: 20 })] }),
        session(3, { orderIndex: 3, kind: 2, durationMinutes: 10 }),
      ]);
      expect(timeOf(timings.get(3)!.effective)).toBe(ms(45));
    });
  });

  describe('pinned heats and heat drift', () => {
    it('applies the session delay to a pinned heat and the heats after it', () => {
      const timings = computeTimings([session(1, {
        orderIndex: 1, scheduledStart: at(0), startedAt: at(10),
        heats: [heat(1), heat(2, { scheduledStart: at(30) }), heat(3)],
      })]).get(1)!;
      expect(timings.heats.map((h) => timeOf(h.effective))).toEqual([ms(10), ms(40), ms(70)]);
      expect(timeOf(timings.effectiveEnd)).toBe(ms(100));
    });

    it('does not start a pinned heat before the one ahead of it has finished', () => {
      const timings = computeTimings([session(1, {
        orderIndex: 1, scheduledStart: at(0),
        heats: [heat(1, { durationMinutes: 40 }), heat(2, { scheduledStart: at(30) })],
      })]).get(1)!;
      expect(timeOf(timings.heats[1].effective)).toBe(ms(40));
    });

    it('moves later heats and the session end when a heat starts late', () => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, scheduledStart: at(0), heats: [heat(1), heat(2, { startedAt: at(45) })] }),
        session(2, { orderIndex: 2, scheduledStart: at(60) }),
      ]);
      expect(timeOf(timings.get(1)!.effectiveEnd)).toBe(ms(75));
      expect(timeOf(timings.get(2)!.effective)).toBe(ms(75));
    });
  });

  describe('session length for the next session', () => {
    const next = (first: Partial<Session>) => {
      const timings = computeTimings([
        session(1, { orderIndex: 1, scheduledStart: at(0), ...first }),
        session(2, { orderIndex: 2, heats: [] }),
      ]);
      return timeOf(timings.get(2)!.effective);
    };

    it.each([1, 2, 3] as const)('uses the duration of a break-like session of kind %i', (kind) => {
      expect(next({ kind, heats: [heat(1)], durationMinutes: 45 })).toBe(ms(45));
    });

    it('treats a break with no duration as instant', () => {
      expect(next({ kind: 1, durationMinutes: null })).toBe(ms(0));
    });

    it('uses the duration of a race session with no heats yet, or nothing', () => {
      expect(next({ heats: [], durationMinutes: 20 })).toBe(ms(20));
      expect(next({ heats: [], durationMinutes: null })).toBe(ms(0));
    });

    it('treats missing heats as none', () => {
      expect(next({ heats: undefined as unknown as Heat[], durationMinutes: 10 })).toBe(ms(10));
      const timings = computeTimings([{ ...session(1, { scheduledStart: at(0) }), heats: undefined } as unknown as Session]);
      expect(timings.get(1)!.heats).toEqual([]);
    });
  });

  describe('first race and halfway race auto-delay', () => {
    it('adds time taken minus 2 minutes when the first race goes in more than 5 minutes late', () => {
      const timings = computeTimings([
        session(1, {
          orderIndex: 1,
          scheduledStart: at(0),
          startedAt: at(10),
          heats: [heat(1, { races: [race(2, { orderIndex: 2 }), race(1, { orderIndex: 1, finishedAt: at(10) })] }), heat(2)],
        }),
        session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(3)] }),
      ]);
      // 10m taken minus 2m race allowance = 8m delay cascaded to later heats and sessions.
      expect(timeOf(timings.get(1)!.effective)).toBe(ms(8));
      expect(timeOf(timings.get(1)!.heats[0].effective)).toBe(ms(8));
      expect(timeOf(timings.get(1)!.heats[1].effective)).toBe(ms(38));
      expect(timeOf(timings.get(2)!.effective)).toBe(ms(68));
      expect(timings.get(2)!.shifted).toBe(true);
    });

    it('cascades first-race delay even when session startedAt was recorded on time or on a second heat', () => {
      const timings = computeTimings([
        session(1, {
          orderIndex: 1,
          scheduledStart: at(0),
          startedAt: at(0),
          heats: [
            heat(1, { races: [race(1, { startedAt: at(4) })] }),
            heat(2, { startedAt: at(40), races: [race(2, { startedAt: at(40) })] }),
          ],
        }),
        session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(3)] }),
      ]);
      // Heat 1 race 1 was only 4m after start (<= 5m, ignored).
      // Heat 2 was scheduled at 30m; race 2 started at 40m (10m taken - 2m = 8m delay).
      expect(timeOf(timings.get(1)!.heats[1].effective)).toBe(ms(38));
      expect(timeOf(timings.get(2)!.effective)).toBe(ms(68));

      const unstartedSession = computeTimings([
        session(1, {
          orderIndex: 1,
          scheduledStart: at(0),
          heats: [heat(1, { races: [race(1, { finishedAt: at(9) })] })],
        }),
        session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] }),
      ]);
      expect(timeOf(unstartedSession.get(2)!.effective)).toBe(ms(67));
    });

    it('adds time taken minus 2 minutes when the halfway race goes in more than 5 minutes late', () => {
      const timings = computeTimings([
        session(1, {
          orderIndex: 1,
          scheduledStart: at(0),
          heats: [
            heat(1, {
              durationMinutes: 20,
              races: [
                race(1, { orderIndex: 1, finishedAt: at(2) }),
                race(2, { orderIndex: 2, finishedAt: at(14) }),
                race(3, { orderIndex: 3, startedAt: at(15) }),
                race(4, { orderIndex: 4 }),
              ],
            }),
          ],
        }),
        session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] }),
      ]);
      // 4 races over 20m -> race 2 (index 1) is expected at 5m; finishing at 14m is 9m late -> 9 - 2 = 7m delay.
      expect(timeOf(timings.get(2)!.effective)).toBe(ms(67));
      expect(timings.get(2)!.shifted).toBe(true);
    });

    it('ignores a halfway race that is within 5 minutes of its expected time', () => {
      const timings = computeTimings([
        session(1, {
          orderIndex: 1,
          scheduledStart: at(0),
          heats: [
            heat(1, {
              durationMinutes: 20,
              races: [
                race(1, { orderIndex: 1 }),
                race(2, { orderIndex: 2, startedAt: at(9) }),
                race(3, { orderIndex: 3 }),
                race(4, { orderIndex: 4 }),
              ],
            }),
          ],
        }),
        session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] }),
      ]);
      expect(timeOf(timings.get(2)!.effective)).toBe(ms(60));
    });
  });
});


describe('manual shifts mirror calendar timing', () => {
  it('replaces inherited delay with the manual shift and keeps other arenas independent', () => {
    const sessions = [
      session(1, { arenaName: 'Arena A', scheduledStart: at(0), startedAt: at(10), heats: [heat(1)] }),
      session(2, { arenaName: 'Arena A', scheduledStart: at(75), notes: '[shift:+15]', heats: [heat(2), heat(3, { scheduledStart: at(135) })] }),
      session(3, { arenaName: 'Arena B', scheduledStart: at(60), heats: [heat(4)] }),
    ];
    const timings = computeTimings(sessions);
    expect(timeOf(timings.get(2)!.heats[0].effective)).toBe(ms(75));
    expect(timeOf(timings.get(2)!.heats[1].effective)).toBe(ms(135));
    expect(timeOf(timings.get(3)!.heats[0].effective)).toBe(ms(60));
  });

  it('does not let a negative manual shift overlap the previous heat', () => {
    const timings = computeTimings([
      session(1, { scheduledStart: at(0), heats: [heat(1, { durationMinutes: 60 })] }),
      session(2, { scheduledStart: at(45), notes: '[shift:-15]', heats: [heat(2)] }),
    ]);
    expect(timeOf(timings.get(2)!.heats[0].effective)).toBe(ms(60));
  });
});


describe('race checkpoint boundaries and parity', () => {
  it.each([0, 1, 2, 3])('does not double count the first race as halfway for %i races', count => {
    const races = Array.from({ length: count }, (_, i) => race(i + 1, { orderIndex: i + 1, finishedAt: i === 0 ? at(10) : null }));
    const sessions = [session(1, { orderIndex: 1, scheduledStart: at(0), startedAt: at(10), heats: [heat(1, { races })] }),
      session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] })];
    expect(timeOf(computeTimings(sessions).get(2)!.effective)).toBe(ms(count === 0 ? 70 : 68));
  });

  it.each([4, 5, 6])('uses completed race floor(N/2) as the checkpoint for %i races without compounding', count => {
    const half = Math.floor(count / 2) - 1;
    const races = Array.from({ length: count }, (_, i) => race(i + 1, { orderIndex: i + 1,
      finishedAt: i === 0 ? at(10) : i === half ? at((half / count) * 30 + 10) : null }));
    const sessions = [session(1, { orderIndex: 1, scheduledStart: at(0), startedAt: at(10), heats: [heat(1, { durationMinutes: 30, races })] }),
      session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] })];
    expect(timeOf(computeTimings(sessions).get(2)!.effective)).toBe(ms(68));
    expect(timeOf(computeTimings(sessions).get(2)!.effective)).toBe(ms(68));
  });

  it('does not add first-race delay at exactly five minutes', () => {
    const timings = computeTimings([session(1, { scheduledStart: at(0), heats: [heat(1, { races: [race(1, { finishedAt: at(5) })] })] }),
      session(2, { orderIndex: 2, scheduledStart: at(60), heats: [heat(2)] })]);
    expect(timeOf(timings.get(2)!.effective)).toBe(ms(60));
  });
});
