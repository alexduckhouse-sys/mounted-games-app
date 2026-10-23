import { describe, expect, it } from 'vitest';
import { TieBreakRule } from '../types';
import { cutLabel, move, ruleLabel, tieStatus, TieSettlement, type BoundaryTie } from './tieBreak';

const tie = (patch: Partial<BoundaryTie> = {}): BoundaryTie => ({
  cutoff: 6,
  totalAtCutoff: 20,
  rule: TieBreakRule.Countback,
  settledBy: TieSettlement.Open,
  settled: false,
  teams: [
    { id: 1, name: 'North A', total: 20, wins: 2, position: 6, goesThrough: true },
    { id: 2, name: 'South B', total: 20, wins: 1, position: 7, goesThrough: false },
  ],
  ...patch,
});

describe('tie-break wording', () => {
  it('names each rule, and falls back to countback', () => {
    expect(ruleLabel(TieBreakRule.LastRace)).toBe('Best result in the last race');
    expect(ruleLabel(9 as TieBreakRule)).toBe('Most 1st places');
    expect(cutLabel(6)).toBe('Tie at the cut after 6th');
  });

  it('says who goes through once a tie is settled', () => {
    expect(tieStatus(tie({ settledBy: TieSettlement.Rule, settled: true }))).toBe('Settled on most 1st places: North A goes through.');
    expect(tieStatus(tie({ settledBy: TieSettlement.Organiser, settled: true }))).toBe('Settled by your order: North A goes through.');
    expect(tieStatus(tie({ settledBy: TieSettlement.Rule, teams: [] }))).toBe('Settled on most 1st places: the top team goes through.');
    expect(tieStatus(tie({ settledBy: TieSettlement.Organiser, teams: [] }))).toBe('Settled by your order: the top team goes through.');
  });

  it('says what to do with an open tie', () => {
    expect(tieStatus(tie({ rule: TieBreakRule.RunOff }), ' 2 Flag ')).toBe('Run the 2 Flag between these teams, then put them in finishing order.');
    expect(tieStatus(tie({ rule: TieBreakRule.RunOff }), null)).toBe('Run the run-off race between these teams, then put them in finishing order.');
    expect(tieStatus(tie({ rule: TieBreakRule.Manual }))).toBe('Put these teams in order.');
    expect(tieStatus(tie({ rule: TieBreakRule.LastRace }))).toBe('Still level on best result in the last race. Run a run-off or put them in order yourself.');
  });
});

describe('move', () => {
  it('swaps with the neighbour and ignores moves off either end', () => {
    expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(move(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(move(['a'], 3, -1)).toEqual(['a']);
  });
});
