import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TICKER_ITEMS, sameTickerItems, tickerClock, tickerFocusAfterChange, tickerItems } from '../src/lib/ticker.ts';

const now = new Date('2026-06-01T10:00:00Z');
const at = (minutes) => new Date(now.getTime() + minutes * 60_000).toISOString();
const clock = (minutes) => new Date(now.getTime() + minutes * 60_000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const heat = (id, extra = {}) => ({ id, orderIndex: id, races: [], entries: [], ...extra });
const session = (heats, extra = {}) => ({ id: 1, name: 'Seniors', sectionName: 'Teams Seniors', competitionSectionId: 5, orderIndex: 1, kind: 0, isBreak: false, status: 0, heats, ...extra });
const pause = (extra = {}) => ({ id: 50, name: 'Lunch', sectionName: null, competitionSectionId: null, orderIndex: 50, kind: 1, isBreak: true, status: 0, durationMinutes: 45, heats: [], ...extra });
const note = (id, body, minutesAgo, type = 2) => ({ id, body, type, createdAt: at(-minutesAgo) });
const race = (id, name, finishedMinutesAgo, winner) => ({ id, heatId: 1, name, orderIndex: id, isComplete: true, finishedAt: at(-finishedMinutesAgo), results: [{ id, teamId: 1, teamName: winner, placing: 1, eliminated: false, points: 4 }, { id: id + 100, teamId: 2, teamName: 'Other', placing: 2, eliminated: false, points: 3 }] });
const kinds = (items) => items.map((item) => item.kind);
const texts = (items) => items.map((item) => item.text);
const find = (items, kind) => items.find((item) => item.kind === kind);

test('says what is on now using the age group and session number', () => {
  const items = tickerItems([session([heat(1, { label: 'Heat 1' })], { status: 1 })], [], now);
  assert.deepEqual(items[0], { key: 'live-heat-1', kind: 'live', text: 'Now: Seniors Session 1 · Heat 1' });
});

test('the live heat is the first one not yet finished', () => {
  const items = tickerItems([session([heat(1, { finishedAt: at(-20) }), heat(2), heat(3)], { status: 1 })], [], now);
  assert.equal(find(items, 'live').text, 'Now: Seniors Session 1 · Heat 2');
});

test('on time while racing to schedule, followed by the next heat and its start time', () => {
  const sessions = [session([heat(1), heat(2)], { status: 1, scheduledStart: at(-10), startedAt: at(-10) })];
  const items = tickerItems(sessions, [], now);
  assert.deepEqual(kinds(items), ['live', 'ontime', 'next']);
  assert.equal(items[1].text, 'On time');
  assert.equal(items[2].text, `Next ${clock(20)}: Seniors Session 1 · Heat 2`);
});

test('running behind when the session started late', () => {
  const sessions = [session([heat(1), heat(2)], { status: 1, scheduledStart: at(-60), startedAt: at(-40) })];
  const items = tickerItems(sessions, [], now);
  assert.deepEqual(kinds(items), ['live', 'late', 'next']);
  assert.equal(items[1].text, 'Running 20 min behind');
});

test('running behind when nothing has started and the first heat is overdue', () => {
  const items = tickerItems([session([heat(1), heat(2)], { scheduledStart: at(-30) })], [], now);
  assert.deepEqual(kinds(items), ['late', 'next']);
  assert.equal(items[0].text, 'Running 30 min behind');
  assert.equal(items[1].text, `Next ${clock(-30)}: Seniors Session 1 · Heat 1`);
});

test('a small delay does not count as running behind', () => {
  const sessions = [session([heat(1), heat(2)], { status: 1, scheduledStart: at(-13), startedAt: at(-10) })];
  assert.deepEqual(kinds(tickerItems(sessions, [], now)), ['live', 'ontime', 'next']);
});

test('ignores a competition from weeks ago that never finished', () => {
  assert.deepEqual(tickerItems([session([heat(1)], { scheduledStart: at(-30 * 24 * 60) })], [], now), []);
});

test('a break coming up shows its name and start time; the next heat after it is still listed', () => {
  const sessions = [
    session([heat(1, { finishedAt: at(-30) }), heat(2)], { status: 1, scheduledStart: at(-60), startedAt: at(-60) }),
    pause({ scheduledStart: at(15) }),
    session([heat(3)], { id: 2, name: 'Juniors', sectionName: 'Teams Juniors', competitionSectionId: 6, orderIndex: 60, scheduledStart: at(60) }),
  ];
  const items = tickerItems(sessions, [], now);
  assert.deepEqual(kinds(items), ['live', 'ontime', 'next', 'break']);
  assert.equal(items[2].text, `Next ${clock(60)}: Juniors Session 1 · Heat 1`);
  assert.equal(items[3].text, `Lunch break ${clock(15)}`);
});

test('a break more than half an hour away is left out unless it is next', () => {
  const sessions = [
    session([heat(1), heat(2), heat(3)], { status: 1, scheduledStart: at(-10), startedAt: at(-10) }),
    pause({ scheduledStart: at(120) }),
  ];
  assert.equal(find(tickerItems(sessions, [], now), 'break'), undefined);
});

test('during a break it says how long the break lasts', () => {
  const sessions = [
    session([heat(1, { finishedAt: at(-30) })], { status: 1, scheduledStart: at(-60), startedAt: at(-60) }),
    pause({ scheduledStart: at(-5), durationMinutes: 45 }),
    session([heat(3)], { id: 2, name: 'Juniors', sectionName: 'Teams Juniors', competitionSectionId: 6, orderIndex: 60, scheduledStart: at(40) }),
  ];
  const items = tickerItems(sessions, [], now);
  assert.deepEqual(kinds(items), ['break', 'next']);
  assert.equal(items[0].text, `Lunch break until ${clock(40)}`);
});

test('a briefing is labelled as one', () => {
  const sessions = [pause({ name: 'Riders', kind: 2, isBreak: false, scheduledStart: at(10), durationMinutes: 15 })];
  assert.deepEqual(texts(tickerItems(sessions, [], now)), [`Riders briefing ${clock(10)}`]);
});

test('finals get their own kind, titled by age group, when next or live', () => {
  const finals = (extra) => session([heat(9, { label: 'Final A', raceRoundStage: 2 })], { id: 3, name: 'Seniors Finals', orderIndex: 90, ...extra });
  const next = tickerItems([finals({ scheduledStart: at(25) })], [], now);
  assert.deepEqual(next[0], { key: 'next-heat-9', kind: 'finals', text: `Next ${clock(25)}: Seniors Finals · Final A` });
  const live = tickerItems([finals({ status: 1 })], [], now);
  assert.deepEqual(live[0], { key: 'live-heat-9', kind: 'finals', text: 'Now: Seniors Finals · Final A' });
});

test('the latest race winner from the last half hour', () => {
  const heats = [heat(1, { finishedAt: at(-5), races: [race(1, 'Bending', 12, 'Ashdown'), race(2, 'Sock Race', 6, 'Pony Club A')] }), heat(2)];
  const items = tickerItems([session(heats, { status: 1 })], [], now);
  assert.deepEqual(find(items, 'result'), { key: 'result-2', kind: 'result', text: 'Pony Club A won Sock Race' });
  const stale = [heat(1, { finishedAt: at(-40), races: [race(1, 'Bending', 40, 'Ashdown')] })];
  assert.equal(find(tickerItems([session(stale, { status: 1 })], [], now), 'result'), undefined);
});

test('says racing has finished once every heat is done', () => {
  assert.deepEqual(texts(tickerItems([session([heat(1)], { status: 2 })], [], now)), ['Racing finished']);
});

test('lists only recent announcements, newest first, capped at three', () => {
  const messages = [note(1, 'old', 600), note(2, 'chat', 5, 0), note(3, 'a', 40), note(4, 'b', 30), note(5, 'c', 20), note(6, '  d\n  now ', 10)];
  const items = tickerItems([], messages, now);
  assert.deepEqual(texts(items), ['d now', 'c', 'b']);
  assert.deepEqual(kinds(items), ['announcement', 'announcement', 'announcement']);
});

test('fresh announcements lead; older ones come after the timetable lines', () => {
  const sessions = [session([heat(1), heat(2)], { status: 1, scheduledStart: at(-10), startedAt: at(-10) })];
  const items = tickerItems(sessions, [note(1, 'Arena 2 closed', 90), note(2, 'Lunch moved to 1pm', 3)], now);
  assert.deepEqual(texts(items), ['Lunch moved to 1pm', 'Now: Seniors Session 1 · Heat 1', 'On time', `Next ${clock(20)}: Seniors Session 1 · Heat 2`, 'Arena 2 closed']);
});

test('falls back to the competition name when there is nothing else to say', () => {
  assert.deepEqual(tickerItems([], [], now, 'Spring Championships'), [{ key: 'info', kind: 'info', text: 'Spring Championships' }]);
  assert.deepEqual(tickerItems([session([heat(1)])], [], now), []);
});

test(`never more than ${MAX_TICKER_ITEMS} lines`, () => {
  const sessions = [
    session([heat(1, { finishedAt: at(-5), races: [race(1, 'Bending', 5, 'Ashdown')] }), heat(2, { durationMinutes: 10 }), heat(3, { durationMinutes: 10 })], { status: 1, arenaName: 'Main', scheduledStart: at(-60), startedAt: at(-40) }),
    session([heat(4, { durationMinutes: 10 }), heat(5, { durationMinutes: 10 })], { id: 2, name: 'Juniors', sectionName: 'Teams Juniors', competitionSectionId: 6, orderIndex: 2, status: 1, arenaName: 'Two', scheduledStart: at(-30), startedAt: at(-30) }),
    // A whole-event break takes the biggest arena delay (Main is 20 minutes late), so 0 becomes +20.
    pause({ scheduledStart: at(0) }),
  ];
  const items = tickerItems(sessions, [note(1, 'x', 1), note(2, 'y', 2), note(3, 'z', 3)], now);
  assert.equal(items.length, MAX_TICKER_ITEMS);
  assert.deepEqual(kinds(items), ['announcement', 'announcement', 'announcement', 'live', 'live', 'late', 'next', 'break']);
});

test('times on another day carry the day', () => {
  assert.equal(tickerClock(new Date(now), now), clock(0));
  assert.match(tickerClock(new Date(now.getTime() + 24 * 60 * 60_000), now), /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  assert.match(tickerClock(new Date(now.getTime() + 20 * 24 * 60 * 60_000), now), /^\d{1,2} [A-Z][a-z]{2,} \d{2}:\d{2}$/);
});

test('a new announcement jumps the queue; otherwise the ticker keeps its place', () => {
  const live = { key: 'live-heat-1', kind: 'live', text: 'Now' };
  const next = { key: 'next-heat-2', kind: 'next', text: 'Next' };
  const news = { key: 'announcement-7', kind: 'announcement', text: 'Hi' };
  assert.equal(tickerFocusAfterChange([live, next], [news, live, next], 'next-heat-2'), 'announcement-7');
  assert.equal(tickerFocusAfterChange([news, live, next], [news, live, next], 'next-heat-2'), 'next-heat-2');
  assert.equal(tickerFocusAfterChange([live, next], [next], 'live-heat-1'), 'next-heat-2');
  assert.equal(tickerFocusAfterChange([], [news, live], null), 'announcement-7');
  assert.equal(tickerFocusAfterChange([live], [], 'live-heat-1'), null);
});

test('sameTickerItems compares by content', () => {
  const a = [{ key: 'late', kind: 'late', text: 'Running 6 min behind' }];
  assert.equal(sameTickerItems(a, [{ ...a[0] }]), true);
  assert.equal(sameTickerItems(a, [{ ...a[0], text: 'Running 7 min behind' }]), false);
  assert.equal(sameTickerItems(a, []), false);
});
