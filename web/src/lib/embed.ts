import type { CompetitionDetail, Heat, Session, StandingRow } from '../types';
import type { StandingView } from '../pages/seasons/seasonViewTypes';
import { displaySectionName } from './section';
import { dayKey } from './timetableDay';
import { activeLocale, tr } from '../i18n/translate';
import { sessionOrdinals, type TimetableGroup, type TimetableRow } from './timetableRows';

/**
 * The embeddable results widget: pages under /embed/ that a club frames on its own site. Everything here
 * is pure so it can be tested without a browser. The widget only ever reads public data.
 */

export type EmbedView = 'standings' | 'results' | 'timetable';
export type EmbedTheme = 'light' | 'dark';

export type EmbedTarget =
  | { kind: 'competition'; id: number }
  | { kind: 'season'; id: string };

export interface EmbedOptions {
  /** Six lower-case hex digits without the hash, or null for the theme's own colour. */
  accent: string | null;
  theme: EmbedTheme;
  /** One age group only, or null for all of them. */
  section: number | null;
}

export const EMBED_VIEWS: { id: EmbedView; label: string; height: number }[] = [
  { id: 'standings', label: 'Standings', height: 520 },
  { id: 'results', label: 'Latest results', height: 520 },
  { id: 'timetable', label: 'Timetable', height: 600 },
];

export const SEASON_EMBED_HEIGHT = 520;
export const MIN_EMBED_HEIGHT = 240;
export const MAX_EMBED_HEIGHT = 1200;

/** Pages under /embed/ get their own, minimal app: no sign-in, no saved settings, no service worker. */
export function isEmbedPath(pathname: string): boolean {
  return pathname.startsWith('/embed/');
}

/** A strict colour check: three or six hex digits, with or without a leading hash. Nothing else is accepted. */
export function normaliseAccent(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value);
  if (!match) return null;
  const digits = match[1].toLowerCase();
  return digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
}

/** Reads the options a club can put in the address. Anything unrecognised falls back to the default. */
export function parseEmbedOptions(search: string | URLSearchParams): EmbedOptions {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const section = params.get('section');
  return {
    accent: normaliseAccent(params.get('accent')),
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    section: section !== null && /^[1-9]\d{0,8}$/.test(section) ? Number(section) : null,
  };
}

export function embedPath(target: EmbedTarget, view: EmbedView = 'standings'): string {
  return target.kind === 'season'
    ? `/embed/seasons/${encodeURIComponent(target.id)}/standings`
    : `/embed/competitions/${target.id}/${view}`;
}

