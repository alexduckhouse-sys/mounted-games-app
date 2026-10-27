import type { Lang, Translate } from '../i18n/translate';
import type { ToplistRow } from './toplist';
import { effectiveStatus, RESULT_STATUS, statusLabel } from './resultStatus';

// Welsh ordinals up to twenty; past that the number takes "ain".
const CY_ORDINALS = ['', '1af', '2il', '3ydd', '4ydd', '5ed', '6ed', '7fed', '8fed', '9fed', '10fed', '11eg', '12fed', '13eg', '14eg', '15fed', '16eg', '17eg', '18fed', '19eg', '20fed'];

/** A place as a short ordinal in the chosen language: "1st" / "1af" / "1er", "2nd" / "2il" / "2e". */
export function ordinalText(n: number, lang: Lang): string {
  if (lang === 'fr') return n === 1 ? '1er' : `${n}e`;
  if (lang === 'cy') return CY_ORDINALS[n] ?? `${n}ain`;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** The small line under a team's name in the chosen language (the same rules as `toplistNote`), or null. */
export function toplistNoteText(row: ToplistRow, t: Translate, lang: Lang): string | null {
  const tack = row.bonus > 0 ? t('competition.toplist.tackBonus', { count: row.bonus }) : null;
  return [standingNote(row, t, lang), tack].filter(Boolean).join(' · ') || null;
}

function standingNote(row: ToplistRow, t: Translate, lang: Lang): string | null {
  if (row.withdrawn) return t('competition.toplist.withdrawn');
  if (row.runoff) return t('competition.toplist.jointRunoff', { place: ordinalText(row.position, lang) });
  if (row.neededUnavailable) return t('competition.toplist.unavailable');
  if (row.needed != null) return t(row.neededForRunoff ? 'competition.toplist.neededRunoff' : 'competition.toplist.neededFinal', { n: row.needed });
  if (row.racesLeft > 0) return t('competition.toplist.racesLeft', { count: row.racesLeft });
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

/** The hover title of a by-session column, which the toplist builds in English ("Session 2", "Finals", ...). */
export function sessionColumnTitle(title: string, t: Translate): string {
  const session = /^Session (\d+)$/.exec(title);
  if (session) return t('competition.toplist.sessionN', { n: session[1] });
  if (title === 'Finals') return t('competition.toplist.finals');
  if (title === 'Tack check bonus points') return t('competition.toplist.tackBonusTitle');
  return title;
}
