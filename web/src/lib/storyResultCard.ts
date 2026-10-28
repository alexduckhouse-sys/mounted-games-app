// Unused in web UI yet — reserved for iOS / upcoming wiring
import type { StandingRow } from '../types';
import type { ToplistRow } from './toplist';
import { localOrdinal } from './ordinalText';
import { tr } from '../i18n/translate';
import { formatPoints } from './formatPoints';

export const STORY_CARD_WIDTH = 1080;
export const STORY_CARD_HEIGHT = 1920;

export interface StoryPodiumEntry {
  rank: number;
  teamName: string;
  clubName?: string | null;
  totalPoints: number;
  wins: number;
}

export interface StoryFeaturedTeam {
  teamId: number;
  rank: number;
  teamName: string;
  clubName?: string | null;
  totalPoints: number;
  wins: number;
  racesRun: number;
  finalTierLabel?: string | null;
}

export interface StoryLeaderboardLine {
  rank: number;
  teamName: string;
  totalPoints: number;
}

export interface StoryResultCardData {
  competitionName: string;
  sectionName: string;
  dateLabel?: string | null;
  locationLabel?: string | null;
  isProvisional: boolean;
  podium: StoryPodiumEntry[];
  featuredTeam: StoryFeaturedTeam | null;
  leaderboard: StoryLeaderboardLine[];
  captionText: string;
  suggestedFileName: string;
}

function finalTierName(tier: number | null | undefined): string | null {
  if (tier == null || tier < 0 || tier > 25) return null;
  return `${String.fromCharCode(65 + tier)} Final`;
}

function slugifyFilePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

export function buildStoryCaption(data: Omit<StoryResultCardData, 'captionText' | 'suggestedFileName'>): string {
  const statusTag = data.isProvisional ? ` (${tr('competition.story.provisionalTag')})` : '';
  const header = `${data.competitionName} — ${data.sectionName}${statusTag}`;
  if (data.featuredTeam) {
    const ft = data.featuredTeam;
    const tierPart = ft.finalTierLabel ? ` · ${ft.finalTierLabel}` : '';
    return `${header}\n${ft.teamName}: #${ft.rank} (${tr('competition.toplist.ptsValue', { points: formatPoints(ft.totalPoints) })}, ${tr('competition.story.wins', { count: ft.wins })}${tierPart})`;
  }
  const podiumLines = data.podium.map((p) => {
    return `${localOrdinal(p.rank)} ${p.teamName}, ${tr('competition.toplist.ptsValue', { points: formatPoints(p.totalPoints) })}`;
  });
  return [header, ...podiumLines].join('\n');
}

export function buildStoryResultCardData(params: {
  competitionName: string;
  sectionName: string;
  standings: readonly StandingRow[];
  /** Canonical displayed positions, including joint places and gaps after a tie. */
  ranking?: readonly Pick<ToplistRow, 'teamId' | 'position'>[];
  featuredTeamId?: number | null;
  dateLabel?: string | null;
  locationLabel?: string | null;
  isProvisional?: boolean;
}): StoryResultCardData {
  const positions = new Map(params.ranking?.map((row) => [row.teamId, row.position]));
  const activeRows = params.standings.filter((r) => !r.withdrawn);
  if (positions.size > 0) activeRows.sort((a, b) => (positions.get(a.teamId) ?? Infinity) - (positions.get(b.teamId) ?? Infinity));
  const rankOf = (row: StandingRow, index: number) => positions.get(row.teamId) ?? index + 1;
  const podium: StoryPodiumEntry[] = activeRows.slice(0, 3).map((row, index) => ({
    rank: rankOf(row, index),
    teamName: row.teamName,
    clubName: row.clubName || null,
    totalPoints: row.totalPoints,
    wins: row.wins,
  }));

  let featuredTeam: StoryFeaturedTeam | null = null;
  if (params.featuredTeamId != null) {
    const idx = activeRows.findIndex((r) => r.teamId === params.featuredTeamId);
    if (idx >= 0) {
      const row = activeRows[idx];
      featuredTeam = {
        teamId: row.teamId,
        rank: rankOf(row, idx),
        teamName: row.teamName,
        clubName: row.clubName || null,
        totalPoints: row.totalPoints,
        wins: row.wins,
        racesRun: row.racesRun,
        finalTierLabel: finalTierName(row.finalTier),
      };
    }
  }

  const leaderboard: StoryLeaderboardLine[] = activeRows.slice(0, 8).map((row, idx) => ({
    rank: rankOf(row, idx),
    teamName: row.teamName,
    totalPoints: row.totalPoints,
  }));

  const base = {
    competitionName: params.competitionName.trim() || 'Mounted Games',
    sectionName: params.sectionName.trim() || 'Standings',
    dateLabel: params.dateLabel?.trim() || null,
    locationLabel: params.locationLabel?.trim() || null,
    isProvisional: Boolean(params.isProvisional),
    podium,
    featuredTeam,
    leaderboard,
  };

  const captionText = buildStoryCaption(base);
  const slug = slugifyFilePart(
    featuredTeam
      ? `${base.competitionName}-${base.sectionName}-${featuredTeam.teamName}-story`
      : `${base.competitionName}-${base.sectionName}-story`,
  );

  return {
    ...base,
    captionText,
    suggestedFileName: `${slug}.png`,
  };
}

