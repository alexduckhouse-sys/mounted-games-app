import type { StandingRow } from '../types';
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
      .replace(/^-+|-+$/g, '') || 'mounted-games'
  );
}

export function buildStoryCaption(data: Omit<StoryResultCardData, 'captionText' | 'suggestedFileName'>): string {
  const statusTag = data.isProvisional ? ' (Provisional)' : '';
  const header = `${data.competitionName} — ${data.sectionName}${statusTag}`;
  if (data.featuredTeam) {
    const ft = data.featuredTeam;
    const tierPart = ft.finalTierLabel ? ` · ${ft.finalTierLabel}` : '';
    return `${header}\n${ft.teamName}: #${ft.rank} (${formatPoints(ft.totalPoints)} pts, ${ft.wins} ${ft.wins === 1 ? 'win' : 'wins'}${tierPart})`;
  }
  const podiumLines = data.podium.map((p) => {
    const medal = p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `#${p.rank}`;
    return `${medal} ${p.teamName} — ${formatPoints(p.totalPoints)} pts`;
  });
  return [header, ...podiumLines].join('\n');
}

export function buildStoryResultCardData(params: {
  competitionName: string;
  sectionName: string;
  standings: readonly StandingRow[];
  featuredTeamId?: number | null;
  dateLabel?: string | null;
  locationLabel?: string | null;
  isProvisional?: boolean;
}): StoryResultCardData {
  const activeRows = params.standings.filter((r) => !r.withdrawn);
  const podium: StoryPodiumEntry[] = activeRows.slice(0, 3).map((row, index) => ({
    rank: index + 1,
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
        rank: idx + 1,
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
    rank: idx + 1,
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

/**
 * Draws a 1080×1920 (9:16 vertical social story) result card onto a canvas.
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

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_CARD_HEIGHT);
  bg.addColorStop(0, '#090d16');
  bg.addColorStop(0.5, '#111827');
  bg.addColorStop(1, '#0f172a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_CARD_WIDTH, STORY_CARD_HEIGHT);

  // Header status badge
  ctx.fillStyle = data.isProvisional ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)';
  ctx.fillRect(80, 96, 360, 54);
  ctx.fillStyle = data.isProvisional ? '#fbbf24' : '#34d399';
  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillText(data.isProvisional ? 'PROVISIONAL RESULTS' : 'OFFICIAL RESULTS', 108, 132);

  // Competition & Section title
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 58px system-ui, -apple-system, sans-serif';
  ctx.fillText(data.competitionName.slice(0, 32), 80, 236);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 38px system-ui, -apple-system, sans-serif';
  const metaParts = [data.sectionName, data.locationLabel, data.dateLabel].filter(Boolean);
  ctx.fillText(metaParts.join(' · ').slice(0, 48), 80, 298);

  // Featured team spotlight (if selected)
  let cursorY = 370;
  if (data.featuredTeam) {
    const ft = data.featuredTeam;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.fillRect(80, cursorY, 920, 260);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '700 28px system-ui, -apple-system, sans-serif';
    ctx.fillText(`TEAM RESULT · #${ft.rank} OVERALL`, 120, cursorY + 64);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 54px system-ui, -apple-system, sans-serif';
    ctx.fillText(ft.teamName.slice(0, 28), 120, cursorY + 138);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 34px system-ui, -apple-system, sans-serif';
    const statsLine = [
      `${formatPoints(ft.totalPoints)} pts`,
      `${ft.wins} ${ft.wins === 1 ? 'win' : 'wins'}`,
      ft.finalTierLabel,
    ]
      .filter(Boolean)
      .join(' · ');
    ctx.fillText(statsLine, 120, cursorY + 204);
    cursorY += 310;
  }

  // Podium section
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 28px system-ui, -apple-system, sans-serif';
  ctx.fillText('PODIUM', 80, cursorY);
  cursorY += 32;

  const medalColours = ['#fbbf24', '#e2e8f0', '#d97706'];
  for (const item of data.podium) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(80, cursorY, 920, 128);

    ctx.fillStyle = medalColours[item.rank - 1] ?? '#94a3b8';
    ctx.font = '800 44px system-ui, -apple-system, sans-serif';
    ctx.fillText(`#${item.rank}`, 116, cursorY + 80);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 40px system-ui, -apple-system, sans-serif';
    ctx.fillText(item.teamName.slice(0, 26), 220, cursorY + 80);

    ctx.fillStyle = '#fbbf24';
    ctx.font = '800 40px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${formatPoints(item.totalPoints)} pts`, 800, cursorY + 80);

    cursorY += 150;
  }

  // Leaderboard rows (ranks 4..8)
  const extraRows = data.leaderboard.slice(3, 8);
  if (extraRows.length > 0) {
    cursorY += 28;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 26px system-ui, -apple-system, sans-serif';
    ctx.fillText('STANDINGS', 80, cursorY);
    cursorY += 28;

    for (const row of extraRows) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(80, cursorY, 920, 86);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 32px system-ui, -apple-system, sans-serif';
      ctx.fillText(`#${row.rank}`, 116, cursorY + 55);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 32px system-ui, -apple-system, sans-serif';
      ctx.fillText(row.teamName.slice(0, 30), 220, cursorY + 55);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 32px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${formatPoints(row.totalPoints)} pts`, 820, cursorY + 55);

      cursorY += 100;
    }
  }

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  ctx.fillText('Mounted Games · Live Results & Standings', 80, STORY_CARD_HEIGHT - 80);

  return canvas;
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

export async function shareOrDownloadStoryResultCard(
  data: StoryResultCardData,
): Promise<'shared' | 'downloaded' | 'unsupported'> {
  if (typeof document === 'undefined') return 'unsupported';
  const canvas = renderStoryResultCardCanvas(data);
  const blob = await canvasToPngBlob(canvas);
  if (!blob) return 'unsupported';

  const file = new File([blob], data.suggestedFileName, { type: 'image/png' });
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav && typeof nav.share === 'function') {
    const shareData: ShareData = {
      title: `${data.competitionName} — ${data.sectionName}`,
      text: data.captionText,
      files: [file],
    };
    const canShareFiles = typeof nav.canShare === 'function' ? nav.canShare({ files: [file] }) : true;
    if (canShareFiles) {
      await nav.share(shareData);
      return 'shared';
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = data.suggestedFileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
