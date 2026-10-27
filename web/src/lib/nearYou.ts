import type { CompetitionNearYouPage } from '../types';

export type EventsSort = 'nearest' | 'soonest';

export const EVENTS_SORT_KEY = 'mg.eventsSort';

/** The order the person last chose on the events page. Nearest first until they say otherwise. */
export function readEventsSort(): EventsSort {
  try {
    return localStorage.getItem(EVENTS_SORT_KEY) === 'soonest' ? 'soonest' : 'nearest';
  } catch {
    return 'nearest';
  }
}

export function writeEventsSort(sort: EventsSort): void {
  try {
    localStorage.setItem(EVENTS_SORT_KEY, sort);
  } catch {
    // Storage can be blocked; the choice then lasts until the page is closed.
  }
}

/**
 * A rough distance in words: "under 5 miles", "about 30 miles". The server sends whole miles from a place that is itself
 * rounded to about seven miles, so the wording rounds further instead of pretending to be exact.
 */
export function distanceText(miles: number): string {
  if (!Number.isFinite(miles) || miles < 0) return '';
  if (miles < 5) return 'under 5 miles';
  const step = miles < 50 ? 5 : miles < 100 ? 10 : 25;
  return `about ${Math.round(miles / step) * step} miles`;
}

/** Guards a near-you answer before use: the page is only believed if it has the shape we asked for. */
export function isNearYouPage(value: unknown): value is CompetitionNearYouPage {
  const page = value as Partial<CompetitionNearYouPage> | null | undefined;
  return !!page && Array.isArray(page.items) && typeof page.hasMore === 'boolean';
}

/** Miles by event id, from the distances on a page. */
export function distanceMap(page: Pick<CompetitionNearYouPage, 'distances'>): Record<number, number> {
  const map: Record<number, number> = {};
  for (const entry of Array.isArray(page.distances) ? page.distances : []) {
    if (entry && typeof entry.id === 'number' && typeof entry.miles === 'number') map[entry.id] = entry.miles;
  }
  return map;
}
