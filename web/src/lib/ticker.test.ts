import { describe, expect, it } from 'vitest';
import type { ChatMessage, Heat, Race, Session } from '../types';
import { chat, heat as baseHeat, race as baseRace, result, session as baseSession } from '../test/factories';
import { MAX_TICKER_ITEMS, sameTickerItems, tickerClock, tickerFocusAfterChange, tickerItems, type TickerItem } from './ticker';

const now = new Date('2026-06-01T10:00:00Z');
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const clock = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const heat = (id: number, extra: Partial<Heat> = {}) => baseHeat(id, extra);
const session = (heats: Heat[], extra: Partial<Session> = {}) => baseSession(extra.id ?? 1, { name: 'Seniors', sectionName: 'Teams Seniors', heats, ...extra });
const pause = (extra: Partial<Session> = {}) => baseSession(50, {
  name: 'Lunch', sectionName: null, competitionSectionId: null, kind: 1, isBreak: true, durationMinutes: 45, orderIndex: 50, ...extra,
});
const note = (id: number, body: string, minutesAgo: number, type: ChatMessage['type'] = 2) => chat(id, { body, type, createdAt: at(-minutesAgo) });
const won = (id: number, name: string, finishedMinutesAgo: number, winner: string): Race => baseRace(id, {
  name, isComplete: true, finishedAt: at(-finishedMinutesAgo),
  results: [result(1, 1, { teamName: winner, points: 4 }), result(2, 2, { teamName: 'Other', points: 3 })],
});
const kinds = (items: TickerItem[]) => items.map((item) => item.kind);
const texts = (items: TickerItem[]) => items.map((item) => item.text);
const find = (items: TickerItem[], kind: TickerItem['kind']) => items.find((item) => item.kind === kind);
const racing = (extra: Partial<Session> = {}) => session([heat(1), heat(2)], { status: 1, scheduledStart: at(-10), startedAt: at(-10), ...extra });

describe('tickerItems: what is on now', () => {
  it('names the race using the age group and session number', () => {
    const items = tickerItems([session([heat(1, { label: 'Heat 1' })], { status: 1 })], [], now);
    expect(items[0]).toEqual({ key: 'live-heat-1', kind: 'live', text: 'Now: Seniors Session 1 · Heat 1' });
  });

  it('numbers an unlabelled heat from its position', () => {
    const items = tickerItems([session([heat(1), heat(2)], { status: 1 })], [], now);
    expect(items[0].text).toBe('Now: Seniors Session 1 · Heat 1');
  });

  it('shows a session without heats by its title alone', () => {
    const items = tickerItems([session([], { status: 1 })], [], now);
    expect(items[0].text).toBe('Now: Seniors Session 1');
  });

  it('treats the first unfinished heat as the live one', () => {
    const items = tickerItems([session([heat(1, { finishedAt: at(-20) }), heat(2), heat(3)], { status: 1 })], [], now);
    expect(find(items, 'live')!.text).toBe('Now: Seniors Session 1 · Heat 2');
  });

  it('shows at most two live races', () => {
    const sessions = [
      session([heat(1)], { id: 1, status: 1, orderIndex: 1 }),
      session([heat(2)], { id: 2, status: 1, orderIndex: 2, sectionName: 'Juniors', competitionSectionId: 6 }),
      session([heat(3)], { id: 3, status: 1, orderIndex: 3, sectionName: 'Minis', competitionSectionId: 7 }),
    ];
    expect(tickerItems(sessions, [], now).filter((item) => item.kind === 'live')).toHaveLength(2);
  });

  it('gives finals their own kind, titled by age group, when next or live', () => {
    const finals = (extra: Partial<Session>) => baseSession(3, {
      name: 'Seniors Finals', sectionName: 'Teams Seniors', orderIndex: 90, heats: [heat(9, { label: 'Final A', raceRoundStage: 2 })], ...extra,
    });
    expect(tickerItems([finals({ scheduledStart: at(25) })], [], now)[0])
      .toEqual({ key: 'next-heat-9', kind: 'finals', text: `Next ${clock(25)}: Seniors Finals · Final A` });
    expect(tickerItems([finals({ status: 1 })], [], now)[0])
      .toEqual({ key: 'live-heat-9', kind: 'finals', text: 'Now: Seniors Finals · Final A' });
  });

  it('does not repeat "finals" when the age group already says it, and falls back to the session name', () => {
    const finals = baseSession(3, {
      name: 'Grand Final', sectionName: null, heats: [heat(9, { label: 'Final', raceRoundStage: 2 })], status: 1,
    });
    expect(tickerItems([finals], [], now)[0].text).toBe('Now: Grand Final · Final');
  });
});

