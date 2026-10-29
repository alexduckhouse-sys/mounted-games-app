import type { StatsBrowse, StatsGame, StatsHit, StatsProfile, StatsSubjectKind, StatsSummary } from '../types';
import { formatPoints } from './formatPoints';
import { tr } from '../i18n/translate';

export { ordinalPlace } from './ordinalText';

/** The API's limits on a search or profile name (`StatsNames` in the API). */
export const STATS_MIN_QUERY = 2;
export const STATS_MAX_QUERY = 80;

/** The URL segment for each kind, shared by the web route (`/stats/:kind`) and the API (`/api/stats/:kind`). */
export const STATS_PATHS: Record<StatsSubjectKind, string> = { 0: 'riders', 1: 'ponies', 2: 'teams', 3: 'clubs' };

/** The kind's name in the chosen language ("Rider", "Pony", "Team", "Club" in English). */
export const STATS_KIND_LABELS: Record<StatsSubjectKind, string> = {
  get 0() { return tr('site.stats.kind.rider'); },
  get 1() { return tr('site.stats.kind.pony'); },
  get 2() { return tr('site.stats.kind.team'); },
  get 3() { return tr('site.stats.kind.club'); },
};

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

/** "A Final" for tier 0, "B Final" for 1, and so on; null when not in a lettered final. */
export function finalLabel(tier: number | null | undefined): string | null {
  if (tier == null || tier < 0 || tier > 25) return null;
  return tr('site.stats.finalLetter', { letter: String.fromCharCode(65 + tier) });
}

