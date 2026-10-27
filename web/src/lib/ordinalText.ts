import { getActiveLang } from '../i18n/translate';

// Welsh ordinals up to 20; above that the ending depends on the last digits and is a best guess (see i18n/REVIEW.md).
const CY_SUFFIX = ['fed', 'af', 'il', 'ydd', 'ydd', 'ed', 'ed', 'fed', 'fed', 'fed', 'fed', 'eg', 'fed', 'eg', 'eg', 'fed', 'eg', 'eg', 'fed', 'eg', 'fed'];

/** 1st, 2nd, 3rd... in English; 1af, 2il, 3ydd... in Welsh; 1er, 2e, 3e... in French. */
export function localOrdinal(n: number, lang = getActiveLang()): string {
  if (lang === 'fr') return n === 1 ? `${n}er` : `${n}e`;
  if (lang === 'cy') return `${n}${n >= 0 && n <= 20 ? CY_SUFFIX[n] : 'ain'}`;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}
