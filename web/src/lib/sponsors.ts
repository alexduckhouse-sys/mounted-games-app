import type { Session, Sponsor, SponsorAdmin, SponsorTier } from '../types';

/**
 * Every place a sponsor can appear. This is the web's one list: the organiser's "Show on" boxes and every
 * render slot read it. `placement` is the bit in the API's `SponsorPlacement` enum (a test keeps the two
 * in step) and `key` is what a slot passes to `<SponsorStrip placement="…" />`.
 *
 * To add a place: add the enum value in `api/Entities/Sponsor.cs`, add one entry here, and put a slot where it
 * should show. See "Sponsor placements" in web/CLAUDE.md.
 */
export const SPONSOR_PLACEMENTS = [
  { key: 'Timetable', placement: 1, label: 'Timetable', description: 'Under the timetable.' },
  { key: 'Results', placement: 2, label: 'Results', description: 'Under the toplist.' },
  { key: 'Details', placement: 4, label: 'Details', description: 'On the details page.' },
  { key: 'Stream', placement: 8, label: 'Live video', description: 'A small logo over the video, any time.' },
  { key: 'BreakStream', placement: 16, label: 'Video breaks', description: 'Logo and name over the video during breaks and briefings.' },
  { key: 'SponsorPage', placement: 32, label: 'Sponsor page', description: 'The full list of sponsors.' },
] as const;

export type SponsorPlacementKey = (typeof SPONSOR_PLACEMENTS)[number]['key'];

/** The bit for a placement key. */
export function placementBit(key: SponsorPlacementKey): number {
  return SPONSOR_PLACEMENTS.find((p) => p.key === key)!.placement;
}

export const hasPlacement = (showOn: number, key: SponsorPlacementKey): boolean => (showOn & placementBit(key)) !== 0;

/** `showOn` with one place switched on or off. */
export function withPlacement(showOn: number, key: SponsorPlacementKey, on: boolean): number {
  return on ? showOn | placementBit(key) : showOn & ~placementBit(key);
}

export const SPONSOR_TIERS: readonly { tier: SponsorTier; label: string }[] = [
  { tier: 0, label: 'Headline' }, { tier: 1, label: 'Major' }, { tier: 2, label: 'Supporter' },
];

const byOrder = (a: Sponsor, b: Sponsor) => a.tier - b.tier || a.sortOrder - b.sortOrder || a.id - b.id;

/** The sponsors that show in one place, headline tier first, then in the organiser's order. */
export function sponsorsFor(sponsors: readonly Sponsor[], key: SponsorPlacementKey): Sponsor[] {
  return sponsors.filter((s) => hasPlacement(s.showOn, key)).sort(byOrder);
}

/** Sponsors grouped by tier, in tier order, leaving out empty tiers. */
export function groupByTier(sponsors: readonly Sponsor[]): { tier: SponsorTier; label: string; sponsors: Sponsor[] }[] {
  const ordered = [...sponsors].sort(byOrder);
  return SPONSOR_TIERS.map(({ tier, label }) => ({ tier, label, sponsors: ordered.filter((s) => s.tier === tier) }))
    .filter((group) => group.sponsors.length > 0);
}