/** "3 of 6 points" for a quota line. */
export function pointsOf(points: number, maxPoints: number): string {
  return tr('site.stats.pointsOf', { count: maxPoints, points: formatPoints(points), max: formatPoints(maxPoints) });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The filter tabs on the stats page, in order. `plural` is the lower-case word used in prompts and messages. */
export const STATS_TABS: { kind: StatsSubjectKind; label: string; plural: string }[] = [
  { kind: 0, get label() { return tr('site.stats.tab.riders'); }, get plural() { return tr('site.stats.tabPlural.riders'); } },
  { kind: 1, get label() { return tr('site.stats.tab.ponies'); }, get plural() { return tr('site.stats.tabPlural.ponies'); } },
  { kind: 2, get label() { return tr('site.stats.tab.teams'); }, get plural() { return tr('site.stats.tabPlural.teams'); } },
  { kind: 3, get label() { return tr('site.stats.tab.clubs'); }, get plural() { return tr('site.stats.tabPlural.clubs'); } },
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
  const lists = ['games', 'bestGames', 'worstGames', 'entries', 'partnerships', 'clubs', 'seasons'];
  return typeof value.summary.entries === 'number' && lists.every((list) => value[list] == null || Array.isArray(value[list]));
}

export interface StatsTile { label: string; value: string; detail: string }

/** "3 races", "1 win", "2 entries" in the chosen language. */
export const countText = (key: 'race' | 'win' | 'entry' | 'competition' | 'rider' | 'point' | 'run' | 'ageGroupEntry' | 'placedEntry', n: number) => {
  switch (key) {
    case 'race': return tr('site.count.race', { count: n });
    case 'win': return tr('site.count.win', { count: n });
    case 'entry': return tr('site.count.entry', { count: n });
    case 'competition': return tr('site.count.competition', { count: n });
    case 'rider': return tr('site.count.rider', { count: n });
    case 'point': return tr('site.count.point', { count: n });
    case 'run': return tr('site.count.run', { count: n });
    case 'ageGroupEntry': return tr('site.count.ageGroupEntry', { count: n });
    default: return tr('site.count.placedEntry', { count: n });
  }
};

/** The headline tiles of a profile, in reading order. */
export function summaryTiles(summary: StatsSummary): StatsTile[] {
  const podiums = summary.firsts + summary.seconds + summary.thirds;
  const bFinals = summary.bFinals ?? 0;
  const cFinals = summary.cFinals ?? 0;
  const finalsDetail = summary.entriesWithFinals === 0
    ? tr('site.stats.noFinals')
    : bFinals > 0 || cFinals > 0
      ? tr('site.stats.finalsAbcOfParen', { a: summary.aFinals, b: bFinals, c: cFinals, of: summary.entriesWithFinals })
      : tr('site.stats.finalsWith', { a: summary.aFinals, of: summary.entriesWithFinals });
  return [
    {
      label: tr('site.stats.competitions'), value: String(summary.competitions),
      detail: countText('ageGroupEntry', summary.entries),
    },
    { label: tr('site.stats.podiums'), value: String(podiums), detail: tr('site.stats.podiumDetail', { first: summary.firsts, second: summary.seconds, third: summary.thirds }) },
    {
      label: tr('site.stats.averagePlace'), value: summary.averagePlace == null ? '—' : String(summary.averagePlace),
      detail: summary.placedEntries === 0 ? tr('site.stats.noPlaced') : tr('site.stats.overPlaced', { entries: countText('placedEntry', summary.placedEntries) }),
    },
    {
      label: tr('site.stats.aFinal'), value: formatPercent(summary.aFinalPercent),
      detail: finalsDetail,
    },
    { label: tr('site.stats.pointQuota'), value: formatPercent(summary.pointQuotaPercent), detail: pointsOf(summary.points, summary.maxPoints) },
    { label: tr('site.stats.racesWon'), value: formatPercent(summary.winPercent), detail: tr('site.of', { a: summary.wins, b: countText('race', summary.races) }) },
  ];
}

/** The same headline figures as plain "label, value" lines, as the team profile lists them. */
export function statsFacts(summary: StatsSummary): { label: string; value: string }[] {
  const podiums = summary.firsts + summary.seconds + summary.thirds;
  const bFinals = summary.bFinals ?? 0;
  const cFinals = summary.cFinals ?? 0;
  const finals = summary.entriesWithFinals === 0
    ? tr('site.stats.noFinals')
    : bFinals > 0 || cFinals > 0
      ? tr('site.stats.finalsAbcOf', { a: summary.aFinals, b: bFinals, c: cFinals, of: summary.entriesWithFinals })
      : tr('site.of', { a: summary.aFinals, b: summary.entriesWithFinals });
  const quota = summary.pointQuotaPercent == null ? '' : ` (${formatPercent(summary.pointQuotaPercent)})`;
  return [
    { label: tr('site.stats.competitions'), value: String(summary.competitions) },
    { label: tr('site.stats.podiums'), value: podiums === 0 ? tr('site.stats.noneYet') : tr('site.stats.podiumFact', { total: podiums, first: summary.firsts, second: summary.seconds, third: summary.thirds }) },
    { label: tr('site.stats.averagePlace'), value: summary.averagePlace == null ? '—' : String(summary.averagePlace) },
    { label: tr('site.stats.aFinals'), value: finals },
    { label: tr('site.stats.points'), value: `${tr('site.of', { a: formatPoints(summary.points), b: formatPoints(summary.maxPoints) })}${quota}` },
    { label: tr('site.stats.racesWon'), value: tr('site.of', { a: summary.wins, b: summary.races }) },
  ];
}

/** One game's line in the team profile's "By game" list: "12 races · 2 wins · average 4.1 pts · average place 5.8". */
export function gameLine(game: StatsGame): string {
  const average = game.averagePoints ?? (game.races > 0 ? Math.round((game.points / game.races) * 10) / 10 : null);
  return [
    countText('race', game.races),
    countText('win', game.wins),
    average == null ? null : tr('site.stats.averagePts', { n: average }),
    game.averagePlace == null ? null : tr('site.stats.averagePlaceN', { n: game.averagePlace }),
  ].filter(Boolean).join(' · ');
}
