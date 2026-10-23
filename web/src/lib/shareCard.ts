/**
 * Link previews. WhatsApp, Facebook, iMessage and friends fetch a shared link without running JavaScript,
 * so the tags they show have to be in the HTML we send them. `web/middleware.ts` uses this module to answer
 * those crawlers with a small page holding Open Graph and Twitter tags, built from the public share card
 * the API returns (`/api/share/...`). Everything here is pure so it can be tested without a browser.
 *
 * Every value that comes from the database passes through {@link escapeHtml} before it reaches the page,
 * and ids are matched against a strict pattern before they reach a URL, so a competition called
 * `"><script>` is shown as text and can't add markup.
 */

export const SITE_NAME = 'Mounted Games';
/** A branded 1200x630 image served from `web/public`; used for every card. */
export const SHARE_IMAGE_PATH = '/og/mounted-games.png';
export const SHARE_IMAGE_ALT = 'Mounted Games: live timetables, scores and results';
export const GENERIC_DESCRIPTION = 'Live timetables, scores and results for Mounted Games competitions.';

const TITLE_MAX = 90;
const DESCRIPTION_MAX = 200;

/** Link-preview crawlers only. Search engines run JavaScript, so they get the real app. */
const PREVIEW_CRAWLERS = /facebookexternalhit|facebot|whatsapp|twitterbot|slackbot|slack-imgproxy|linkedinbot|discordbot|telegrambot|skypeuripreview|applebot|pinterestbot|redditbot|mastodon|embedly|vkshare|viber|iframely|bluesky|cardyb|snapchat/i;

export function isPreviewCrawler(userAgent: string | null | undefined): boolean {
  return !!userAgent && PREVIEW_CRAWLERS.test(userAgent);
}

export type SharePage =
  | { kind: 'competition'; id: string }
  | { kind: 'team-profile'; id: string }
  | { kind: 'generic' };

const COMPETITION_PATH = /^\/competitions\/(\d{1,9})(?:\/[A-Za-z0-9/_-]*)?$/;
const TEAM_PROFILE_PATH = /^\/team-profiles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const GENERIC_PATHS = new Set(['/', '/competitions', '/competitions/past']);

/** Which share card a page path should show, or null for pages that get no special handling. */
export function sharePageFor(pathname: string): SharePage | null {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (GENERIC_PATHS.has(trimmed)) return { kind: 'generic' };
  const competition = COMPETITION_PATH.exec(trimmed);
  if (competition) return { kind: 'competition', id: competition[1] };
  const profile = TEAM_PROFILE_PATH.exec(trimmed);
  if (profile) return { kind: 'team-profile', id: profile[1].toLowerCase() };
  return null;
}

/** The API path (without the host) that holds the card's facts, or null for the generic card. */
export function shareApiPath(page: SharePage): string | null {
  if (page.kind === 'competition') return `/api/share/competitions/${page.id}`;
  if (page.kind === 'team-profile') return `/api/share/team-profiles/${page.id}`;
  return null;
}

export interface ShareCompetition {
  name: string;
  startDate: string;
  endDate: string | null;
  location: string | null;
  teamCount: number;
}

export interface ShareTeamProfile {
  displayName: string;
  clubName: string;
  eventCount: number;
}

export interface ShareCard {
  title: string;
  description: string;
  /** Absolute address of the page being shared. */
  url: string;
  /** Absolute address of the preview image. */
  image: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Escapes text for both element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c]);
}

/** Collapses line breaks and control characters, then shortens to `max` characters. */
export function tidy(value: string | null | undefined, max: number): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const flat = (value ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

const dayParts = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
const dayKey = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London' });

// Built from parts, because the punctuation between them (a comma after the weekday) differs between ICU versions.
function dayFormat(date: Date): string {
  const part = (type: string) => dayParts.formatToParts(date).find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
}

/** "Saturday 17 October 2026", or "Saturday 17 October 2026 to Sunday 18 October 2026" for a two-day event. */
export function dateText(start: string, end: string | null): string {
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return '';
  const to = end ? new Date(end) : null;
  if (!to || Number.isNaN(to.getTime()) || dayKey.format(from) === dayKey.format(to) || to < from) return dayFormat(from);
  return `${dayFormat(from)} to ${dayFormat(to)}`;
}

function absolute(origin: string, path: string): string {
  return `${origin}${path}`;
}

export function genericCard(origin: string, pathname: string): ShareCard {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const path = GENERIC_PATHS.has(trimmed) ? trimmed : '/';
  return {
    title: `${SITE_NAME}: live scores, timetables and results`,
    description: GENERIC_DESCRIPTION,
    url: absolute(origin, path),
    image: absolute(origin, SHARE_IMAGE_PATH),
  };
}

export function competitionCard(data: ShareCompetition, origin: string, id: string): ShareCard {
  const when = dateText(data.startDate, data.endDate);
  const where = tidy(data.location, 80);
  const lead = [when, where].filter(Boolean).join(' at ');
  const teams = Number.isFinite(data.teamCount) && data.teamCount > 0 ? ` ${data.teamCount} ${data.teamCount === 1 ? 'team' : 'teams'} entered.` : '';
  return {
    title: tidy(data.name, TITLE_MAX) || SITE_NAME,
    description: tidy(`${lead ? `${lead}.` : ''}${teams} Timetable, live scores and results.`, DESCRIPTION_MAX),
    url: absolute(origin, `/competitions/${id}`),
    image: absolute(origin, SHARE_IMAGE_PATH),
  };
}

export function teamProfileCard(data: ShareTeamProfile, origin: string, id: string): ShareCard {
  const club = tidy(data.clubName, 80);
  const events = Number.isFinite(data.eventCount) && data.eventCount > 0
    ? ` Results from ${data.eventCount} ${data.eventCount === 1 ? 'event' : 'events'}.` : '';
  return {
    title: tidy(data.displayName, TITLE_MAX) || SITE_NAME,
    description: tidy(`${club ? `${club}.` : ''}${events} Team results and history on ${SITE_NAME}.`, DESCRIPTION_MAX),
    url: absolute(origin, `/team-profiles/${id}`),
    image: absolute(origin, SHARE_IMAGE_PATH),
  };
}

/** Pulls the card facts out of an untrusted JSON body, or returns null when the shape is wrong. */
export function readCompetition(body: unknown): ShareCompetition | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || typeof b.startDate !== 'string') return null;
  return {
    name: b.name,
    startDate: b.startDate,
    endDate: typeof b.endDate === 'string' ? b.endDate : null,
    location: typeof b.location === 'string' ? b.location : null,
    teamCount: typeof b.teamCount === 'number' ? b.teamCount : 0,
  };
}

export function readTeamProfile(body: unknown): ShareTeamProfile | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.displayName !== 'string') return null;
  return {
    displayName: b.displayName,
    clubName: typeof b.clubName === 'string' ? b.clubName : '',
    eventCount: typeof b.eventCount === 'number' ? b.eventCount : 0,
  };
}

/**
 * The page a crawler receives: a title, the Open Graph and Twitter tags, and a plain link to the real page.
 * It carries no script and no stylesheet.
 */
export function renderCardPage(card: ShareCard): string {
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  const url = escapeHtml(card.url);
  const image = escapeHtml(card.image);
  const alt = escapeHtml(SHARE_IMAGE_ALT);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${alt}">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="${alt}">
</head>
<body>
<h1>${title}</h1>
<p>${description}</p>
<p><a href="${url}">Open on ${escapeHtml(SITE_NAME)}</a></p>
</body>
</html>
`;
}
