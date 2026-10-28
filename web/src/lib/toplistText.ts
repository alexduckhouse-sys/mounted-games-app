import type { Lang, Translate } from '../i18n/translate';
import type { ToplistRow } from './toplist';
import { effectiveStatus, RESULT_STATUS, statusLabel } from './resultStatus';
import { localOrdinal } from './ordinalText';

/** A place as a short ordinal in the chosen language: "1st" / "1af" / "1er", "2nd" / "2il" / "2e". */
export function ordinalText(n: number, lang: Lang): string {
  return localOrdinal(n, lang);
}

/**
 * The small line under a team's name on the toplist page, in the chosen language, or null. Ties and run-offs are
 * shown by a tint rather than words, and races left are not counted; otherwise the same rules as `toplistNote`.
 */
export function toplistNoteText(row: ToplistRow, t: Translate): string | null {
  const tack = row.bonus > 0 ? t('competition.toplist.tackBonus', { count: row.bonus }) : null;
  return [standingNote(row, t), tack].filter(Boolean).join(' · ') || null;
}

/** How the note reads: 'safe' (green) for a guaranteed place, 'need' (amber) for points still to get, otherwise plain. */
export function toplistNoteTone(row: ToplistRow): 'safe' | 'need' | null {
  if (row.withdrawn || row.neededUnavailable) return null;
  if (row.guaranteed) return 'safe';
  return row.toStay != null || row.needed != null ? 'need' : null;
}

function standingNote(row: ToplistRow, t: Translate): string | null {
  if (row.withdrawn) return t('competition.toplist.withdrawn');
  if (row.neededUnavailable) return t('competition.toplist.unavailable');
  if (row.guaranteed) return t('competition.toplist.guaranteed');
  if (row.toStay != null) return t('competition.toplist.toStay', { count: row.toStay });
  if (row.needed != null) return t(row.neededForRunoff ? 'competition.toplist.neededRunoff' : 'competition.toplist.neededFinal', { count: row.needed });
  return null;
}

/** "Eliminated", "Did not start" and so on in the chosen language; null for a team that finished. Mirrors `statusLabel`. */
export function resultStatusText(eliminated: boolean, status: number | null | undefined, t: Translate): string | null {
  const label = statusLabel(eliminated, status);
  if (label === null) return null;
  switch (effectiveStatus(eliminated, status)) {
    case RESULT_STATUS.DidNotStart: return t('competition.status.dns');
    case RESULT_STATUS.DidNotFinish: return t('competition.status.dnf');
    case RESULT_STATUS.Retired: return t('competition.status.retired');
    default: return t('competition.status.eliminated');
  }
}

/** A team-sheet block heading: "Session 2 · Heat A" has its "Session 2" in the chosen language; a final's name is shown as set. */
export function blockLabelText(label: string, t: Translate): string {
  const session = /^Session (\d+)(.*)$/s.exec(label);
  return session ? `${t('competition.toplist.sessionN', { n: session[1] })}${session[2]}` : label;
}

/** The small note beside a block's points ("not carried over" for a final) in the chosen language. */
export function blockNoteText(note: string | null, t: Translate): string | null {
  return note === 'not carried over' ? t('competition.toplist.notCarried') : note;
}

/** The hover title of a by-session column, which the toplist builds in English ("Session 2", "Finals", ...). */
export function sessionColumnTitle(title: string, t: Translate): string {
  const session = /^Session (\d+)$/.exec(title);
  if (session) return t('competition.toplist.sessionN', { n: session[1] });
  if (title === 'Finals') return t('competition.toplist.finals');
  if (title === 'Tack check bonus points') return t('competition.toplist.tackBonusTitle');
  return title;
}
