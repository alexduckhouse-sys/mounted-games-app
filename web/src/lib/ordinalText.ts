import { getActiveLang } from '../i18n/translate.ts';

// Welsh ordinals up to 20; above that the ending depends on the last digits and is a best guess (see i18n/REVIEW.md).
const CY_SUFFIX = ['fed', 'af', 'il', 'ydd', 'ydd', 'ed', 'ed', 'fed', 'fed', 'fed', 'fed', 'eg', 'fed', 'eg', 'eg', 'fed', 'eg', 'eg', 'fed', 'eg', 'fed'];

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  if (n <= 0) return String(n);
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** 1st, 2nd, 3rd... in English; 1af, 2il, 3ydd... in Welsh; 1er, 2e, 3e... in French. */
export function localOrdinal(n: number, lang = getActiveLang()): string {
  if (n <= 0) return String(n);
  if (lang === 'fr') return n === 1 ? `${n}er` : `${n}e`;
  if (lang === 'cy') return `${n}${n <= 20 ? CY_SUFFIX[n] : 'ain'}`;
  return ordinal(n);
}

/** 1st, 2nd, 3rd... in the active language (single-argument helper safe for Array.prototype.map). */
export function ordinalPlace(place: number): string {
  return localOrdinal(place);
}
