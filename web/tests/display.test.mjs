import test from 'node:test';
import assert from 'node:assert/strict';
import { bibAccent, bibLabel } from '../src/lib/bib.ts';
import { displaySectionName } from '../src/lib/section.ts';

test('bib colours recognise full names, casing and descriptions', () => {
  assert.equal(bibAccent(' FOREST GREEN '), '#059669');
  assert.equal(bibAccent('Red with white spots'), '#dc2626');
  assert.equal(bibAccent('unknown/blue,white'), '#2563eb');
});

test('unknown bib descriptions use a repeatable colour and empty values use grey', () => {
  assert.equal(bibAccent(' Example pattern '), bibAccent('example pattern'));
  assert.match(bibAccent('example pattern'), /^#[\da-f]{6}$/);
  for (const value of [undefined, null, '']) assert.equal(bibAccent(value), '#94a3b8');
});

test('bib labels preserve meaningful text and explain missing values', () => {
  assert.equal(bibLabel('  Example bib  '), 'Example bib');
  for (const value of [undefined, null, '', '  ']) assert.equal(bibLabel(value), 'No bib set');
});

test('section names remove only the Teams prefix', () => {
  assert.equal(displaySectionName('Teams Under 12'), 'Under 12');
  assert.equal(displaySectionName('TEAMS Seniors'), 'Seniors');
  assert.equal(displaySectionName('Pairs Under 12'), 'Pairs Under 12');
  assert.equal(displaySectionName('Individual Under 12'), 'Individual Under 12');
  assert.equal(displaySectionName('Teams'), 'Teams');
  assert.equal(displaySectionName('Teams '), 'Teams ');
  for (const value of [undefined, null, '']) assert.equal(displaySectionName(value), '');
});
