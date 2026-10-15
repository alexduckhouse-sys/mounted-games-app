import test from 'node:test';
import assert from 'node:assert/strict';
import { competitionDateText, countryTag, isOnToday } from '../src/lib/competitionDates.ts';

test('a one-day competition shows its weekday, day and month', () => {
  assert.equal(competitionDateText('2026-10-17T00:00:00', null), 'Sat 17 Oct');
  assert.equal(competitionDateText('2026-10-17T00:00:00', '2026-10-17T00:00:00'), 'Sat 17 Oct');
});

test('a weekend competition shows both days, with the month once when it is shared', () => {
  assert.equal(competitionDateText('2026-10-17T00:00:00', '2026-10-18T00:00:00'), 'Sat 17 – Sun 18 Oct');
  assert.equal(competitionDateText('2026-10-31T00:00:00', '2026-11-01T00:00:00'), 'Sat 31 Oct – Sun 1 Nov');
});

test('past competitions can carry the year', () => {
  assert.equal(competitionDateText('2025-06-14T00:00:00', null, true), 'Sat 14 Jun 2025');
});

test('an unreadable date gives an empty string rather than "Invalid Date"', () => {
  assert.equal(competitionDateText('not a date', null), '');
});

test('on today covers every day of a multi-day competition', () => {
  const now = new Date('2026-10-18T15:00:00');
  assert.equal(isOnToday('2026-10-17T00:00:00', '2026-10-18T00:00:00', now), true);
  assert.equal(isOnToday('2026-10-18T00:00:00', null, now), true);
  assert.equal(isOnToday('2026-10-19T00:00:00', null, now), false);
  assert.equal(isOnToday('2026-10-16T00:00:00', '2026-10-17T00:00:00', now), false);
});

test('flag icons map to a short country tag', () => {
  assert.equal(countryTag('fr'), 'FR');
  assert.equal(countryTag('world'), 'INTL');
  assert.equal(countryTag('flag'), null);
  assert.equal(countryTag(undefined), null);
});