describe('tickerItems: timekeeping', () => {
  it('says on time while racing to schedule, then lists the next heat and its start', () => {
    const items = tickerItems([racing()], [], now);
    expect(kinds(items)).toEqual(['live', 'ontime', 'next']);
    expect(items[1].text).toBe('On time');
    expect(items[2].text).toBe(`Next ${clock(20)}: Seniors Session 1 · Heat 2`);
  });

  it('reports running behind when the session started late', () => {
    const items = tickerItems([racing({ scheduledStart: at(-60), startedAt: at(-40) })], [], now);
    expect(kinds(items)).toEqual(['live', 'late', 'next']);
    expect(items[1].text).toBe('Running 20 min behind');
  });

  it('reports running behind when nothing has started and the first heat is overdue', () => {
    const items = tickerItems([session([heat(1), heat(2)], { scheduledStart: at(-30) })], [], now);
    expect(kinds(items)).toEqual(['late', 'next']);
    expect(items[0].text).toBe('Running 30 min behind');
    expect(items[1].text).toBe(`Next ${clock(-30)}: Seniors Session 1 · Heat 1`);
  });

  it('does not count a small delay as running behind', () => {
    const items = tickerItems([racing({ scheduledStart: at(-13), startedAt: at(-10) })], [], now);
    expect(kinds(items)).toEqual(['live', 'ontime', 'next']);
  });

  it('ignores a session so overdue that it was skipped or belongs to another day', () => {
    expect(tickerItems([session([heat(1)], { scheduledStart: at(-30 * 24 * 60) })], [], now)).toEqual([]);
  });

  it('stays quiet about delay when nothing is racing or upcoming', () => {
    expect(tickerItems([session([heat(1)])], [], now)).toEqual([]);
  });

  it('says racing has finished once every heat is done', () => {
    expect(texts(tickerItems([session([heat(1)], { status: 2 })], [], now))).toEqual(['Racing finished']);
  });

  it('does not say racing has finished when only breaks remain', () => {
    expect(find(tickerItems([pause({ status: 2 })], [], now), 'info')).toBeUndefined();
  });
});

describe('tickerItems: breaks and briefings', () => {
  const lunchAfterHeats = (extra: Partial<Session> = {}) => [
    session([heat(1, { finishedAt: at(-30) }), heat(2)], { status: 1, scheduledStart: at(-60), startedAt: at(-60) }),
    pause({ scheduledStart: at(15), ...extra }),
    session([heat(3)], { id: 2, name: 'Juniors', sectionName: 'Teams Juniors', competitionSectionId: 6, orderIndex: 60, scheduledStart: at(60) }),
  ];

  it('shows a break coming up with its name and start time, keeping the next heat listed', () => {
    const items = tickerItems(lunchAfterHeats(), [], now);
    expect(kinds(items)).toEqual(['live', 'ontime', 'next', 'break']);
    expect(items[2].text).toBe(`Next ${clock(60)}: Juniors Session 1 · Heat 1`);
    expect(items[3].text).toBe(`Lunch break ${clock(15)}`);
  });

  it('leaves out a break more than half an hour away unless it is next', () => {
    const sessions = [
      session([heat(1), heat(2), heat(3)], { status: 1, scheduledStart: at(-10), startedAt: at(-10) }),
      pause({ scheduledStart: at(120) }),
    ];
    expect(find(tickerItems(sessions, [], now), 'break')).toBeUndefined();
  });

  it('says how long a break lasts while it is under way', () => {
    const sessions = [
      session([heat(1, { finishedAt: at(-30) })], { status: 1, scheduledStart: at(-60), startedAt: at(-60) }),
      pause({ scheduledStart: at(-5), durationMinutes: 45 }),
      session([heat(3)], { id: 2, name: 'Juniors', sectionName: 'Teams Juniors', competitionSectionId: 6, orderIndex: 60, scheduledStart: at(40) }),
    ];
    const items = tickerItems(sessions, [], now);
    expect(kinds(items)).toEqual(['break', 'next']);
    expect(items[0].text).toBe(`Lunch break until ${clock(40)}`);
  });

  it('says "now" for a break that has been started but has no duration', () => {
    const items = tickerItems([pause({ status: 1, durationMinutes: null, scheduledStart: at(-5) })], [], now);
    expect(items[0]).toMatchObject({ kind: 'break', text: 'Lunch break now' });
  });

  it('does not treat a break as under way while a race is live', () => {
    const sessions = [racing({ scheduledStart: at(-60), startedAt: at(-60) }), pause({ scheduledStart: at(-5) })];
    expect(find(tickerItems(sessions, [], now), 'break')?.text).not.toMatch(/until/);
  });

  it('labels a briefing as one', () => {
    const sessions = [pause({ name: 'Riders', kind: 2, isBreak: false, scheduledStart: at(10), durationMinutes: 15 })];
    expect(texts(tickerItems(sessions, [], now))).toEqual([`Riders briefing ${clock(10)}`]);
  });

  it('names unnamed breaks and briefings sensibly and keeps custom items as typed', () => {
    const when = { scheduledStart: at(10), durationMinutes: 15 };
    expect(texts(tickerItems([pause({ name: '  ', ...when })], [], now))).toEqual([`Break ${clock(10)}`]);
    expect(texts(tickerItems([pause({ name: '', kind: 2, isBreak: false, ...when })], [], now))).toEqual([`Briefing ${clock(10)}`]);
    expect(texts(tickerItems([pause({ name: '', kind: 3, isBreak: false, ...when })], [], now))).toEqual([`Break ${clock(10)}`]);
    expect(texts(tickerItems([pause({ name: 'Prizegiving', kind: 3, isBreak: false, ...when })], [], now))).toEqual([`Prizegiving ${clock(10)}`]);
    expect(texts(tickerItems([pause({ name: 'Tea break', ...when })], [], now))).toEqual([`Tea break ${clock(10)}`]);
    expect(texts(tickerItems([pause({ name: 'Weigh-in\n  time', kind: 2, isBreak: false, ...when })], [], now))).toEqual([`Weigh-in time briefing ${clock(10)}`]);
  });

  it('treats a legacy break (no kind) as a break', () => {
    const legacy = { ...pause({ scheduledStart: at(10) }), kind: undefined } as unknown as Session;
    expect(texts(tickerItems([legacy], [], now))).toEqual([`Lunch break ${clock(10)}`]);
    const legacyRace = { ...baseSession(1, { heats: [heat(1)], status: 1 }), kind: undefined, isBreak: false } as unknown as Session;
    expect(find(tickerItems([legacyRace], [], now), 'live')).toBeDefined();
  });
});

