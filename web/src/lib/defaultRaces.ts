/**
 * The standard race lists a session can start with. The competition creator and the On the day page both use them,
 * so they live here once.
 */
export const ZONE_SENIORS = [
  'Bending', 'Hollywood Bowl Boule & Bucket', 'Bottle', 'Litter', 'Tally Ho Farm Ball & Socket', 'STRUK Pole',
  'PGSports UK Shopping Spree', 'Stepping Stones', 'Spell EGUK', 'Big Sack',
];
export const ZONE_JUNIORS = [
  'Bending', 'Hollywood Bowl Old Sock', 'Tally Ho Farm Ball & Socket', 'STRUK Pole (JV)', 'PGSports UK Shopping Spree',
  'Stepping Stones', 'Spell EGUK (JV)', '5 Flag',
];
export const ZONE_PAIRS = [
  'Bending', 'Hollywood Bowl Boule & Bucket', 'Bottle', 'Litter', 'Tally Ho Farm Ball & Socket', 'STRUK Pole',
  'PGSports UK Shopping Spree', 'Stepping Stones', 'EGUK Mug Changes', '5 Flag',
];
export const AREA_SENIORS = [
  'Bending', '5 Mug', 'Old Sock', 'Tally Ho Farm Ball & Socket', 'PGUK Pyramid', 'Hollywood Bowl Bottle', 'Stepping Stones', 'EGUK 5 Flag',
];
export const AREA_JUNIORS = [
  'Bending', 'Old Sock (junior version)', 'Tally Ho Farm Ball & Socket', 'PGUK Pyramid (junior version)',
  'Hollywood Bowl Bottle (junior version)', 'Stepping Stones', 'EGUK 5 Flag',
];
export const AREA_PAIRS = [
  'Bending', '2 Mug', 'Old Sock', 'Tally Ho Farm Ball & Socket', 'PGUK Pyramid', 'Hollywood Bowl Bottle', 'Stepping Stones', 'EGUK 5 Flag',
];
export const ZONE_INDIVIDUALS = [
  'Bending', 'Hollywood Bowl Boule & Bucket', 'Bottle', 'Litter', 'Tally Ho Farm Ball & Socket', 'STRUK Pole',
  'PGSports UK Shopping Spree', 'Stepping Stones', 'EGUK Mug Changes', '5 Flag',
];
export const AREA_INDIVIDUALS = [
  'Bending', '2 Mug', 'Old Sock', 'Tally Ho Farm Ball & Socket', 'PGUK Pyramid', 'Hollywood Bowl Bottle', 'Stepping Stones', 'EGUK 5 Flag',
];
export const TEAM_ONLY_RACES = new Set(['Big Sack', '5 Mug', 'Spell EGUK', 'Spell EGUK (JV)']);

export type RaceScope = 'Zone' | 'Area';
export const SCOPE_LABEL: Record<RaceScope, string> = { Zone: 'Pony Club Zone', Area: 'Pony Club Area' };

/** Pairs get the pairs list, individuals an individual-eligible list, juniors and novices the junior one, and everyone else the seniors list. */
export function defaultRaceList(scope: RaceScope, format: number, ageGroup: string): string[] {
  const junior = /\b(juniors?|novices?|(u|under\s*)(8|9|10|11|12))\b/i.test(ageGroup);
  if (format === 1) return [...(scope === 'Area' ? AREA_PAIRS : ZONE_PAIRS)];
  if (format === 3) {
    if (junior) return (scope === 'Area' ? AREA_JUNIORS : ZONE_JUNIORS).filter((r) => !TEAM_ONLY_RACES.has(r));
    return [...(scope === 'Area' ? AREA_INDIVIDUALS : ZONE_INDIVIDUALS)];
  }
  if (junior) return [...(scope === 'Area' ? AREA_JUNIORS : ZONE_JUNIORS)];
  return [...(scope === 'Area' ? AREA_SENIORS : ZONE_SENIORS)];
}

/** Which standard list a set of races is, if it is exactly one of them. */
export function scopeOf(races: readonly string[], format: number, ageGroup: string): RaceScope | null {
  const same = (list: readonly string[]) => list.length === races.length && list.every((race, i) => race === races[i]);
  if (same(defaultRaceList('Zone', format, ageGroup))) return 'Zone';
  if (same(defaultRaceList('Area', format, ageGroup))) return 'Area';
  return null;
}
