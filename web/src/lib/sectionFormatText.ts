import type { Translate } from '../i18n/translate';
import type { SectionFormat } from '../types';

/** "Pairs", "Teams" or "Individual" in the chosen language (`SectionFormatLabel` is the English). */
export function sectionFormatText(format: SectionFormat, t: Translate): string {
  return t(format === 1 ? 'site.format.pairs' : format === 2 ? 'site.format.teams' : 'site.format.individual');
}