const DISPLAY_FONT = "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif";
const BODY_FONT = "'Barlow', system-ui, -apple-system, 'Segoe UI', sans-serif";
const NAVY = '#0B1A2E';
const INK = '#F5F7FA';
const MUTED = '#A9B8CC';
const RULE = 'rgba(169, 184, 204, 0.22)';
const MARGIN = 80;
const RIGHT = STORY_CARD_WIDTH - MARGIN;

/** British rosette colours by place: red, blue, yellow, green, pink, purple, brown, then light green. */
export const ROSETTE_COLOURS = ['#C8102E', '#1D4FA3', '#F2C230', '#2E8B4E', '#E57AA5', '#6B3FA0', '#7A4A2A', '#8CC63F'];

/** The rosette for a place, with the ink that reads on it. */
export function rosetteFor(rank: number): { fill: string; ink: string } {
  const fill = ROSETTE_COLOURS[rank - 1] ?? '#5B6B80';
  return { fill, ink: rank === 3 || rank === 8 ? NAVY : '#FFFFFF' };
}

type Measurer = Pick<CanvasRenderingContext2D, 'measureText'>;

/** Shortens text with an ellipsis until it fits the width. */
export function fitText(ctx: Measurer, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1).trimEnd();
  return `${cut}…`;
}

/** Splits text into at most `maxLines` lines that fit the width; whatever doesn't fit ends the last line with an ellipsis. */
export function wrapText(ctx: Measurer, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept[maxLines - 1] = lines.slice(maxLines - 1).join(' ');
  return kept.map((line) => fitText(ctx, line, maxWidth));
}

