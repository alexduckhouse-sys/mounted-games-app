import { describe, expect, it } from 'vitest';
import { detectHeatBibClashes, normaliseBibColourKey, SPARE_BIB_COLOURS, suggestSpareBibOverrides, type HeatBibEntryLike } from './bib';

describe('normaliseBibColourKey', () => {
  it('strips the flag tag, bib suffixes and spelling variants', () => {
    expect(normaliseBibColourKey('[flag:gb] Gray BIBS')).toBe('grey');
    expect(normaliseBibColourKey('Dark  Green bib')).toBe('dark green');
    expect(normaliseBibColourKey('[flag:gb]')).toBeNull();
    expect(normaliseBibColourKey(undefined)).toBeNull();
  });
});

describe('suggestSpareBibOverrides branches', () => {
  it('skips entries with no bib colour at all', () => {
    const entries: HeatBibEntryLike[] = [
      { teamId: 1 }, { teamId: 2, bibColour: '  ' }, { teamId: 3, bibColour: 'red' }, { teamId: 4, bibColour: 'Red' },
    ];
    expect(suggestSpareBibOverrides(entries)).toEqual({ 4: 'blue' });
  });

  it('keeps the team that has no override and moves the one that does', () => {
    const entries: HeatBibEntryLike[] = [
      { teamId: 1, laneIndex: 0, bibColour: 'blue', bibColourOverride: 'red' },
      { teamId: 2, laneIndex: 1, bibColour: 'red' },
    ];
    // Team 2 has no override, so it keeps red; team 1 goes back to its own blue, which clears the override.
    expect(suggestSpareBibOverrides(entries)).toEqual({ 1: null });
  });

  it('breaks ties by lane, then id, then team id', () => {
    const base = { bibColour: 'green' };
    // Later lane loses.
    expect(suggestSpareBibOverrides([{ teamId: 1, laneIndex: 2, ...base }, { teamId: 2, laneIndex: 1, ...base }])).toEqual({ 1: 'red' });
    // Same lane: higher id loses.
    expect(suggestSpareBibOverrides([{ teamId: 1, id: 20, laneIndex: 1, ...base }, { teamId: 2, id: 10, laneIndex: 1, ...base }])).toEqual({ 1: 'red' });
    // Same lane and id: higher team id loses.
    expect(suggestSpareBibOverrides([{ teamId: 5, id: 1, laneIndex: 1, ...base }, { teamId: 3, id: 1, laneIndex: 1, ...base }])).toEqual({ 5: 'red' });
    // Missing lane and id count as zero.
    expect(suggestSpareBibOverrides([{ teamId: 9, ...base }, { teamId: 8, ...base }])).toEqual({ 9: 'red' });
  });

  it('gives up on a clash when every spare colour is already in use', () => {
    const others: HeatBibEntryLike[] = SPARE_BIB_COLOURS.map((c, i) => ({ teamId: 100 + i, laneIndex: 10 + i, bibColour: c }));
    const entries: HeatBibEntryLike[] = [
      { teamId: 1, laneIndex: 0, bibColour: 'red', bibColourOverride: 'teal' },
      { teamId: 2, laneIndex: 1, bibColour: 'blue', bibColourOverride: 'teal' },
      ...others,
    ];
    // Blue is the second team's own colour but another team wears it, and no spare is left, so nothing changes.
    expect(suggestSpareBibOverrides(entries)).toEqual({});
  });

  it('uses the team lookup (map or record) when the entries carry no colour of their own', () => {
    const entries: HeatBibEntryLike[] = [{ teamId: 1 }, { teamId: 2 }];
    expect(suggestSpareBibOverrides(entries, new Map([[1, 'Red'], [2, 'red']]))).toEqual({ 2: 'blue' });
    expect(suggestSpareBibOverrides(entries, { 1: 'Red', 2: 'red' })).toEqual({ 2: 'blue' });
  });

  it('returns the team to its own colour when that is free', () => {
    const entries: HeatBibEntryLike[] = [
      { teamId: 1, laneIndex: 0, bibColour: 'teal' },
      { teamId: 2, laneIndex: 1, bibColour: 'pink', bibColourOverride: 'teal' },
    ];
    expect(suggestSpareBibOverrides(entries)).toEqual({ 2: null });
  });

  it('does not repeat an override that is already right', () => {
    const entries: HeatBibEntryLike[] = [
      { teamId: 1, laneIndex: 0, bibColour: 'teal' },
      { teamId: 2, laneIndex: 1, bibColour: 'teal', bibColourOverride: 'teal' },
    ];
    // Team 2 has an override, so it is the one moved; its own colour is taken, so a spare is picked.
    expect(suggestSpareBibOverrides(entries)).toEqual({ 2: 'red' });
  });
});

describe('detectHeatBibClashes ordering', () => {
  it('lists clashing entries in lane order with a capitalised label', () => {
    const [clash] = detectHeatBibClashes([
      { teamId: 2, laneIndex: 1, bibColour: 'red' },
      { teamId: 1, laneIndex: 0, bibColour: 'Red bib' },
      { teamId: 3, bibColour: undefined },
    ]);
    expect(clash.colourLabel).toBe('Red');
    expect(clash.entries.map((e) => e.teamId)).toEqual([1, 2]);
  });
});
