import { describe, expect, it } from 'vitest';
import { competition, heat, race, session } from '../test/factories';
import type { LiveStream } from '../types';
import { eventFacts } from './dashboard';
import { priceLabel } from './money';

const at = (h: number, m: number) => new Date(2026, 5, 1, h, m).toISOString();
const stream = (id: number, status: 0 | 1 | 2, viewerCount: number): LiveStream => ({
  id, competitionId: 1, arenaName: 'Main', angleName: 'Wide', status, caption: null, audioMuted: false, hasAudio: true, startedAt: at(9, 0), viewerCount, generation: 1,
});

describe('priceLabel', () => {
  it('shows pounds and pence, or Free', () => {
    expect(priceLabel(1800)).toBe('£18.00');
    expect(priceLabel(995)).toBe('£9.95');
    expect(priceLabel(0)).toBe('Free');
  });
});

describe('eventFacts', () => {
  const running = competition({
    startDate: '2026-06-01T00:00:00', endDate: null, location: ' Hartpury College ', sections: [
      { id: 5, competitionId: 1, format: 1, ageGroup: 'Open', displayName: 'Open' },
      { id: 6, competitionId: 1, format: 1, ageGroup: 'Junior', displayName: 'Junior' },
    ],
    sessions: [session(1, { arenaName: 'Arena 2', status: 1, sectionName: 'Teams Open', scheduledStart: at(9, 0), startedAt: at(9, 8), heats: [
      heat(1, { startedAt: at(9, 8), races: [race(1, { isComplete: true })] }),
      heat(2),
      heat(3),
    ] })],
  });

  it('names the heat on now, how late the timetable runs and where', () => {
    const facts = eventFacts(running, [stream(1, 1, 150), stream(2, 1, 62), stream(3, 2, 99)]);
    expect(facts.isLive).toBe(true);
    expect(facts.line).toBe('Open Teams · Session 1, Heat 2 on now');
    expect(facts.timetable).toEqual({ text: 'Arena 2 · 8 min late', tone: 'late' });
    expect(facts.toplists).toEqual({ text: '2 age groups', tone: 'normal' });
    expect(facts.live).toEqual({ text: '212 watching', tone: 'normal' });
    expect(facts.details).toEqual({ text: 'Hartpury College', tone: 'muted' });
  });

  it('says it is on time when a heat is on and nothing is behind', () => {
    const onTime = competition({ sessions: [session(1, { status: 1, scheduledStart: at(9, 0), startedAt: at(9, 0), heats: [heat(1, { startedAt: at(9, 0) })] })] });
    expect(eventFacts(onTime, []).timetable).toEqual({ text: 'Running on time', tone: 'normal' });
  });

  it('says when the next heat is before anything has started, and when everything is done', () => {
    const before = competition({ sessions: [session(1, { scheduledStart: at(9, 0), heats: [heat(1)] })] });
    const facts = eventFacts(before, [stream(1, 1, 0)]);
    expect(facts.isLive).toBe(false);
    expect(facts.timetable.text).toMatch(/^Next at /);
    expect(facts.live).toEqual({ text: 'Stream is live', tone: 'normal' });
    const done = competition({ sessions: [session(1, { status: 2, scheduledStart: at(9, 0), heats: [heat(1, { finishedAt: at(9, 30) })] })] });
    expect(eventFacts(done, []).timetable).toEqual({ text: 'All done', tone: 'muted' });
  });

  it('copes with an event that has no timetable, age groups, venue or stream', () => {
    const bare = competition({ startDate: '2026-06-01T00:00:00', endDate: '2026-06-02T00:00:00', location: null });
    const facts = eventFacts(bare, []);
    expect(facts.timetable).toEqual({ text: 'Not published yet', tone: 'muted' });
    expect(facts.toplists).toEqual({ text: 'No age groups yet', tone: 'muted' });
    expect(facts.live).toEqual({ text: 'Chat and results', tone: 'muted' });
    expect(facts.details.text).toBe('Mon 1 – Tue 2 Jun');
    expect(facts.line).toBe('Mon 1 – Tue 2 Jun');
    expect(eventFacts({ ...bare, startDate: 'x', sessions: undefined as never, sections: [{ id: 1 } as never] }, []).toplists.text).toBe('1 age group');
    expect(eventFacts({ ...bare, startDate: 'x', location: undefined }, []).details.text).toBe('Venue and entries');
  });

  it('does not put the arena in front of a delay when the arena has no name', () => {
    const slow = competition({ sessions: [session(1, { arenaName: null, status: 1, scheduledStart: at(9, 0), startedAt: at(9, 10), heats: [heat(1, { startedAt: at(9, 10) })] })] });
    expect(eventFacts(slow, []).timetable.text).toBe('10 min late');
  });
});
