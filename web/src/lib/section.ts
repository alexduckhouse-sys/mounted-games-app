/**
 * An age group's name: for Pairs and Individuals, the age group first (a plural word such as "Juniors" made singular),
 * then the format in the plural ("Junior Individuals", "Novice Pairs"); for Teams, just the age group ("Juniors",
 * "Seniors", "Under 12", "Open"), or "Teams" when no age group is given. Mirrors `SectionNaming` in the API: change both together.
 */
export type SectionFormatNumber = 1 | 2 | 3;

export const FORMAT_PLURAL: Record<SectionFormatNumber, string> = { 1: 'Pairs', 2: 'Teams', 3: 'Individuals' };

// A last word of four or more letters ending in a single "s": Juniors, Seniors, Novices.
const PLURAL_WORD = /(?:^|\s)[A-Za-z]{2,}[^sS\W]s$/i;
const SINGULAR_TEAM_AGE = /\b(Junior|Senior|Novice)$/i;

/** "Juniors" becomes "Junior"; anything else, such as "Under 12" or "Open", is kept as typed. */
export function singularAgeGroup(ageGroup: string): string {
  const text = ageGroup.trim();
  return PLURAL_WORD.test(text) ? text.slice(0, -1) : text;
}

function teamAgeGroup(ageGroup: string): string {
  const stripped = ageGroup.trim().replace(/^teams?\s+|\s+teams?$/i, '').trim();
  if (!stripped || /^teams?$/i.test(stripped)) return 'Teams';
  return SINGULAR_TEAM_AGE.test(stripped) ? `${stripped}s` : stripped;
}

export function sectionDisplayName(format: number, ageGroup: string): string {
  const plural = FORMAT_PLURAL[format as SectionFormatNumber] ?? FORMAT_PLURAL[2];
  if (plural === 'Teams') return teamAgeGroup(ageGroup);
  const raw = ageGroup.trim();
  if (!raw || raw.toLowerCase() === plural.toLowerCase()) return plural;
  // Someone who typed "Senior Pairs" as the age group doesn't get "Senior Pairs Pairs".
  if (raw.toLowerCase().endsWith(` ${plural.toLowerCase()}`)) return raw;
  return `${singularAgeGroup(raw)} ${plural}`;
}

const LEADING_FORMAT: ReadonlyArray<[RegExp, SectionFormatNumber]> = [
  [/^teams?\s+(.+)$/i, 2], [/^pairs?\s+(.+)$/i, 1], [/^individuals?\s+(.+)$/i, 3],
];
const TRAILING_TEAMS = /^(.+)\s+teams?$/i;

/**
 * How to show a stored name. Older names put the format first ("Teams Under 12", "Individual Juniors") or appended
 * "Teams" ("Senior Teams", "Under 12 Teams"); teams show just the age group ("Under 12", "Seniors") while pairs and
 * individuals keep their format ("Junior Individuals"). Anything else is shown as it is.
 */
export function displaySectionName(name: string | null | undefined): string {
  const text = (name ?? '').replace(/\s+/g, ' ').trim();
  for (const [pattern, format] of LEADING_FORMAT) {
    const match = pattern.exec(text);
    if (match) return sectionDisplayName(format, match[1]);
  }
  const trailingTeams = TRAILING_TEAMS.exec(text);
  if (trailingTeams) return sectionDisplayName(2, trailingTeams[1]);
  return text;
}
