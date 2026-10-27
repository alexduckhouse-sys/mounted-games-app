import { describe, expect, it } from 'vitest';
import {
  SPARE_BIB_COLOURS,
  bibAccent,
  detectHeatBibClashes,
  effectiveBibColour,
  formatBibWithFlag,
  hasHeatBibClash,
  normaliseBibColourKey,
  parseBibAndFlag,
  suggestSpareBibOverrides,
} from './bib';

describe('bib branches', () => {
  it('handles blank and untagged input', () => {
    expect(parseBibAndFlag(null)).toEqual({ bib: '', flag: null });
    expect(parseBibAndFlag('   ')).toEqual({ bib: '', flag: null });
    expect(parseBibAndFlag('[flag:UK]')).toEqual({ bib: '', flag: 'uk' });
    expect(formatBibWithFlag('Red', null)).toBe('Red');
    expect(formatBibWithFlag('', 'UK')).toBe('[flag:uk]');
    expect(formatBibWithFlag('[flag:ie] Red', '  ')).toBe('Red');
  });

  it('picks an accent from a later word and falls back to the hash palette', () => {
    expect(bibAccent('spotty, navy')).toBe('#0284c7');
    expect(bibAccent('zzz qqq')).toBe('#f59e0b');
    expect(bibAccent('unknown pattern')).toBe('#10b981');
  });

  it('chooses the effective colour from override, direct, then fallback', () => {
    expect(effectiveBibColour({ bibColourOverride: ' Pink ', bibColour: 'Red' }, 'Blue')).toBe('Pink');
    expect(effectiveBibColour({ bibColourOverride: '  ', bibColour: ' Red ' }, 'Blue')).toBe('Red');
    expect(effectiveBibColour({ bibColour: null }, ' Blue ')).toBe('Blue');
    expect(effectiveBibColour({}, '  ')).toBeNull();
    expect(effectiveBibColour({})).toBeNull();
  });

  it('normalises keys, including a lone bib word and empty results', () => {
    expect(normaliseBibColourKey(null)).toBeNull();
    expect(normaliseBibColourKey('bib')).toBe('bib');
    expect(normaliseBibColourKey(' Red  BIBS ')).toBe('red');
    expect(normaliseBibColourKey('Gray bib')).toBe('grey');
  });

  it('detects clashes using lookup fallbacks, ordering by lane, id and team', () => {
    const entries = [
      { id: 2, teamId: 5, laneIndex: 1, bibColour: 'Red' },
      { id: 1, teamId: 4, laneIndex: 1, bibColour: 'red bib' },
      { teamId: 3, laneIndex: 0 },
      { teamId: 2, laneIndex: 2 },
    ];
    const clashes = detectHeatBibClashes(entries, { 3: 'Green', 2: null });
    expect(clashes).toHaveLength(1);
    expect(clashes[0].colourKey).toBe('red');
    expect(clashes[0].colourLabel).toBe('Red');
    expect(clashes[0].entries.map((e) => e.teamId)).toEqual([4, 5]);
    expect(hasHeatBibClash(entries)).toBe(true);
    expect(hasHeatBibClash([{ teamId: 1, bibColour: 'red' }, { teamId: 2, bibColour: 'blue' }])).toBe(false);
    expect(hasHeatBibClash([{ teamId: 1 }, { teamId: 2 }], new Map())).toBe(false);
    expect(detectHeatBibClashes([{ id: 1, teamId: 9, bibColour: 'red' }, { id: 1, teamId: 8, bibColour: 'red' }])[0].entries.map((e) => e.teamId)).toEqual([8, 9]);
  });

  it('suggests overrides using base colours, spare colours and skipping untouched entries', () => {
    // second team's own colour is free after the first moves? it is used, so a spare is chosen
    const clash = [
      { id: 1, teamId: 1, laneIndex: 0, bibColour: 'red' },
      { id: 2, teamId: 2, laneIndex: 1, bibColour: 'red' },
      { id: 3, teamId: 3, laneIndex: 2, bibColour: 'blue' },
    ];
    expect(suggestSpareBibOverrides(clash)).toEqual({ 2: 'yellow' });

    // team wearing an override that clashes with a free natural colour reverts to natural (null)
    const reverts = [
      { id: 1, teamId: 1, laneIndex: 0, bibColour: 'red' },
      { id: 2, teamId: 2, laneIndex: 1, bibColour: 'green', bibColourOverride: 'red' },
    ];
    expect(suggestSpareBibOverrides(reverts)).toEqual({ 2: null });

    // an existing override that is already the right spare is left alone
    const stable = [
      { id: 1, teamId: 1, laneIndex: 0, bibColour: 'red' },
      { id: 2, teamId: 2, laneIndex: 1, bibColour: 'red', bibColourOverride: 'yellow' },
      { id: 3, teamId: 3, laneIndex: 2, bibColour: 'red', bibColourOverride: 'red' },
    ];
    expect(suggestSpareBibOverrides(stable)).toEqual({ 3: 'blue' });

    // entries with no colour, or no clash, give no updates; lookup beats entry colour
    expect(suggestSpareBibOverrides([{ teamId: 1 }, { teamId: 2 }])).toEqual({});
    expect(suggestSpareBibOverrides([{ teamId: 1, bibColour: 'red' }, { teamId: 2, bibColour: 'red' }], new Map([[2, 'blue']]))).toEqual({});
  });

  it('gives up quietly when every spare colour is taken', () => {
    const entries = SPARE_BIB_COLOURS.map((c, i) => ({ id: i + 1, teamId: i + 1, laneIndex: i, bibColour: c }));
    entries.push({ id: 99, teamId: 99, laneIndex: 99, bibColour: 'red' });
    expect(suggestSpareBibOverrides(entries)).toEqual({});
  });
});