describe('tickerItems: results and announcements', () => {
  it('shows the latest race winner from the last half hour', () => {
    const heats = [heat(1, { finishedAt: at(-5), races: [won(1, 'Bending', 12, 'Ashdown'), won(2, 'Sock Race', 6, 'Pony Club A')] }), heat(2)];
    expect(find(tickerItems([session(heats, { status: 1 })], [], now), 'result')).toEqual({ key: 'result-2', kind: 'result', text: 'Pony Club A won Sock Race' });
  });

  it('keeps the earlier winner when a later race has the same finish time', () => {
    const heats = [heat(1, { races: [won(1, 'Bending', 6, 'First'), won(2, 'Sock Race', 6, 'Second')] }), heat(2)];
    expect(find(tickerItems([session(heats, { status: 1 })], [], now), 'result')!.text).toBe('First won Bending');
  });

  it('joins joint winners and falls back when the race has no name', () => {
    const joint = baseRace(4, {
      name: '  ', isComplete: true, finishedAt: at(-2),
      results: [result(1, 1, { teamName: 'A' }), result(2, 1, { teamName: 'B' }), result(3, 1, { teamName: 'Out', eliminated: true })],
    });
    expect(find(tickerItems([session([heat(1, { races: [joint] }), heat(2)], { status: 1 })], [], now), 'result')!.text).toBe('A & B won a race');
  });

  it('skips stale, unfinished, future-dated, unwon and unparseable results', () => {
    const odd = [
      won(1, 'Old', 40, 'Ashdown'),
      baseRace(2, { name: 'Open', isComplete: false, finishedAt: at(-1), results: [result(1, 1)] }),
      baseRace(3, { name: 'No finish', isComplete: true, finishedAt: null, results: [result(1, 1)] }),
      baseRace(4, { name: 'Future', isComplete: true, finishedAt: at(5), results: [result(1, 1)] }),
      baseRace(5, { name: 'Nobody', isComplete: true, finishedAt: at(-1), results: [result(1, 1, { eliminated: true }), result(2, 2)] }),
      baseRace(6, { name: 'Garbled', isComplete: true, finishedAt: 'later', results: [result(1, 1)] }),
    ];
    expect(find(tickerItems([session([heat(1, { races: odd }), heat(2)], { status: 1 })], [], now), 'result')).toBeUndefined();
  });

  it('lists only recent announcements, newest first, capped at three', () => {
    const messages = [note(1, 'old', 600), note(2, 'chat', 5, 0), note(3, 'a', 40), note(4, 'b', 30), note(5, 'c', 20), note(6, '  d\n  now ', 10)];
    const items = tickerItems([], messages, now);
    expect(texts(items)).toEqual(['d now', 'c', 'b']);
    expect(kinds(items)).toEqual(['announcement', 'announcement', 'announcement']);
  });

  it('puts fresh announcements first and older ones after the timetable lines', () => {
    const items = tickerItems([racing()], [note(1, 'Arena 2 closed', 90), note(2, 'Lunch moved to 1pm', 3)], now);
    expect(texts(items)).toEqual(['Lunch moved to 1pm', 'Now: Seniors Session 1 · Heat 1', 'On time', `Next ${clock(20)}: Seniors Session 1 · Heat 2`, 'Arena 2 closed']);
  });
});

