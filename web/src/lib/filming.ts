import type { FilmingOptOut } from '../types';

/** How many unfinished heats per session the banner covers: the one racing (or next up) and the one after. */
const HEATS_AHEAD = 2;

/** Opt-outs in the heats that matter now: each session's first unfinished heats, in running order. */
export function upcomingOptOuts(all: FilmingOptOut[], heatsAhead = HEATS_AHEAD): FilmingOptOut[] {
  const open = all.filter((o) => !o.heatFinished);
  const heatsBySession = new Map<number, number[]>();
  for (const o of [...open].sort((a, b) => a.heatOrder - b.heatOrder || a.heatId - b.heatId)) {
    const heats = heatsBySession.get(o.sessionId) ?? [];
    if (!heats.includes(o.heatId)) heats.push(o.heatId);
    heatsBySession.set(o.sessionId, heats);
  }
  return open
    .filter((o) => (heatsBySession.get(o.sessionId) ?? []).slice(0, heatsAhead).includes(o.heatId))
    .sort((a, b) => a.sessionOrder - b.sessionOrder || a.heatOrder - b.heatOrder || a.lane - b.lane || a.riderName.localeCompare(b.riderName));
}

/** "Filming opt-out: Heat 2, lane 4 (Oliver Smith)". */
export function describeOptOut(o: FilmingOptOut): string {
  return `Filming opt-out: ${o.heatLabel}, lane ${o.lane} (${o.riderName})`;
}
