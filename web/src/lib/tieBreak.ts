import { TieBreakRule } from '../types';
import { ordinal } from './toplist';

/** How a tied cut was settled, as the finals boundary reports it. */
export type TieSettlement = 1 | 2 | 3;
export const TieSettlement = { Rule: 1 as TieSettlement, Organiser: 2 as TieSettlement, Open: 3 as TieSettlement };

export interface BoundaryTeam { id: number; name: string; total: number; wins: number; position: number; goesThrough: boolean }
export interface BoundaryTie {
  cutoff: number;
  totalAtCutoff: number;
  teams: BoundaryTeam[];
  rule: TieBreakRule;
  settledBy: TieSettlement;
  settled: boolean;
}
export interface FinalsBoundary {
  tied: boolean;
  message?: string;
  boundaries?: BoundaryTie[];
  unsettled?: boolean;
  runoffRaceName?: string | null;
}

export const TIE_BREAK_RULES: { value: TieBreakRule; label: string; hint: string }[] = [
  { value: TieBreakRule.Countback, label: 'Most 1st places', hint: 'Then most 2nds, then 3rds, and so on.' },
  { value: TieBreakRule.LastRace, label: 'Best result in the last race', hint: 'Then the race before, and so on.' },
  { value: TieBreakRule.RunOff, label: 'Run-off', hint: 'The tied teams race again and you enter the result.' },
  { value: TieBreakRule.Manual, label: 'I’ll decide', hint: 'You put the tied teams in order.' },
];

export function ruleLabel(rule: TieBreakRule): string {
  return TIE_BREAK_RULES.find((r) => r.value === rule)?.label ?? 'Most 1st places';
}

/** One line saying where a tied cut stands and what, if anything, the organiser needs to do. */
export function tieStatus(tie: BoundaryTie, runoffRaceName?: string | null): string {
  const leader = tie.teams.find((t) => t.goesThrough && t.position === tie.cutoff)?.name;
  if (tie.settledBy === TieSettlement.Organiser) return `Settled by your order: ${leader ?? 'the top team'} goes through.`;
  if (tie.settledBy === TieSettlement.Rule) return `Settled on ${ruleLabel(tie.rule).toLowerCase()}: ${leader ?? 'the top team'} goes through.`;
  if (tie.rule === TieBreakRule.RunOff) {
    return `Run the ${runoffRaceName?.trim() || 'run-off race'} between these teams, then put them in finishing order.`;
  }
  if (tie.rule === TieBreakRule.Manual) return 'Put these teams in order.';
  return `Still level on ${ruleLabel(tie.rule).toLowerCase()}. Run a run-off or put them in order yourself.`;
}

export function cutLabel(cutoff: number): string {
  return `Tie at the cut after ${ordinal(cutoff)}`;
}

/** Moves the item at `index` one place up (-1) or down (+1); out-of-range moves change nothing. */
export function move<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
