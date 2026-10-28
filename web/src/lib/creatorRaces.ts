import { tr } from '../i18n/translate.ts';
import { finalCountOf, FINAL_LETTERS, isLocked, type SectionDraft } from './creatorDraft';

/**
 * The race lists of one age group, as the Races step shows them: a tab for each session, then a tab for each final.
 * A session's list is its `races`; the final lists are `finalRaces` (the A final, or the only one), `finalRacesB` and `finalRacesC`.
 */
export type RaceKey = number | 'f' | 'fB' | 'fC';

const FINAL_KEYS = ['f', 'fB', 'fC'] as const;
export const isFinalKey = (key: RaceKey): key is 'f' | 'fB' | 'fC' => typeof key === 'string';

/** Every tab, in order: Session 1, Session 2, ..., then the finals. */
export function raceKeys(section: SectionDraft, lanes?: number): RaceKey[] {
  return [...section.sessions.map((_, i) => i + 1), ...FINAL_KEYS.slice(0, finalCountOf(section, lanes))];
}

/** "Session 2", "Final" or, with more than one, "A final". */
export function raceKeyLabel(key: RaceKey, finals: number): string {
  if (!isFinalKey(key)) return tr('admin.creator.races.sessionN', { n: key });
  return finals > 1 ? tr('admin.creator.races.letterFinal', { letter: FINAL_LETTERS[FINAL_KEYS.indexOf(key)] }) : tr('admin.creator.races.final');
}

/** Whether a tab's list can still be changed: not once its heats are made or it has been scored. */
export function isKeyLocked(section: SectionDraft, key: RaceKey): boolean {
  if (!isFinalKey(key)) return isLocked(section.sessions[key - 1] ?? { races: null });
  return key === 'f' && !!(section.finalHasHeats || section.finalScored);
}

/** Whether a session's list follows Session 1's. */
export const followsFirst = (section: SectionDraft, key: RaceKey): boolean => !isFinalKey(key) && key > 1 && section.sessions[key - 1]?.sameAsFirst === true;

/** The races a tab shows; null means "left for later". */
export function racesOf(section: SectionDraft, key: RaceKey): string[] | null {
  if (isFinalKey(key)) return (key === 'f' ? section.finalRaces : key === 'fB' ? section.finalRacesB : section.finalRacesC) ?? null;
  return section.sessions[key - 1]?.races ?? null;
}

/** Sets a tab's list. Session 1's list also goes to every session that follows it. Empty becomes "left for later". */
export function withRaces(section: SectionDraft, key: RaceKey, races: string[] | null): SectionDraft {
  const next = races && races.length > 0 ? races : null;
  if (isKeyLocked(section, key)) return section;
  if (isFinalKey(key)) {
    return key === 'f' ? { ...section, finalRaces: next } : key === 'fB' ? { ...section, finalRacesB: next } : { ...section, finalRacesC: next };
  }
  return {
    ...section,
    sessions: section.sessions.map((x, j) => {
      if (isLocked(x)) return x;
      if (j === key - 1) return { ...x, races: next };
      return key === 1 && j > 0 && x.sameAsFirst ? { ...x, races: next } : x;
    }),
  };
}

/** Turns "Same races as Session 1" on or off for a session. On copies Session 1's list now and keeps it in step. */
export function withFollowsFirst(section: SectionDraft, key: number, on: boolean): SectionDraft {
  return {
    ...section,
    sessions: section.sessions.map((x, j) => (j !== key - 1 || isLocked(x) ? x : { ...x, sameAsFirst: on, ...(on ? { races: section.sessions[0].races } : {}) })),
  };
}

/** Moves the item at `from` to `to`. Out of range leaves the list as it is. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Where a row dragged `dy` pixels from position `from` lands, with every row `height` tall. */
export function dropIndex(from: number, dy: number, height: number, length: number): number {
  if (height <= 0 || length <= 0) return from;
  return Math.max(0, Math.min(length - 1, from + Math.round(dy / height)));
}

/** How far another row shifts to make room while row `from` is dragged over position `to`: up, down, or not at all. */
export function makeRoom(index: number, from: number, to: number, height: number): number {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -height;
  if (from > to && index >= to && index < from) return height;
  return 0;
}

/** The list on each tab of an age group, labelled, for the review step. A session that follows Session 1 says so instead of repeating it. */
export function raceLists(section: SectionDraft, lanes?: number): { key: RaceKey; label: string; races: string[] | null; same: boolean }[] {
  const finals = finalCountOf(section, lanes);
  return raceKeys(section, lanes).map((key) => ({ key, label: raceKeyLabel(key, finals), races: racesOf(section, key), same: followsFirst(section, key) }));
}
