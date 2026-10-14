import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competitionCookie, readCompetitionCookie } from '../src/competition/preference.ts';

test('remembers the selected competition, including punctuation and non-ASCII names', () => {
  const current = { id: 42, name: 'Example Games · Summer; pairs = A/B' };
  const saved = competitionCookie(current, true);
  assert.deepEqual(readCompetitionCookie(`theme=dark; ${saved.split(';')[0]}`), current);
  assert.match(saved, /Max-Age=15552000; SameSite=Lax; Secure$/);
});

test('rejects damaged cookies and invalid competition IDs', () => {
  for (const value of ['%zz', 'null', '{}', '[]', JSON.stringify({ id: -1, name: 'Example' }), JSON.stringify({ id: 1.5, name: 'Example' }), JSON.stringify({ id: '1', name: 'Example' }), JSON.stringify({ id: 1, name: '' })]) {
    assert.equal(readCompetitionCookie(`mg.competition=${value}`), null);
  }
});

test('does not confuse similarly named cookies with consent to remember a competition', () => {
  assert.equal(readCompetitionCookie('mg.competitionOther=%7B%22id%22%3A1%2C%22name%22%3A%22Example%22%7D'), null);
  assert.equal(readCompetitionCookie(''), null);
});

test('forgetting expires the competition cookie at the same path', () => {
  assert.equal(competitionCookie(null, true), 'mg.competition=; Path=/; Max-Age=0; SameSite=Lax; Secure');
});

test('allows local HTTP development without a Secure-only cookie', () => {
  assert.doesNotMatch(competitionCookie({ id: 1, name: 'Example event' }, false), /; Secure/);
});

test('rejects primitive JSON values and unsafe IDs rather than accepting a malformed preference', () => {
  for (const value of [true, 42, 'Example', { id: 9007199254740992, name: 'Example' }, { id: 1, name: false }, { name: 'Example' }]) {
    assert.equal(readCompetitionCookie(`mg.competition=${encodeURIComponent(JSON.stringify(value))}`), null);
  }
});
