/**
 * "Teams Under 12" reads awkwardly — drop the word "Teams" wherever it sits
 * ("Senior Teams" -> "Senior"). "Pairs Under 12" and "Individual Under 12" keep theirs.
 */
export function displaySectionName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/\bteams?\b/gi, ' ').replace(/\s+/g, ' ').trim() || name;
}