describe('tickerItems: fallback and limits', () => {
  it('falls back to the competition name when there is nothing else to say', () => {
    expect(tickerItems([], [], now, '  Spring\n Championships ')).toEqual([{ key: 'info', kind: 'info', text: 'Spring Championships' }]);
  });

  it('says nothing when there is no fallback or it is blank', () => {
    expect(tickerItems([], [], now)).toEqual([]);
    expect(tickerItems([], [], now, '   ')).toEqual([]);
  });

  it(`never returns more than ${MAX_TICKER_ITEMS} lines`, () => {
    const sessions = [
      session([heat(1, { finishedAt: at(-5), races: [won(1, 'Bending', 5, 'Ashdown')] }), heat(2), heat(3)], { status: 1, arenaName: 'Main', scheduledStart: at(-60), startedAt: at(-40) }),
      session([heat(4), heat(5)], { id: 2, name: 'Juniors', sectionName: 'Teams Juniors', competitionSectionId: 6, orderIndex: 2, status: 1, arenaName: 'Main', scheduledStart: at(-30), startedAt: at(-30) }),
      pause({ scheduledStart: at(20) }),
    ];
    const items = tickerItems(sessions, [note(1, 'x', 1), note(2, 'y', 2), note(3, 'z', 3)], now);
    expect(items).toHaveLength(MAX_TICKER_ITEMS);
    expect(kinds(items)).toEqual(['announcement', 'announcement', 'announcement', 'live', 'live', 'late', 'next', 'break']);
  });
});

describe('tickerClock', () => {
  it('shows just the time today', () => {
    expect(tickerClock(new Date(now), now)).toBe(clock(0));
  });

  it('adds the weekday within the week and the date further out', () => {
    expect(tickerClock(new Date(now.getTime() + 24 * 60 * 60_000), now)).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);
    expect(tickerClock(new Date(now.getTime() - 24 * 60 * 60_000), now)).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);
    expect(tickerClock(new Date(now.getTime() + 20 * 24 * 60 * 60_000), now)).toMatch(/^\d{1,2} [A-Z][a-z]{2,} \d{2}:\d{2}$/);
  });
});

describe('tickerFocusAfterChange', () => {
  const live: TickerItem = { key: 'live-heat-1', kind: 'live', text: 'Now' };
  const next: TickerItem = { key: 'next-heat-2', kind: 'next', text: 'Next' };
  const news: TickerItem = { key: 'announcement-7', kind: 'announcement', text: 'Hi' };

  it('jumps to a newly arrived announcement', () => {
    expect(tickerFocusAfterChange([live, next], [news, live, next], 'next-heat-2')).toBe('announcement-7');
  });

  it('keeps its place when nothing new has arrived', () => {
    expect(tickerFocusAfterChange([news, live, next], [news, live, next], 'next-heat-2')).toBe('next-heat-2');
  });

  it('moves to the first line when the current one has gone', () => {
    expect(tickerFocusAfterChange([live, next], [next], 'live-heat-1')).toBe('next-heat-2');
  });

  it('does not jump to announcements on the very first list', () => {
    expect(tickerFocusAfterChange([], [live, news], null)).toBe('live-heat-1');
  });

  it('returns null when there is nothing to show', () => {
    expect(tickerFocusAfterChange([live], [], 'live-heat-1')).toBeNull();
  });
});

describe('sameTickerItems', () => {
  const a: TickerItem[] = [{ key: 'late', kind: 'late', text: 'Running 6 min behind' }];

  it('compares by content', () => {
    expect(sameTickerItems(a, [{ ...a[0] }])).toBe(true);
  });

  it('notices a change in text, kind, key or length', () => {
    expect(sameTickerItems(a, [{ ...a[0], text: 'Running 7 min behind' }])).toBe(false);
    expect(sameTickerItems(a, [{ ...a[0], kind: 'next' }])).toBe(false);
    expect(sameTickerItems(a, [{ ...a[0], key: 'other' }])).toBe(false);
    expect(sameTickerItems(a, [])).toBe(false);
  });
});
