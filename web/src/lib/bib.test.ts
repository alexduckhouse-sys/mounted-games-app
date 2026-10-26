import { describe, expect, it } from 'vitest';
import {
  bibAccent,
  bibLabel,
  detectHeatBibClashes,
  effectiveBibColour,
  formatBibWithFlag,
  hasHeatBibClash,
  normaliseBibColourKey,
  parseBibAndFlag,
  SPARE_BIB_COLOURS,
  suggestSpareBibOverrides,
} from './bib';

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

describe('effectiveBibColour & normaliseBibColourKey', () => {
  it('prefers bibColourOverride over bibColour and fallbackTeamBibColour', () => {
    expect(effectiveBibColour({ bibColour: 'Red', bibColourOverride: '  yellow ' }, 'Blue')).toBe('yellow');
    expect(effectiveBibColour({ bibColour: ' Red ', bibColourOverride: '   ' }, 'Blue')).toBe('Red');
    expect(effectiveBibColour({ bibColour: null, bibColourOverride: null }, ' Blue ')).toBe('Blue');
    expect(effectiveBibColour({ bibColour: '', bibColourOverride: undefined }, '   ')).toBeNull();
  });

  it('normalises case, flags, trailing bib/bibs words, and gray/grey', () => {
    expect(normaliseBibColourKey('  [flag:gb-wls]  Red   Bibs  ')).toBe('red');
    expect(normaliseBibColourKey('Yellow bib')).toBe('yellow');
    expect(normaliseBibColourKey('Dark Gray')).toBe('dark grey');
    expect(normaliseBibColourKey('   ')).toBeNull();
    expect(normaliseBibColourKey(null)).toBeNull();
    expect(normaliseBibColourKey('bib')).toBe('bib');
  });
});

describe('detectHeatBibClashes & suggestSpareBibOverrides', () => {
  it('exposes the canonical spare bib palette', () => {
    expect(SPARE_BIB_COLOURS).toEqual([
      'red',
      'blue',
      'yellow',
      'green',
      'white',
      'orange',
      'purple',
      'pink',
    ]);
  });

  it('detects clashing bib colours across lanes and ignores resolved overrides', () => {
    const entries = [
      { id: 2, teamId: 20, teamName: 'Alpha B', laneIndex: 2, bibColour: 'red bibs' },
      { id: 1, teamId: 10, teamName: 'Alpha A', laneIndex: 1, bibColour: '[flag:gb] Red' },
      { id: 3, teamId: 30, teamName: 'Beta', laneIndex: 3, bibColour: 'Blue' },
      { id: 4, teamId: 40, teamName: 'Gamma', laneIndex: 4, bibColour: null },
    ];

    expect(hasHeatBibClash(entries)).toBe(true);
    const clashes = detectHeatBibClashes(entries);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].colourKey).toBe('red');
    expect(clashes[0].colourLabel).toBe('Red');
    expect(clashes[0].swatch).toBe('#dc2626');
    expect(clashes[0].entries.map(e => e.teamId)).toEqual([10, 20]);

    const resolved = entries.map(e => (e.teamId === 20 ? { ...e, bibColourOverride: 'yellow' } : e));
    expect(hasHeatBibClash(resolved)).toBe(false);
    expect(detectHeatBibClashes(resolved)).toEqual([]);
  });

  it('supports Map and Record team bib lookups when entry bibColour is absent', () => {
    const entries = [
      { teamId: 1 },
      { teamId: 2 },
    ];
    const mapLookup = new Map<number, string | null>([
      [1, 'Green'],
      [2, 'green'],
    ]);
    expect(detectHeatBibClashes(entries, mapLookup)).toHaveLength(1);

    const recordLookup: Record<number, string | null> = {
      1: 'Green',
      2: 'Purple',
    };
    expect(detectHeatBibClashes(entries, recordLookup)).toHaveLength(0);
  });

  it('suggests non-clashing spare bib overrides in lane order while keeping the first team on its usual colour', () => {
    const entries = [
      { id: 1, teamId: 101, laneIndex: 1, bibColour: 'Red' },
      { id: 2, teamId: 102, laneIndex: 2, bibColour: 'Red' },
      { id: 3, teamId: 103, laneIndex: 3, bibColour: 'Blue' },
      { id: 4, teamId: 104, laneIndex: 4, bibColour: 'Red' },
    ];

    const suggested = suggestSpareBibOverrides(entries);
    // 'red' and 'blue' are already in use in this heat, so lanes 2 and 4 get 'yellow' and 'green'
    expect(suggested).toEqual({
      102: 'yellow',
      104: 'green',
    });
  });

  it('prioritises a team wearing its natural colour over a team whose override caused the clash, and restores free natural colours', () => {
    const baseByTeam: Record<number, string> = {
      1: 'Yellow',
      2: 'Blue',
      3: 'Green',
    };
    const entries = [
      { id: 1, teamId: 1, laneIndex: 1, bibColour: 'Blue', bibColourOverride: 'Blue' },
      { id: 2, teamId: 2, laneIndex: 2, bibColour: 'Blue', bibColourOverride: null },
      { id: 3, teamId: 3, laneIndex: 3, bibColour: null, bibColourOverride: null },
    ];

    // Team 2 naturally wears Blue; Team 1 naturally wears Yellow (which is unused in this heat)
    const suggested = suggestSpareBibOverrides(entries, baseByTeam);
    expect(suggested).toEqual({
      1: null,
    });
  });
});
