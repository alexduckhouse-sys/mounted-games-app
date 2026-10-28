import { TieBreakRule, type Heat, type Race, type ResultRow } from '../types';
import { ordinal } from './toplist';
import { statusLabel } from './resultStatus';
import { formatPoints } from './formatPoints';

/**
 * What the announcer says after a race: placings, who is out and why, running totals for the heat and, after a
 * heat's last race, who goes through. Points come from the saved results; ties follow the section's tie-break
 * rule the way `api/Services/TieBreaker.cs` does. Nothing here changes a score.
 */
export interface SummaryInput {
  heat: Heat;
  /** The heat's races in running order. */
  races: Race[];
  /** The race just finished. */
  raceIndex: number;
  /** Teams marked Hors Concours: listed, never ranked or put through. */
  hcTeamIds: ReadonlySet<number>;
  rule: TieBreakRule;
  /** How many go through from a qualifier. */
  qualifiers: number;
  /** Private referee notes by team: the reasons teams were eliminated. */
  notes: Readonly<Record<number, string>>;
}

export interface TotalRow {
  teamId: number;
  teamName: string;
  points: number;
  hc: boolean;
  /** Shared by teams still level after the tie-break; null for HC. */
  position: number | null;
  /** Level with a neighbour on place, so it reads "=1st"; false for HC. */
  joint: boolean;
  /** Why this team is above the one below it when they are level on points. */
  why: string | null;
}

export interface OutLine { teamId: number; teamName: string; reason: string }
export interface PlaceLine { teamId: number; teamName: string; place: number; points: number; hc: boolean; /** Tied with another team for this place (a dead heat). */ joint: boolean }

/** "1st", or "=1st" when the place is shared. */
export function placeText(place: number, joint: boolean): string {
  return `${joint ? '=' : ''}${ordinal(place)}`;
}

export interface RaceSummary {
  raceName: string;
  placings: PlaceLine[];
  out: OutLine[];
  totals: TotalRow[];
  /** After the heat's last race. */
  ending: { heading: string; lines: string[] } | null;
}

const real = (r: ResultRow) => !r.isSitOut;

/** Why a team is out: the private note if staff wrote one, else the status ("Eliminated", "Did not start"...). */
function reasonFor(r: ResultRow, notes: Readonly<Record<number, string>>): string {
  return notes[r.teamId]?.trim() || statusLabel(true, r.status) || 'Eliminated';
}

interface Facts { teamId: number; teamName: string; total: number; counts: number[]; recent: number[] }

function factsFor(heat: Heat, races: Race[], upTo: number): Facts[] {
  const done = races.slice(0, upTo + 1);
  return heat.entries.map((e) => {
    const mine = done.flatMap((r) => r.results.filter((x) => x.teamId === e.teamId && real(x)).map((x) => ({ x, order: r.orderIndex })));
    const counts: number[] = [];
    for (const { x } of mine) if (!x.eliminated && (x.placing ?? 0) > 0) { counts[x.placing! - 1] = (counts[x.placing! - 1] ?? 0) + 1; }
    return {
      teamId: e.teamId, teamName: e.teamName,
      total: mine.reduce((s, m) => s + m.x.points, 0),
      counts: Array.from(counts, (c) => c ?? 0),
      recent: mine.slice().sort((a, b) => b.order - a.order).map((m) => m.x.points),
    };
  });
}

/** Positive when a ranks below b, as `Lexicographic` in the API: bigger numbers rank higher, compared place by place. */
function lexi(a: number[], b: number[], pad: boolean): { cmp: number; at: number } {
  const length = pad ? Math.max(a.length, b.length) : Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0; const y = b[i] ?? 0;
    if (x !== y) return { cmp: y - x, at: i };
  }
  return { cmp: 0, at: -1 };
}

const organiserDecides = (rule: TieBreakRule) => rule === TieBreakRule.RunOff || rule === TieBreakRule.Manual;

/** The order of two teams level on points: the rule first, then countback on places, as `TieBreaker.Compare` does. */
function tieKey(a: Facts, b: Facts, rule: TieBreakRule): { cmp: number; why: string | null } {
  if (rule === TieBreakRule.LastRace) {
    const r = lexi(a.recent, b.recent, false);
    if (r.cmp !== 0) return { cmp: r.cmp, why: 'better score in the most recent race' };
  }
  const c = lexi(a.counts, b.counts, true);
  if (c.cmp !== 0) return { cmp: c.cmp, why: c.at === 0 ? 'most wins' : `more ${ordinal(c.at + 1)} places` };
  return { cmp: 0, why: null };
}

