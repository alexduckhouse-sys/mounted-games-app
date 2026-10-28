import type { Translate } from '../i18n/translate';
import { formatDelayDuration } from './time';
import { localOrdinal } from './ordinalText';
import type { ToplistRow } from './toplist';
import type { TimetableStatus } from './timetableRows';

/**
 * The small line under a team's name in the embedded standings, in the language of the page. It follows
 * `toplistNote`, with the words in the catalogue. The tie-break reason is written by the toplist in English and
 * is shown as it comes.
 */
export function embedToplistNote(row: ToplistRow, t: Translate): string | null {
  const tack = row.bonus > 0 ? t('competition.toplist.tackBonus', { count: row.bonus }) : null;
  const tie = !row.withdrawn && !row.runoff ? row.tieBreakReason ?? null : null;
  return [standingNote(row, t), tie, tack].filter(Boolean).join(' · ') || null;
}

function standingNote(row: ToplistRow, t: Translate): string | null {
  if (row.withdrawn) return t('competition.toplist.withdrawn');
  if (row.runoff) return t('screen.embed.jointRunoff', { place: localOrdinal(row.position) });
  if (row.neededUnavailable) return t('competition.toplist.unavailable');
  if (row.guaranteed) return t('competition.toplist.guaranteed');
  if (row.toStay != null) return t('competition.toplist.toStay', { count: row.toStay });
  if (row.needed != null) return t(row.neededForRunoff ? 'competition.toplist.neededRunoff' : 'competition.toplist.neededFinal', { count: row.needed });
  if (row.racesLeft > 0) return t('competition.toplist.racesLeft', { count: row.racesLeft });
  return null;
}

/** "Finished", "On now", "+10 min" or "On time" for a timetable line. */
export function timetableStatusText(status: TimetableStatus, delayMinutes: number, t: Translate): string {
  if (status === 'finished') return t('common.finished');
  if (status === 'live') return t('competition.timetable.statusLive');
  return status === 'late' ? `+${formatDelayDuration(delayMinutes)}` : t('competition.timetable.statusOnTime');
}
