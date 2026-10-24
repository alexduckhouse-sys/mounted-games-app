import { describe, expect, it } from 'vitest';
import { bibAccent, bibLabel, formatBibWithFlag, parseBibAndFlag } from './bib';

describe('parseBibAndFlag & formatBibWithFlag', () => {
  it('parses a leading [flag:id] tag case-insensitively and normalises the flag to lowercase', () => {
    expect(parseBibAndFlag(' [flag:GB-ENG]  Red with white spots ')).toEqual({ bib: 'Red with white spots', flag: 'gb-eng' });
    expect(parseBibAndFlag('[flag:de]')).toEqual({ bib: '', flag: 'de' });
    expect(parseBibAndFlag('Yellow with stars')).toEqual({ bib: 'Yellow with stars', flag: null });
    expect(parseBibAndFlag(null)).toEqual({ bib: '', flag: null });
    expect(parseBibAndFlag('   ')).toEqual({ bib: '', flag: null });
  });

  it('formats a bib description with an optional flag tag without double-prefixing', () => {
    expect(formatBibWithFlag('Red with white spots', 'GB')).toBe('[flag:gb] Red with white spots');
    expect(formatBibWithFlag('   ', 'gb-wls')).toBe('[flag:gb-wls]');
    expect(formatBibWithFlag('  Yellow  ', '')).toBe('Yellow');
    expect(formatBibWithFlag('[flag:fr] Blue', 'de')).toBe('[flag:de] Blue');
    expect(formatBibWithFlag('Blue', null)).toBe('Blue');
  });
});

describe('bibAccent', () => {
  it('recognises a full colour name regardless of case, padding and flag tag', () => {
    expect(bibAccent(' FOREST GREEN ')).toBe('#059669');
    expect(bibAccent('[flag:gb] FOREST GREEN')).toBe('#059669');
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
  it('trims meaningful text and strips leading flag tags', () => {
    expect(bibLabel('  Example bib  ')).toBe('Example bib');
    expect(bibLabel('[flag:gb] Navy with stars')).toBe('Navy with stars');
    expect(bibLabel('[flag:gb]')).toBe('No bib set');
  });

  it('explains a missing or blank bib', () => {
    for (const value of [undefined, null, '', '   ']) expect(bibLabel(value)).toBe('No bib set');
  });
});