/** Heat standings after `upTo`: highest total first, ties by the rule. HC teams follow, unranked. */
export function heatTotals(heat: Heat, races: Race[], upTo: number, hc: ReadonlySet<number>, rule: TieBreakRule): TotalRow[] {
  const facts = factsFor(heat, races, upTo);
  const ranked = facts.filter((f) => !hc.has(f.teamId));
  ranked.sort((a, b) => b.total - a.total || tieKey(a, b, rule).cmp || a.teamId - b.teamId);
  // Level means nothing separates them yet: with a run-off or manual rule the organiser decides, so they share a place.
  const level = (a: Facts, b: Facts) => a.total === b.total && (organiserDecides(rule) || tieKey(a, b, rule).cmp === 0);
  const rows: TotalRow[] = [];
  ranked.forEach((f, i) => {
    const prev = ranked[i - 1];
    const next = ranked[i + 1];
    const why = next && next.total === f.total && !organiserDecides(rule) ? tieKey(f, next, rule).why : null;
    rows.push({ teamId: f.teamId, teamName: f.teamName, points: f.total, hc: false, position: prev && level(prev, f) ? rows[i - 1].position : i + 1, joint: false, why });
  });
  for (const row of rows) row.joint = rows.filter((other) => other.position === row.position).length > 1;
  for (const f of facts.filter((x) => hc.has(x.teamId)).sort((a, b) => b.total - a.total)) {
    rows.push({ teamId: f.teamId, teamName: f.teamName, points: f.total, hc: true, position: null, joint: false, why: null });
  }
  return rows;
}

export function summariseRace(input: SummaryInput): RaceSummary | null {
  const { heat, races, raceIndex, hcTeamIds, rule, notes } = input;
  const race = races[raceIndex];
  if (!race || !race.isComplete) return null;
  const nameOf = (id: number) => heat.entries.find((e) => e.teamId === id)?.teamName ?? 'Unnamed team';

  const placings = race.results.filter((r) => real(r) && !r.eliminated && (r.placing ?? 0) > 0)
    .sort((a, b) => a.placing! - b.placing!)
    .map((r, _i, all): PlaceLine => ({ teamId: r.teamId, teamName: nameOf(r.teamId), place: r.placing!, points: r.points, hc: hcTeamIds.has(r.teamId), joint: all.some((o) => o !== r && o.placing === r.placing) }));
  const out = race.results.filter((r) => real(r) && r.eliminated)
    .map((r): OutLine => ({ teamId: r.teamId, teamName: nameOf(r.teamId), reason: reasonFor(r, notes) }));
  const totals = heatTotals(heat, races, raceIndex, hcTeamIds, rule);

  const last = raceIndex === races.length - 1 && races.every((r) => r.isComplete);
  return { raceName: race.name, placings, out, totals, ending: last ? ending(input, totals) : null };
}

function ending(input: SummaryInput, totals: TotalRow[]): { heading: string; lines: string[] } {
  const { heat, races, qualifiers, hcTeamIds, notes } = input;
  const nameOf = (id: number) => heat.entries.find((e) => e.teamId === id)?.teamName ?? 'Unnamed team';
  if (heat.raceRoundStage === 1) {
    // The same pick the server makes: finishers by placing, hors concours teams skipped, the top N.
    const all = races.flatMap((r) => r.results).filter((r) => real(r) && !r.eliminated && (r.placing ?? 0) > 0)
      .sort((a, b) => a.placing! - b.placing!);
    const finishers = all.filter((r) => !hcTeamIds.has(r.teamId));
    const through = new Set(finishers.slice(0, qualifiers).map((r) => r.teamId));
    const lines: string[] = [];
    finishers.forEach((r, i) => {
      lines.push(through.has(r.teamId)
        ? `${nameOf(r.teamId)}: qualified ${ordinal(i + 1)}, through to the final`
        : `${nameOf(r.teamId)}: not through. Placed ${ordinal(i + 1)} and only the top ${qualifiers} go through`);
    });
    for (const r of all.filter((x) => hcTeamIds.has(x.teamId))) {
      lines.push(`${nameOf(r.teamId)} (HC): hors concours, does not take a place in the final`);
    }
    for (const r of races.flatMap((x) => x.results).filter((x) => real(x) && x.eliminated)) {
      lines.push(`${nameOf(r.teamId)}: out of the qualifier. ${reasonFor(r, notes)}`);
    }
    return { heading: 'Through to the final', lines };
  }
  const lines = totals.map((t) => t.hc
    ? `${t.teamName}: hors concours, ${formatPoints(t.points)} points, not ranked`
    : `${placeText(t.position ?? 0, t.joint)} ${t.teamName}: ${formatPoints(t.points)} ${t.points === 1 ? 'point' : 'points'}${t.why ? `, ahead on tie-break: ${t.why}` : ''}`);
  const shared = totals.filter((t) => !t.hc).some((t, i, list) => i > 0 && list[i - 1].position === t.position);
  if (shared) lines.push(organiserDecides(input.rule)
    ? 'Teams are level on points: the organiser decides the order.'
    : 'Some teams are still level after the tie-break: the organiser decides the order.');
  return { heading: heat.raceRoundStage === 2 ? 'Final result' : 'Heat result', lines };
}

/**
 * One quiet sentence for screen readers when a heat's last race is in: "Heat 2 finished. Warwickshire Hunt A won."
 * Hors concours teams never win; teams still level at the top are named together.
 */
export function heatFinishedSentence(heatName: string, totals: readonly TotalRow[]): string {
  const top = totals.filter((t) => !t.hc && t.position === 1);
  const done = `${heatName} finished.`;
  if (top.length === 0 || top[0].points <= 0) return done;
  if (top.length === 1) return `${done} ${top[0].teamName} won.`;
  const names = top.map((t) => t.teamName);
  return `${done} ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are level at the top.`;
}