/** A rosette: a pleated disc, optionally with two ribbon tails, and the place written in the middle. */
function drawRosette(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, rank: number, withTails: boolean) {
  const { fill, ink } = rosetteFor(rank);
  ctx.fillStyle = fill;
  if (withTails) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * radius * 0.15, cy + radius * 0.4);
      ctx.lineTo(cx + side * radius * 0.75, cy + radius * 1.55);
      ctx.lineTo(cx + side * radius * 0.42, cy + radius * 1.38);
      ctx.lineTo(cx + side * radius * 0.22, cy + radius * 1.6);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.beginPath();
  const pleats = 24;
  for (let i = 0; i <= pleats * 2; i++) {
    const angle = (Math.PI * i) / pleats;
    const r = i % 2 === 0 ? radius : radius * 0.9;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = Math.max(2, radius * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(radius * 0.62)}px ${DISPLAY_FONT}`;
  ctx.fillText(localOrdinal(rank), cx, cy + radius * 0.04);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Points right-aligned, with a smaller "pts". */
function drawPoints(ctx: CanvasRenderingContext2D, points: number, baseline: number, size: number) {
  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = `600 ${Math.round(size * 0.45)}px ${BODY_FONT}`;
  const unit = ` ${tr('teams.team.ptsUnit')}`;
  ctx.fillText(unit, RIGHT, baseline);
  const unitWidth = ctx.measureText(unit).width;
  ctx.fillStyle = INK;
  ctx.font = `800 ${size}px ${DISPLAY_FONT}`;
  ctx.fillText(formatPoints(points), RIGHT - unitWidth, baseline);
  ctx.textAlign = 'left';
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/**
 * Draws a 1080×1920 (9:16 vertical social story) result card onto a canvas: the event and age group, then the
 * podium as rosettes, the next places as a list, and the featured team when there is one. The results are centred
 * in the space between the heading and the footer, so a short list doesn't leave the bottom of the card empty.
 */
export function renderStoryResultCardCanvas(
  data: StoryResultCardData,
  targetCanvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = targetCanvas ?? document.createElement('canvas');
  canvas.width = STORY_CARD_WIDTH;
  canvas.height = STORY_CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const bg = ctx.createLinearGradient(0, 0, 0, STORY_CARD_HEIGHT);
  bg.addColorStop(0, '#13284A');
  bg.addColorStop(0.45, NAVY);
  bg.addColorStop(1, '#081321');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_CARD_WIDTH, STORY_CARD_HEIGHT);

  // Heading: status, event name (two lines at most), then age group, place and date.
  ctx.font = `700 30px ${BODY_FONT}`;
  const status = data.isProvisional ? tr('competition.story.provisionalBadge') : tr('competition.story.officialBadge');
  ctx.fillStyle = data.isProvisional ? 'rgba(242, 194, 48, 0.18)' : 'rgba(46, 139, 78, 0.24)';
  roundedRect(ctx, MARGIN, 110, ctx.measureText(status).width + 56, 58, 29);
  ctx.fillStyle = data.isProvisional ? '#F2C230' : '#7FD69B';
  ctx.fillText(status, MARGIN + 28, 149);

  ctx.fillStyle = INK;
  ctx.font = `800 96px ${DISPLAY_FONT}`;
  let y = 290;
  for (const line of wrapText(ctx, data.competitionName, RIGHT - MARGIN, 2)) { ctx.fillText(line, MARGIN, y); y += 100; }
  ctx.fillStyle = MUTED;
  ctx.font = `600 40px ${BODY_FONT}`;
  ctx.fillText(fitText(ctx, [data.sectionName, data.locationLabel, data.dateLabel].filter(Boolean).join(' · '), RIGHT - MARGIN), MARGIN, y - 22);
  const headingBottom = y + 30;
  ctx.fillStyle = RULE;
  ctx.fillRect(MARGIN, headingBottom, RIGHT - MARGIN, 2);

  const footerTop = STORY_CARD_HEIGHT - 150;
  const extraRows = data.leaderboard.slice(3, 8);
  const featuredHeight = data.featuredTeam ? 300 : 0;
  const listHeight = extraRows.length > 0 ? 40 + extraRows.length * 92 : 0;
  const blockHeight = featuredHeight + data.podium.length * 210 + listHeight;
  y = headingBottom + Math.max(60, (footerTop - headingBottom - blockHeight) / 2);

  if (data.featuredTeam) {
    const ft = data.featuredTeam;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    roundedRect(ctx, MARGIN, y, RIGHT - MARGIN, 250, 28);
    drawRosette(ctx, MARGIN + 110, y + 115, 78, ft.rank, true);
    ctx.fillStyle = MUTED;
    ctx.font = `700 30px ${BODY_FONT}`;
    ctx.fillText(tr('competition.story.overall', { place: localOrdinal(ft.rank) }), MARGIN + 230, y + 80);
    ctx.fillStyle = INK;
    ctx.font = `800 64px ${DISPLAY_FONT}`;
    ctx.fillText(fitText(ctx, ft.teamName, RIGHT - MARGIN - 260), MARGIN + 230, y + 150);
    ctx.fillStyle = MUTED;
    ctx.font = `600 34px ${BODY_FONT}`;
    const stats = [tr('competition.toplist.ptsValue', { points: formatPoints(ft.totalPoints) }), tr('competition.story.wins', { count: ft.wins }), ft.finalTierLabel].filter(Boolean).join(' · ');
    ctx.fillText(fitText(ctx, stats, RIGHT - MARGIN - 260), MARGIN + 230, y + 200);
    y += featuredHeight;
  }

  for (const item of data.podium) {
    drawRosette(ctx, MARGIN + 74, y + 80, 70, item.rank, true);
    ctx.fillStyle = INK;
    ctx.font = `800 62px ${DISPLAY_FONT}`;
    ctx.fillText(fitText(ctx, item.teamName, RIGHT - MARGIN - 420), MARGIN + 190, y + (item.clubName ? 82 : 102));
    if (item.clubName) {
      ctx.fillStyle = MUTED;
      ctx.font = `600 32px ${BODY_FONT}`;
      ctx.fillText(fitText(ctx, item.clubName, RIGHT - MARGIN - 420), MARGIN + 190, y + 130);
    }
    drawPoints(ctx, item.totalPoints, y + 104, 72);
    y += 210;
  }

  if (extraRows.length > 0) {
    ctx.fillStyle = RULE;
    ctx.fillRect(MARGIN, y + 4, RIGHT - MARGIN, 2);
    y += 40;
    for (const row of extraRows) {
      drawRosette(ctx, MARGIN + 34, y + 44, 30, row.rank, false);
      ctx.fillStyle = INK;
      ctx.font = `700 42px ${BODY_FONT}`;
      ctx.fillText(fitText(ctx, row.teamName, RIGHT - MARGIN - 300), MARGIN + 100, y + 60);
      drawPoints(ctx, row.totalPoints, y + 60, 46);
      y += 92;
    }
  }

  ctx.fillStyle = MUTED;
  ctx.font = `600 30px ${BODY_FONT}`;
  ctx.fillText(tr('competition.story.footer'), MARGIN, STORY_CARD_HEIGHT - 84);

  return canvas;
}

/** Makes sure the app's fonts are ready before drawing, so the card doesn't fall back to system type. */
export async function loadStoryCardFonts(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== 'function') return;
  try {
    await Promise.all([`800 96px ${DISPLAY_FONT}`, `700 42px ${BODY_FONT}`, `600 40px ${BODY_FONT}`].map((font) => fonts.load(font)));
  } catch {
    // Drawing with the fallback fonts is fine.
  }
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/** Draws the card as a PNG, or null when this browser can't draw one. */
export async function makeStoryResultCardPng(data: StoryResultCardData): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  await loadStoryCardFonts();
  return canvasToPngBlob(renderStoryResultCardCanvas(data));
}

function storyCardFile(blob: Blob, data: StoryResultCardData): File {
  return new File([blob], data.suggestedFileName, { type: 'image/png' });
}

/** True when the phone's share sheet takes image files, so a Share button can hand the card straight over. */
export function canShareStoryResultCard(blob: Blob, data: StoryResultCardData): boolean {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav || typeof nav.share !== 'function') return false;
  return typeof nav.canShare === 'function' ? nav.canShare({ files: [storyCardFile(blob, data)] }) : true;
}

/** Opens the share sheet with the card. Call it straight from a tap: iOS refuses a share that follows other async work. */
export async function shareStoryResultCardPng(blob: Blob, data: StoryResultCardData): Promise<void> {
  await navigator.share({ title: `${data.competitionName} — ${data.sectionName}`, text: data.captionText, files: [storyCardFile(blob, data)] });
}

export function downloadStoryResultCardPng(blob: Blob, data: StoryResultCardData): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = data.suggestedFileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function shareOrDownloadStoryResultCard(
  data: StoryResultCardData,
): Promise<'shared' | 'downloaded' | 'unsupported'> {
  const blob = await makeStoryResultCardPng(data);
  if (!blob) return 'unsupported';
  if (canShareStoryResultCard(blob, data)) {
    await shareStoryResultCardPng(blob, data);
    return 'shared';
  }
  downloadStoryResultCardPng(blob, data);
  return 'downloaded';
}
