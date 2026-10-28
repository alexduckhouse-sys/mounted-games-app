import { activeLocale, tr } from '../../i18n/translate';
import { SPONSOR_PLACEMENTS, SPONSOR_TIERS, formatDurationHms, hasPlacement } from '../../lib/sponsors';
import type { MessageKey } from '../../i18n/en/index';
import type { SponsorTier } from '../../types';

export interface SponsorPlaceFigure { label: string; views: number; seconds: number }

export interface SponsorReportRow {
  id: number;
  name: string;
  logoUrl: string | null;
  linkUrl: string | null;
  tierLabel: string;
  totalViews: number;
  totalSeconds: number;
  /** The places the sponsor is switched on for. Says nothing about how many views each one got. */
  switchedOn: string[];
  /** Views by place, only when the API counted them by place; null means it did not, and nothing is worked out. */
  byPlace: SponsorPlaceFigure[] | null;
}

/** The names the report uses for the places the API counts. */
const PLACE_NAMES: Record<string, string> = {
  overview: 'Details page',
  standings: 'Results',
  timetable: 'Timetable',
  liveStreamOverlay: 'Live video',
  sponsorPage: 'Sponsor page',
};

const PLACE_KEYS: Record<string, MessageKey> = {
  'Details page': 'ops2.sr.place.details', Results: 'ops2.sr.place.results', Timetable: 'ops2.sr.place.timetable', 'Live video': 'ops2.sr.place.video',
  'Sponsor page': 'ops2.sr.place.sponsorPage', 'Video breaks': 'ops2.sr.place.breaks', Details: 'ops2.sr.place.detailsShort', Other: 'ops2.sr.place.other',
};
const TIER_KEYS: Record<string, MessageKey> = { Headline: 'ops2.sr.tier.headline', Major: 'ops2.sr.tier.major', Supporter: 'ops2.sr.tier.supporter' };

/** The words for a place or level in the language in use; anything the report doesn't know stays as the API sent it. */
export const placementText = (label: string): string => (PLACE_KEYS[label] ? tr(PLACE_KEYS[label]) : label);
export const tierText = (label: string): string => (TIER_KEYS[label] ? tr(TIER_KEYS[label]) : label);

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

function placeFigures(value: unknown): SponsorPlaceFigure[] | null {
  if (!Array.isArray(value)) return null;
  const figures: SponsorPlaceFigure[] = [];
  for (const item of value) {
    if (!isRaw(item)) continue;
    const views = num(item.views) ?? 0;
    const seconds = num(item.seconds) ?? 0;
    if (views === 0 && seconds === 0) continue;
    const key = str(item.key);
    figures.push({ label: (key && PLACE_NAMES[key]) || str(item.label) || 'Other', views, seconds });
  }
  return figures;
}

const tierRank = (label: string) => SPONSOR_TIERS.findIndex((t) => t.label === label);

/**
 * One row per sponsor. The organiser's list gives who the sponsors are and where they are switched on; the stats
 * report gives the counts. Views are split by place only when the API did it. Nothing is estimated.
 */
export function buildSponsorReportRows(rawStats: unknown, rawSponsors: unknown): SponsorReportRow[] {
  const statList: unknown[] = Array.isArray(rawStats) ? rawStats : isRaw(rawStats) && Array.isArray(rawStats.sponsors) ? rawStats.sponsors : [];
  const byId = new Map<number, { admin?: Raw; stat?: Raw }>();
  for (const item of Array.isArray(rawSponsors) ? rawSponsors : []) {
    if (isRaw(item) && typeof item.id === 'number') byId.set(item.id, { admin: item });
  }
  for (const item of statList) {
    if (!isRaw(item)) continue;
    const id = typeof item.sponsorId === 'number' ? item.sponsorId : typeof item.id === 'number' ? item.id : null;
    if (id !== null) byId.set(id, { ...byId.get(id), stat: item });
  }

  const rows: SponsorReportRow[] = [];
  for (const [id, { admin, stat }] of byId) {
    const name = (str(stat?.sponsorName) ?? str(stat?.name) ?? str(admin?.name))?.trim();
    if (!name) continue;
    const tierValue = stat?.tier ?? admin?.tier;
    const tier: SponsorTier = tierValue === 1 || tierValue === 2 ? tierValue : 0;
    const showOn = num(stat?.showOn) ?? num(admin?.showOn);
    rows.push({
      id,
      name,
      logoUrl: str(stat?.logoUrl) ?? str(admin?.logoUrl),
      linkUrl: str(stat?.linkUrl) ?? str(admin?.linkUrl),
      tierLabel: SPONSOR_TIERS.find((t) => t.tier === tier)?.label ?? 'Headline',
      totalViews: num(stat?.totalViews) ?? num(admin?.views) ?? 0,
      totalSeconds: num(stat?.totalSeconds) ?? num(admin?.seconds) ?? 0,
      switchedOn: showOn === null ? [] : SPONSOR_PLACEMENTS.filter((p) => hasPlacement(showOn, p.key)).map((p) => p.label),
      byPlace: placeFigures(stat?.placements),
    });
  }
  return rows.sort((a, b) => tierRank(a.tierLabel) - tierRank(b.tierLabel) || b.totalViews - a.totalViews || a.id - b.id);
}

/** "Timetable 12, Results 4", or a plain line saying why there is no split. */
export function placeFiguresText(row: SponsorReportRow): string {
  if (row.byPlace === null) return tr('ops2.sr.notByPlace');
  if (row.byPlace.length === 0) return tr('ops2.sr.noViews');
  return row.byPlace.map((p) => `${placementText(p.label)} ${p.views.toLocaleString(activeLocale())}`).join(', ');
}

export const SPONSOR_CSV_HEADER = ['Sponsor', 'Level', 'Total views', 'Time on video', 'Seconds on video', 'Switched on for', 'Views by place'];

export function sponsorCsvRows(rows: readonly SponsorReportRow[]): (string | number)[][] {
  return rows.map((row) => [
    row.name,
    row.tierLabel,
    row.totalViews,
    formatDurationHms(row.totalSeconds),
    row.totalSeconds,
    row.switchedOn.join(', ') || 'Not recorded',
    placeFiguresText(row),
  ]);
}
