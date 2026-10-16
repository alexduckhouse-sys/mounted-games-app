import { describe, expect, it } from 'vitest';
import { bibAccent, bibLabel } from './bib';

describe('bibAccent', () => {
  it('recognises a full colour name regardless of case and padding', () => {
    expect(bibAccent(' FOREST GREEN ')).toBe('#059669');
  });

  it('uses the first recognised word of a longer description', () => {
    expect(bibAccent('Red with white spots')).toBe('#dc2626');
    expect(bibAccent('unknown/blue,white')).toBe('#2563eb');
  });

  it('gives an unrecognised description the same colour every time', () => {
    const first = bibAccent(' Example pattern ');
    expect(first).toBe(bibAccent('example pattern'));
    expect(first).toMatch(/^#[\da-f]{6}$/);
  });

  it('uses neutral grey when there is nothing to describe', () => {
    for (const value of [undefined, null, '']) expect(bibAccent(value)).toBe('#94a3b8');
  });
});

describe('bibLabel', () => {
  it('trims meaningful text', () => {
    expect(bibLabel('  Example bib  ')).toBe('Example bib');
  });

  it('explains a missing or blank bib', () => {
    for (const value of [undefined, null, '', '   ']) expect(bibLabel(value)).toBe('No bib set');
  });
});
