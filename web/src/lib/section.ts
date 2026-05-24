/**
 * "Teams Under 12" reads awkwardly — drop the "Teams" prefix.
 * "Pairs Under 12" and "Individual Under 12" keep theirs.
 */
export function displaySectionName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/^Teams\s+/i, '').trim() || name;
}
