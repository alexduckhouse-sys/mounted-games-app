import type { Heat } from '../types';
import type { BottomTabId } from './userPrefs';
import { MAX_BOTTOM_TABS } from './userPrefs';
import type { TeamNext } from './following';

/** Where a followed team's card sits on the Following page. */
export type FollowGroup = 'now' | 'next' | 'done';

/**
 * "On now" for a team whose heat is running, "Up next" for one with a heat still to ride (or none drawn yet),
 * "Done for today" once every heat it was drawn into is finished. A saved copy can't say what is on now, so a
 * running heat counts as next there.
 */
export function followGroup(next: TeamNext | undefined, stale: boolean): FollowGroup {
  if (next?.kind === 'done') return 'done';
  if (next?.kind === 'heat' && next.row.status === 'live' && !stale) return 'now';
  return 'next';
}

/** Where a team stands in a heat from the races scored so far: its place (ties share one) and its points. Null before a race is scored. */
export function heatStanding(heat: Pick<Heat, 'entries' | 'races'>, teamId: number): { place: number; points: number } | null {
  const done = heat.races.filter((race) => race.isComplete);
  if (!done.length || !heat.entries.some((entry) => entry.teamId === teamId)) return null;
  const totals = new Map<number, number>(heat.entries.map((entry) => [entry.teamId, 0]));
  for (const race of done) for (const result of race.results) if (totals.has(result.teamId)) totals.set(result.teamId, totals.get(result.teamId)! + result.points);
  const points = totals.get(teamId)!;
  return { place: 1 + [...totals.values()].filter((value) => value > points).length, points };
}

/** "Race 7 of 8" as numbers: the race being ridden, out of the heat's races. Null when the heat has no races set up. */
export function raceProgress(heat: Pick<Heat, 'races'>): { current: number; total: number } | null {
  const races = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  if (!races.length) return null;
  const running = races.findIndex((race) => !race.isComplete);
  return { current: running >= 0 ? running + 1 : races.length, total: races.length };
}

/** Whole minutes from `now` to `at`, only while that is soon enough to be worth saying ("in 25 min"); otherwise null. */
export function minutesToGo(at: Date | null | undefined, now: Date, limit = 120): number | null {
  if (!at) return null;
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000);
  return minutes >= 1 && minutes <= limit ? minutes : null;
}

/** The followed team's latest finished heat, with where it came in that heat. */
export function lastResult<T extends { status: string; heat: Heat | null; scores: { team: { id: number } }[] }>(rows: readonly T[], teamId: number): { row: T; place: number; points: number } | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row.status !== 'finished' || !row.heat || !row.scores.some((score) => score.team.id === teamId)) continue;
    const standing = heatStanding(row.heat, teamId);
    if (standing) return { row, ...standing };
  }
  return null;
}

/**
 * The bottom bar with Following added: just before Details when there is one, otherwise at the end. A full bar gives up
 * its last tab that isn't Timetable, Toplists or Details to make room.
 */
export function withFollowingTab(tabs: readonly BottomTabId[]): BottomTabId[] {
  if (tabs.includes('following')) return [...tabs];
  const next = [...tabs];
  const details = next.indexOf('details');
  next.splice(details >= 0 ? details : next.length, 0, 'following');
  if (next.length > MAX_BOTTOM_TABS) {
    const keep: BottomTabId[] = ['timetable', 'toplists', 'details', 'following'];
    let drop = -1;
    next.forEach((id, index) => { if (!keep.includes(id)) drop = index; });
    // A bar of nothing but keepers can't have six tabs (there are only three distinct ones), so `drop` is always found.
    next.splice(Math.max(drop, 0), 1);
  }
  return next;
}

/** Whether a favourites change added teams: the ones in `after` that weren't in `before`, for one competition. */
export function addedFollows(before: readonly { competitionId: number; teamId: number }[], after: readonly { competitionId: number; teamId: number }[], competitionId: number): number[] {
  const had = new Set(before.filter((item) => item.competitionId === competitionId).map((item) => item.teamId));
  return after.filter((item) => item.competitionId === competitionId && !had.has(item.teamId)).map((item) => item.teamId);
}

export const FOLLOW_BAR_ASKED_KEY = 'mg.prompt.followingBar';

/** Whether this device has already been asked about adding Following to the bottom bar (a storage failure counts as asked, so it never nags). */
export function followBarAsked(): boolean {
  try { return localStorage.getItem(FOLLOW_BAR_ASKED_KEY) !== null; } catch { return true; }
}

/** Remember the answer (either one), so the question is only ever asked once on this device. */
export function markFollowBarAsked(answer: 'added' | 'declined'): void {
  try { localStorage.setItem(FOLLOW_BAR_ASKED_KEY, answer); } catch { /* storage blocked: the question was already counted as asked */ }
}
