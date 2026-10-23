import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPONSOR_PLACEMENTS } from '../src/lib/sponsors.ts';

test('the web registry lists every SponsorPlacement the API knows, with the same bits', () => {
  const source = readFileSync(new URL('../../api/Entities/Sponsor.cs', import.meta.url), 'utf8');
  const body = /enum SponsorPlacement\s*\{([^}]*)\}/.exec(source)[1];
  const fromApi = [...body.matchAll(/^\s*(\w+)\s*=\s*(\d+),?/gm)].map((m) => ({ key: m[1], placement: Number(m[2]) })).filter((m) => m.placement !== 0);
  assert.ok(fromApi.length > 0);
  assert.deepEqual(SPONSOR_PLACEMENTS.map(({ key, placement }) => ({ key, placement })), fromApi);
});
