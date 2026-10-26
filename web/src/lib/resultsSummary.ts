import type { ResultsBook, ResultsBookStanding } from '../pages/eventTools/resultsBookTypes';
import { publicRiderName } from './riderNames';
import { ordinal } from './toplist';

export interface PublicSummaryRider {
  fullName: string;
  useInitialOnly?: boolean;
  horseName?: string | null;
  isReserve?: boolean;
}

export interface FormatPublicResultsSummaryOptions {
  /**
   * Optional roster of riders per team ID. Every rider's name is passed through
   * `publicRiderName(r)` so `useInitialOnly` minors never have their surname exposed.
   */
  ridersByTeamId?: ReadonlyMap<number, ReadonlyArray<PublicSummaryRider>> | Record<number, ReadonlyArray<PublicSummaryRider>>;
  /** Maximum number of teams to list per section (defaults to 6, covering A-Finalists + podium). */
  maxPerSection?: number;
}

function getTeamRiders(
  teamId: number,
  ridersByTeamId?: FormatPublicResultsSummaryOptions['ridersByTeamId'],
): ReadonlyArray<PublicSummaryRider> {
  if (!ridersByTeamId) return [];
  if (ridersByTeamId instanceof Map) {
    return (ridersByTeamId as ReadonlyMap<number, ReadonlyArray<PublicSummaryRider>>).get(teamId) ?? [];
  }
  return (ridersByTeamId as Record<number, ReadonlyArray<PublicSummaryRider>>)[teamId] ?? [];
}

function formatRiderRoster(riders: ReadonlyArray<PublicSummaryRider>): string {
  const parts: string[] = [];
  for (const r of riders) {
    const safeName = publicRiderName({ fullName: r.fullName, useInitialOnly: Boolean(r.useInitialOnly) });
    if (!safeName) continue;
    const pony = r.horseName?.trim();
    parts.push(pony ? `${safeName} (${pony})` : safeName);
  }
  return parts.join(', ');
}

function placePrefix(rank: number): string {
  if (rank === 1) return '🥇 1st:';
  if (rank === 2) return '🥈 2nd:';
  if (rank === 3) return '🥉 3rd:';
  return `${ordinal(rank)}:`;
}

function formatPoints(points: number): string {
  const value = Number.isInteger(points) ? String(points) : points.toFixed(1).replace(/\.0$/, '');
  return `${value} ${points === 1 ? 'pt' : 'pts'}`;
}

function selectSectionTopStandings(
  standings: ReadonlyArray<ResultsBookStanding>,
  maxPerSection: number,
): ResultsBookStanding[] {
  const active = standings.filter((s) => !s.withdrawn);
  const aFinalists = active.filter(
    (s) => s.finalLabel && s.finalLabel.trim().toLowerCase().startsWith('a final'),
  );
  if (aFinalists.length > 0) {
    return aFinalists.slice(0, maxPerSection);
  }
  return active.slice(0, maxPerSection);
}

/**
 * Formats a `ResultsBook` into clean, ready-to-paste public results summary text
 * for social media, WhatsApp, press reports, and branch newsletters.
 * Never includes private referee notes, and always formats rider names via `publicRiderName`.
 */
export function formatPublicResultsSummary(
  book: ResultsBook,
  options: FormatPublicResultsSummaryOptions = {},
): string {
  const { ridersByTeamId, maxPerSection = 6 } = options;
  const lines: string[] = [];

  const dateText = new Date(book.competition.startDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const venuePart = book.competition.location?.trim() ? ` · ${book.competition.location.trim()}` : '';
  lines.push(`🏆 ${book.competition.name}${venuePart} (${dateText})`);
  if (book.isProvisional) {
    lines.push('(Provisional results)');
  }

  for (const section of book.sections) {
    const topRows = selectSectionTopStandings(section.standings, maxPerSection);
    if (topRows.length === 0 && section.awards.length === 0) continue;

    lines.push('');
    lines.push(`── ${section.sectionName} ──`);

    for (const standing of topRows) {
      const clubSuffix =
        standing.clubName &&
        standing.clubName.trim().toLowerCase() !== standing.teamName.trim().toLowerCase()
          ? ` (${standing.clubName.trim()})`
          : '';
      const finalTag = standing.finalLabel?.trim() ? `${standing.finalLabel.trim()}, ` : '';
      const ridersText = formatRiderRoster(getTeamRiders(standing.teamId, ridersByTeamId));
      const rosterSuffix = ridersText ? ` — ${ridersText}` : '';
      lines.push(
        `${placePrefix(standing.rank)} ${standing.teamName}${clubSuffix} — ${finalTag}${formatPoints(standing.totalPoints)}${rosterSuffix}`,
      );
    }

    for (const award of section.awards) {
      const noteSuffix = award.note?.trim() ? ` (${award.note.trim()})` : '';
      lines.push(`🎖️ ${award.title}: ${award.recipient}${noteSuffix}`);
    }
  }

  if (book.eventAwards.length > 0) {
    lines.push('');
    lines.push('── Special Awards ──');
    for (const award of book.eventAwards) {
      const noteSuffix = award.note?.trim() ? ` (${award.note.trim()})` : '';
      lines.push(`🎖️ ${award.title}: ${award.recipient}${noteSuffix}`);
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Formats and copies the public results summary to the clipboard when available.
 */
export async function copyPublicResultsSummary(
  book: ResultsBook,
  options: FormatPublicResultsSummaryOptions = {},
): Promise<string> {
  const summary = formatPublicResultsSummary(book, options);
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(summary);
  }
  return summary;
}
