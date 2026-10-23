import type { Heat, HeatEntry } from '../types';
import { positionFor, sitsOut } from './lanes';
import type { LaneRules } from '../pages/competition/laneRules';

/**
 * A heat's teams in the order they stand in the lanes for one race: lane 1 first, using the rotated lane.
 * Teams with no lane this race (sit-outs) follow, in their drawn order. The order depends only on the race, never on
 * placings, so scoring a team does not move its row.
 */
export function inLaneOrder(heat: Heat, raceIndex: number, rules: LaneRules): HeatEntry[] {
  const size = heat.entries.length;
  const drawn = heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex || a.id - b.id);
  const idx = Math.max(raceIndex, 0);
  const keyed = drawn.map((entry, i) => ({
    entry,
    out: sitsOut(i + 1, idx, size, rules.lanesPerHeat, rules.mode),
    pos: positionFor(i + 1, idx, size, rules.mode),
  }));
  return keyed
    .sort((a, b) => Number(a.out) - Number(b.out) || a.pos - b.pos)
    .map((k) => k.entry);
}

/** The bib colour in words, for people who can't tell the swatch apart. */
export function bibName(colour: string | null | undefined): string {
  const text = colour?.trim();
  return text ? `${text} bib` : 'No bib colour';
}