export function isHttpsLink(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Where the logo is fetched from: the API path, in front of the API's own address when the build has one. */
export function logoSrc(path: string, apiBase?: string): string {
  if (!apiBase || !/^https?:\/\//.test(apiBase)) return path;
  return new URL(path, apiBase).href;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const LOGO_PATH = /^\/api\/competitions\/\d+\/sponsors\/\d+\/logo(\?v=\d+)?$/;

/** One sponsor from the API, or null when it is not usable. Links must be https and logos must be our own path. */
export function parseSponsor(raw: unknown): Sponsor | null {
  if (!isRecord(raw) || !Number.isInteger(raw.id) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    id: raw.id as number,
    name: raw.name,
    linkUrl: isHttpsLink(raw.linkUrl) ? raw.linkUrl : null,
    logoUrl: typeof raw.logoUrl === 'string' && LOGO_PATH.test(raw.logoUrl) ? raw.logoUrl : null,
    tier: raw.tier === 1 || raw.tier === 2 ? raw.tier : 0,
    sortOrder: Number.isInteger(raw.sortOrder) ? (raw.sortOrder as number) : 0,
    showOn: Number.isInteger(raw.showOn) ? (raw.showOn as number) : 0,
  };
}

/** The sponsor list from the API. Anything that is not a list (an older API's web page) is "no sponsors". */
export function parseSponsors(raw: unknown): Sponsor[] {
  return Array.isArray(raw) ? raw.map(parseSponsor).filter((s): s is Sponsor => s !== null) : [];
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
const dateText = (value: unknown) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

export function parseSponsorAdmin(raw: unknown): SponsorAdmin | null {
  const sponsor = parseSponsor(raw);
  if (!sponsor || !isRecord(raw)) return null;
  return {
    ...sponsor,
    isEnabled: raw.isEnabled !== false,
    startsAt: dateText(raw.startsAt),
    endsAt: dateText(raw.endsAt),
    views: count(raw.views),
    seconds: count(raw.seconds),
  };
}

export function parseSponsorAdmins(raw: unknown): SponsorAdmin[] {
  return Array.isArray(raw) ? raw.map(parseSponsorAdmin).filter((s): s is SponsorAdmin => s !== null) : [];
}

/** A producer's instruction, relayed to every viewer as `sponsorControl`. Only "skip" exists. */
export function parseSponsorControl(raw: unknown): 'skip' | null {
  return isRecord(raw) && raw.action === 'skip' ? 'skip' : null;
}

// ---- counts ----

/** "Shown 1,234 times", with minutes on video when there are any. */
export function shownText(views: number, seconds: number): string {
  const times = `Shown ${views.toLocaleString('en-GB')} ${views === 1 ? 'time' : 'times'}`;
  return seconds >= 60 ? `${times} · ${Math.round(seconds / 60).toLocaleString('en-GB')} min on video` : times;
}

// ---- dates ----

/** Schedule status, matching the API's inclusive start and exclusive end. Use parsed admin data. */
export function sponsorStatus(
  sponsor: Pick<SponsorAdmin, 'isEnabled' | 'startsAt' | 'endsAt'>,
  now = Date.now(),
): 'Disabled' | 'Scheduled' | 'Active' | 'Expired' {
  if (!sponsor.isEnabled) return 'Disabled';
  if (sponsor.endsAt && Date.parse(sponsor.endsAt) <= now) return 'Expired';
  if (sponsor.startsAt && Date.parse(sponsor.startsAt) > now) return 'Scheduled';
  return 'Active';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A `yyyy-mm-dd` box as the moment the sponsor starts: midnight at the start of that day, in the device's zone. */
export function dateToStart(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toISOString() : null;
}

/** A `yyyy-mm-dd` box as the moment the sponsor stops: the end of that day, so the date shown is the last day on show. */
export function dateToEnd(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1).toISOString() : null;
}

export function startToDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function endToDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The words for a sponsor's dates, e.g. "From 1 Nov 2026 to 3 Nov 2026"; empty when it has none. */
export function datesText(startsAt: string | null, endsAt: string | null): string {
  const show = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const last = endsAt ? (() => { const d = new Date(endsAt); d.setDate(d.getDate() - 1); return d.toISOString(); })() : null;
  if (startsAt && last) return `${show(startsAt)} to ${show(last)}`;
  if (startsAt) return `From ${show(startsAt)}`;
  if (last) return `Until ${show(last)}`;
  return '';
}

// ---- the break cards on the live video ----

const isBreakKind = (session: Session) => session.isBreak || session.kind === 1 || session.kind === 2;

/**
 * What the timetable is on in one arena: the session in the arena now, otherwise the next one to run.
 * A session with no arena belongs to every arena. Null when everything has finished.
 */
export function currentItem(sessions: readonly Session[], arenaName: string): Session | null {
  const arena = arenaName.trim();
  const here = (session: Session) => !session.arenaName?.trim() || session.arenaName.trim() === arena;
  const ordered = sessions.filter(here).sort((a, b) => a.orderIndex - b.orderIndex);
  const onNow = ordered.filter((session) => session.status === 1);
  // A session named for this arena wins over one that applies to all of them.
  return onNow.find((session) => session.arenaName?.trim()) ?? onNow[0] ?? ordered.find((session) => session.status === 0) ?? null;
}

/** True while the timetable is on a break or briefing in this arena. */
export function onBreak(sessions: readonly Session[], arenaName: string): boolean {
  const item = currentItem(sessions, arenaName);
  return item !== null && isBreakKind(item);
}

export const BREAK_CARD_MS = 8_000;
export const STREAM_LOGO_MS = 10_000;

/** Which sponsor a rotation is on, and where it was last restarted (a skip). `anchor` 0 follows the clock, so every viewer agrees. */
export interface SponsorRotation { anchor: number; offset: number }
export const FRESH_ROTATION: SponsorRotation = { anchor: 0, offset: 0 };

export function rotationIndex(now: number, rotation: SponsorRotation, intervalMs: number, count: number): number {
  if (count <= 0) return -1;
  return (Math.floor(Math.max(0, now - rotation.anchor) / intervalMs) + rotation.offset) % count;
}

/** Moves on to the next sponsor now, and gives it a full turn. */
export function skipRotation(rotation: SponsorRotation, now: number, intervalMs: number, count: number): SponsorRotation {
  if (count <= 0) return rotation;
  return { anchor: now, offset: (rotationIndex(now, rotation, intervalMs, count) + 1) % count };
}

/** Milliseconds until the rotation next changes. */
export function msUntilNext(now: number, rotation: SponsorRotation, intervalMs: number): number {
  return intervalMs - (Math.max(0, now - rotation.anchor) % intervalMs);
}

// ---- logos ----

/** The size an image shrinks to so neither side is longer than `max`, keeping its shape. Never enlarges. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const LOGO_MAX_PIXELS = 512;
export const LOGO_MAX_BYTES = 200 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
