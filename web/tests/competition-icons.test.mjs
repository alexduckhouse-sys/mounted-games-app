import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competitionIcon } from '../src/competition/icons.ts';

test('known competition flags render and old or unknown values fall back safely', () => {
  assert.equal(competitionIcon('ie').src, '/flags/ie.png');
  assert.equal(competitionIcon('trophy').symbol, '🏆');
  for (const value of [undefined, null, '', 'not-an-icon', '<img onerror="alert(1)">']) {
    assert.equal(competitionIcon(value).id, 'flag');
  }
});