/** The query string for the options that differ from the defaults, with its leading "?" (or nothing). */
export function embedSearch(options: Partial<EmbedOptions>): string {
  const params = new URLSearchParams();
  const accent = normaliseAccent(options.accent);
  if (accent) params.set('accent', accent);
  if (options.theme === 'dark') params.set('theme', 'dark');
  if (options.section != null && Number.isSafeInteger(options.section) && options.section > 0) params.set('section', String(options.section));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function embedUrl(origin: string, target: EmbedTarget, view: EmbedView, options: Partial<EmbedOptions>): string {
  return `${origin}${embedPath(target, view)}${embedSearch(options)}`;
}

/** The ordinary page the "Powered by" link opens. */
export function embedHomePath(target: EmbedTarget, view: EmbedView): string {
  if (target.kind === 'season') return `/seasons/${encodeURIComponent(target.id)}`;
  return view === 'standings' ? `/competitions/${target.id}/toplists` : `/competitions/${target.id}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function clampEmbedHeight(value: number): number {
  if (!Number.isFinite(value)) return EMBED_VIEWS[0].height;
  return Math.min(MAX_EMBED_HEIGHT, Math.max(MIN_EMBED_HEIGHT, Math.round(value)));
}

/** The snippet a club pastes in. A fixed height keeps it working without any script on their page. */
export function iframeSnippet(url: string, title: string, height: number): string {
  return `<iframe src="${escapeAttribute(url)}" title="${escapeAttribute(title)}" width="100%" height="${clampEmbedHeight(height)}" style="border:0;max-width:100%" loading="lazy"></iframe>`;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const SURFACE: Record<EmbedTheme, Rgb> = { light: [255, 255, 255], dark: [21, 30, 46] };
const INK: Rgb = [33, 33, 33];
const channels = (rgb: Rgb) => rgb.join(' ');

export interface EmbedColours {
  /** For text and lines on the page: the club's colour, nudged until it can be read on the theme's background. */
  text: string;
  /** For filled buttons and chips: exactly the club's colour. */
  fill: string;
  /** Text on a fill: white or near-black, whichever reads better. */
  onFill: string;
}

/** CSS colour channels ("r g b") for the club's accent, or null when there is no accent to apply. */
export function embedColours(accent: string | null, theme: EmbedTheme): EmbedColours | null {
  if (!accent) return null;
  const fill = hexToRgb(accent);
  const surface = SURFACE[theme];
  const towards: Rgb = theme === 'dark' ? [255, 255, 255] : [0, 0, 0];
  let text = fill;
  for (let step = 1; step <= 20 && contrastRatio(text, surface) < 4.5; step += 1) {
    text = fill.map((channel, i) => Math.round(channel + (towards[i] - channel) * (step / 20))) as Rgb;
  }
  const onFill = contrastRatio([255, 255, 255], fill) >= contrastRatio(INK, fill) ? ([255, 255, 255] as Rgb) : INK;
  return { text: channels(text), fill: channels(fill), onFill: channels(onFill) };
}

/**
 * How often to look for changes. The widget polls rather than holding a live connection, because it may sit
 * on many club pages at once; unchanged answers come back as a 304. While nothing is on, it barely polls.
 */
export function embedPollMs(live: boolean, failures: number): number {
  if (failures >= 3) return 300_000;
  if (failures > 0) return 60_000;
  return live ? 30_000 : 180_000;
}

/** Hours and minutes in the viewer's own zone. */
export function clockText(date: Date): string {
  return date.toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' });
}

const finalWording = /\bfinals?\b/i;
const isRaceSession = (session: Session) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
const isFinalHeat = (session: Session, heat: Heat) => heat.raceRoundStage === 2 || finalWording.test(heat.label ?? '') || finalWording.test(session.name);

export interface EmbedHeatRow { teamId: number; teamName: string; place: number | null; points: number | null }
export interface EmbedHeatResult {
  key: string;
  title: string;
  /** Every race in the heat has been scored. */
  complete: boolean;
  rows: EmbedHeatRow[];
}

/**
 * The heats with results so far, newest first: teams by the points they scored in the heat, tied teams
 * sharing a place. Qualifier heats are left out, as they are on the public timetable.
 */
export function recentHeatResults(sessions: Session[], sectionId: number | null): EmbedHeatResult[] {
  const ordinals = sessionOrdinals(sessions);
  const found: { order: number; result: EmbedHeatResult }[] = [];
  for (const session of sessions) {
    if (!isRaceSession(session) || (sectionId != null && session.competitionSectionId !== sectionId)) continue;
    const heats = [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex);
    heats.forEach((heat, index) => {
      if (heat.raceRoundStage === 1) return;
      const results = heat.races.flatMap((race) => race.results);
      if (results.length === 0) return;
      const totals = new Map<number, { teamName: string; points: number }>();
      for (const result of results) {
        const known = totals.get(result.teamId);
        totals.set(result.teamId, { teamName: result.teamName, points: (known?.points ?? 0) + result.points });
      }
      const ranked = [...totals].map(([teamId, value]) => ({ teamId, ...value })).sort((a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName));
      const rows: EmbedHeatRow[] = ranked.map((item) => ({ teamId: item.teamId, teamName: item.teamName, place: ranked.findIndex((other) => other.points === item.points) + 1, points: item.points }));
      for (const entry of heat.entries) if (!totals.has(entry.teamId)) rows.push({ teamId: entry.teamId, teamName: entry.teamName, place: null, points: null });
      const section = displaySectionName(session.sectionName || session.name);
      const label = heat.label?.trim() || `Heat ${index + 1}`;
      const title = isFinalHeat(session, heat)
        ? [section, finalWording.test(label) ? label : `Final · ${label}`].join(' · ')
        : [section, `Session ${ordinals.get(session.id) ?? 1}`, label].join(' · ');
      found.push({
        order: session.orderIndex * 10_000 + heat.orderIndex,
        result: { key: `heat-${heat.id}`, title, complete: heat.races.length > 0 && heat.races.every((race) => race.isComplete), rows },
      });
    });
  }
  return found.sort((a, b) => b.order - a.order).map((item) => item.result);
}

const groupFinished = (group: { rows: TimetableRow[] }) => group.rows.length > 0 && group.rows.every((row) => row.status === 'finished');

/**
 * The timetable groups to show: everything still to come or running, plus the most recent finished group so
 * the widget never opens blank at the end of a day. `showAll` returns every group.
 */
export function visibleTimetableGroups(groups: TimetableGroup[], showAll: boolean): TimetableGroup[] {
  if (showAll) return groups;
  const lastFinished = groups.map((group, index) => (groupFinished(group) ? index : -1)).filter((index) => index >= 0).at(-1);
  return groups.filter((group, index) => !groupFinished(group) || index === lastFinished);
}

/** The calendar day a timetable row falls on, or the event's first day when it has no time yet. */
export function timetableRowDay(row: TimetableRow, startDay: string): string {
  return row.effective ? dayKey(row.effective) : startDay;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Shape checks for what the widget reads, so an unexpected answer shows an error instead of crashing the frame. */
export function isCompetitionDetail(value: unknown): value is CompetitionDetail {
  return isObject(value) && typeof value.id === 'number' && typeof value.name === 'string' && typeof value.startDate === 'string'
    && Array.isArray(value.sections) && Array.isArray(value.sessions) && Array.isArray(value.teams);
}

export function isStandingRows(value: unknown): value is StandingRow[] {
  return Array.isArray(value) && value.every((row) => isObject(row) && typeof row.teamId === 'number' && typeof row.totalPoints === 'number');
}

export function isSeasonSummary(value: unknown): value is { title: string; year: number; ageGroup: string; bestResultsToCount: number | null; rounds: { isIncluded: boolean }[] } {
  return isObject(value) && typeof value.title === 'string' && Array.isArray(value.rounds);
}

export function isSeasonStandings(value: unknown): value is { standings: StandingView[] } {
  return isObject(value) && Array.isArray(value.standings) && value.standings.every((row) => isObject(row) && typeof row.teamProfileId === 'string' && typeof row.totalPoints === 'number');
}

/** Heading for a timetable group: "Seniors · Session 2" for heats, the session's own name otherwise. */
export function timetableGroupTitle(group: TimetableGroup, ordinals: Map<number, number>): string | null {
  if (!group.race) return null;
  const section = displaySectionName(group.session.sectionName || group.session.name);
  return finalWording.test(group.session.name) || group.rows.some((row) => row.group === 'Finals') ? tr('screen.embed.sectionFinals', { section }) : tr('screen.embed.sectionSession', { section, n: ordinals.get(group.session.id) ?? 1 });
}
