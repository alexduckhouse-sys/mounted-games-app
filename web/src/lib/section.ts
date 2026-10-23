/**
 * An age group's name: the age group first (a plural word such as "Juniors" made singular), then the format in the
 * plural: "Junior Individuals", "Novice Pairs", "Open Teams". Mirrors `SectionNaming` in the API: change both together.
 */
export type SectionFormatNumber = 1 | 2 | 3;

export const FORMAT_PLURAL: Record<SectionFormatNumber, string> = { 1: 'Pairs', 2: 'Teams', 3: 'Individuals' };

// A last word of four or more letters ending in a single "s": Juniors, Seniors, Novices.
const PLURAL_WORD = /(?:^|\s)[A-Za-z]{2,}[^sS\W]s$/i;

/** "Juniors" becomes "Junior"; anything else, such as "Under 12" or "Open", is kept as typed. */
export function singularAgeGroup(ageGroup: string): string {
  const text = ageGroup.trim();
  return PLURAL_WORD.test(text) ? text.slice(0, -1) : text;
}

export function sectionDisplayName(format: number, ageGroup: string): string {
  const plural = FORMAT_PLURAL[format as SectionFormatNumber] ?? FORMAT_PLURAL[2];
  const raw = ageGroup.trim();
  if (!raw || raw.toLowerCase() === plural.toLowerCase()) return plural;
  // Someone who typed "Senior Teams" as the age group doesn't get "Senior Teams Teams".
  if (raw.toLowerCase().endsWith(` ${plural.toLowerCase()}`)) return raw;
  return `${singularAgeGroup(raw)} ${plural}`;
}

const LEADING_FORMAT: ReadonlyArray<[RegExp, SectionFormatNumber]> = [
  [/^teams?\s+(.+)$/i, 2], [/^pairs?\s+(.+)$/i, 1], [/^individuals?\s+(.+)$/i, 3],
];

/**
 * How to show a stored name. Older names put the format first ("Teams Under 12", "Individual Juniors"); those read
 * "Under 12 Teams" and "Junior Individuals". Anything else is shown as it is.
 */
export function displaySectionName(name: string | null | undefined): string {
  const text = (name ?? '').replace(/\s+/g, ' ').trim();
  for (const [pattern, format] of LEADING_FORMAT) {
    const match = pattern.exec(text);
    if (match) return sectionDisplayName(format, match[1]);
  }
  return text;
}
