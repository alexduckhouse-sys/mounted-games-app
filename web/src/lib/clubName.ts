/**
 * A team, rider or booking with no club is stored under the placeholder "Unaffiliated" (the API and the importer use
 * it). Screens show nothing for it rather than the word.
 */
export function isUnaffiliated(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim().toLowerCase();
  return trimmed === '' || trimmed === 'unaffiliated' || trimmed === 'no club';
}

/** The club name to show, or an empty string when there is no real club. */
export function clubLabel(name: string | null | undefined): string {
  return isUnaffiliated(name) ? '' : (name ?? '').trim();
}
