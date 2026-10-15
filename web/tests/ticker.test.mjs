import test from 'node:test';
import assert from 'node:assert/strict';
import { tickerItems } from '../src/lib/ticker.ts';

const now = new Date('2026-06-01T10:00:00Z');
const heat = (id, extra = {}) => ({ id, orderIndex: id, races: [], entries: [], ...extra });
const session = (heats, extra = {}) => ({ id: 1, name: 'Seniors', sectionName: 'Teams Seniors', competitionSectionId: 5, orderIndex: 1, kind: 0, status: 0, heats, ...extra });
const note = (id, body, minutesAgo, type = 2) => ({ id, body, type, createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString() });

test('says what is on now using the age group and session number', () => {
  const items = tickerItems([session([heat(1, { label: 'Heat 1' })], { status: 1 })], [], now);
  assert.equal(items[0], 'Now: Seniors Session 1 · Heat 1');
});

test('lists only recent announcements, newest first, capped at three', () => {
  const messages = [note(1, 'old', 600), note(2, 'chat', 5, 0), note(3, 'a', 40), note(4, 'b', 30), note(5, 'c', 20), note(6, 'd', 10)];
  assert.deepEqual(tickerItems([], messages, now), ['📣 d', '📣 c', '📣 b']);
});

test('nothing to show when the day has not started and there are no announcements', () => {
  assert.deepEqual(tickerItems([session([heat(1)])], [], now), []);
});
