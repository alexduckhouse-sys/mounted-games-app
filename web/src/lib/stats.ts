import type { StatsBrowse, StatsHit, StatsProfile, StatsSubjectKind, StatsSummary } from '../types';

/** The API's limits on a search or profile name (`StatsNames` in the API). */
export const STATS_MIN_QUERY = 2;
export const STATS_MAX_QUERY = 80;

/** The URL segment for each kind, shared by the web route (`/stats/:kind`) and the API (`/api/stats/:kind`). */
export const STATS_PATHS: Record<StatsSubjectKind, string> = { 0: 'riders', 1: 'ponies', 2: 'teams', 3: 'clubs' };

export const STATS_KIND_LABELS: Record<StatsSubjectKind, string> = { 0: 'Rider', 1: 'Pony', 2: 'Team', 3: 'Club' };

/** The kind for a URL segment, or null for anything else. */
export function statsKindFromPath(segment: string | undefined): StatsSubjectKind | null {
  const entry = Object.entries(STATS_PATHS).find(([, path]) => path === segment);
  return entry ? (Number(entry[0]) as StatsSubjectKind) : null;
}

/** The app link to a profile. */
export function statsProfileHref(kind: StatsSubjectKind, key: string): string {
  return `/stats/${STATS_PATHS[kind]}?name=${encodeURIComponent(key)}`;
}

/** Trimmed, with runs of whitespace made single spaces: what the API compares. */
export function tidyStatsQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** True when the API will run this search: 2 to 80 characters, with something other than dots in it. */
export function isSearchableQuery(value: string): boolean {
  const tidy = tidyStatsQuery(value);
  return tidy.length >= STATS_MIN_QUERY && tidy.length <= STATS_MAX_QUERY && /[^.\s]/.test(tidy);
}

/** "62.5%", "50%", or a dash when there is nothing to divide. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function ordinalPlace(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[place % 10] ?? 'th'}`;
}

/** "A Final" for tier 0, "B Final" for 1, and so on; null when not in a lettered final. */
export function finalLabel(tier: number | null | undefined): string | null {
  if (tier == null || tier < 0 || tier > 25) return null;
  return `${String.fromCharCode(65 + tier)} Final`;
}

/** "3 of 6 points" for a quota line. */
export function pointsOf(points: number, maxPoints: number): string {
  return `${points} of ${maxPoints} ${maxPoints === 1 ? 'point' : 'points'}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The filter tabs on the stats page, in order. `plural` is the lower-case word used in prompts and messages. */
export const STATS_TABS: { kind: StatsSubjectKind; label: string; plural: string }[] = [
  { kind: 0, label: 'Riders', plural: 'riders' },
  { kind: 1, label: 'Ponies', plural: 'ponies' },
  { kind: 2, label: 'Teams', plural: 'teams' },
  { kind: 3, label: 'Clubs', plural: 'clubs' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHit(value: unknown): value is StatsHit {
  return isRecord(value) && typeof value.name === 'string' && typeof value.key === 'string'
    && typeof value.kind === 'number' && typeof value.competitions === 'number';
}

/** Guards a browse reply: an HTML page or a half-loaded body is not a list. */
export function isStatsBrowse(value: unknown): value is StatsBrowse {
  return isRecord(value) && typeof value.page === 'number' && typeof value.total === 'number'
    && Array.isArray(value.items) && value.items.every(isHit);
}

/** Guards a profile reply. Lists may be null (the summary-only view) but the summary must be there. */
export function isStatsProfile(value: unknown): value is StatsProfile {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.kind !== 'number' || !isRecord(value.summary)) return false;
  const lists = ['games', 'bestGames', 'worstGames', 'entries', 'partnerships'];
  return typeof value.summary.entries === 'number' && lists.every((list) => value[list] == null || Array.isArray(value[list]));
}

export interface StatsTile { label: string; value: string; detail: string }

/** The headline tiles of a profile, in reading order. */
export function summaryTiles(summary: StatsSummary): StatsTile[] {
  const podiums = summary.firsts + summary.seconds + summary.thirds;
  return [
    {
      label: 'Competitions', value: String(summary.competitions),
      detail: plural(summary.entries, 'age-group entry', 'age-group entries'),
    },
    { label: 'Podiums', value: String(podiums), detail: `1st ${summary.firsts} · 2nd ${summary.seconds} · 3rd ${summary.thirds}` },
    {
      label: 'Average place', value: summary.averagePlace == null ? '—' : String(summary.averagePlace),
      detail: summary.placedEntries === 0 ? 'No placed entries' : `Over ${plural(summary.placedEntries, 'placed entry', 'placed entries')}`,
    },
    {
      label: 'A Final', value: formatPercent(summary.aFinalPercent),
      detail: summary.entriesWithFinals === 0 ? 'No finals run' : `${summary.aFinals} of ${summary.entriesWithFinals} with finals`,
    },
    { label: 'Point quota', value: formatPercent(summary.pointQuotaPercent), detail: pointsOf(summary.points, summary.maxPoints) },
    { label: 'Races won', value: formatPercent(summary.winPercent), detail: `${summary.wins} of ${plural(summary.races, 'race')}` },
  ];
}
