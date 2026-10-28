import type { DeclarationForm } from '../types';
import { publicRiderName } from './riderNames';
import type { Toplist } from './toplist';

/** One place given at a prize-giving, as every viewer receives it. */
export interface PrizeGivingPlace {
  teamId: number;
  place: number;
  teamName: string;
  clubName: string | null;
  points: number;
}

/** A prize-giving on the stream: every place given so far, in the order given (the last is the one just read out). */
export interface PrizeGiving {
  sectionId: number;
  sectionName: string;
  places: PrizeGivingPlace[];
  /** The winners' moment is playing. */
  champions: boolean;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Reads a `prizeGiving` message from the live hub: the prize-giving to show, `'clear'` to take it off, or null for
 * anything malformed (which viewers ignore).
 */
export function parsePrizeGiving(raw: unknown): PrizeGiving | 'clear' | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Record<string, unknown>;
  if (message.action === 'clear') return 'clear';
  if (message.action !== 'show' || !isNumber(message.sectionId) || !Array.isArray(message.places)) return null;
  const places: PrizeGivingPlace[] = [];
  for (const item of message.places) {
    const place = item as Record<string, unknown> | null;
    if (!place || !isNumber(place.teamId) || !isNumber(place.place) || !isNumber(place.points) || typeof place.teamName !== 'string') return null;
    places.push({ teamId: place.teamId, place: place.place, teamName: place.teamName, clubName: typeof place.clubName === 'string' ? place.clubName : null, points: place.points });
  }
  if (places.length === 0) return null;
  return { sectionId: message.sectionId, sectionName: typeof message.sectionName === 'string' ? message.sectionName : '', places, champions: message.champions === true };
}

/** A place the organiser will read out, with the team's points from the toplist. */
export interface RevealPlace {
  teamId: number;
  teamName: string;
  place: number;
  joint: boolean;
  points: number;
}

/**
 * The places to give, last first: the top `count` positions of the age group's toplist, so finals and tie-breaks
 * decide the order exactly as they do on the Toplists page. Hors concours teams are left out. Teams level on a place
 * are given one after another.
 */
export function revealOrder(toplist: Toplist, count: number): RevealPlace[] {
  const hc = new Set(toplist.hc.map((team) => team.teamId));
  return toplist.rows
    .filter((row) => !hc.has(row.teamId) && row.position <= count)
    .map((row) => ({ teamId: row.teamId, teamName: row.teamName, place: row.position, joint: row.joint, points: row.points }))
    .reverse();
}

/** A rider to read out: their name, their pony and whether they are the reserve. */
export interface RiderLine {
  rider: string;
  pony: string | null;
  reserve: boolean;
}

/** The riders and ponies on a team's latest dec form, in team order with the reserve last. */
export function riderLines(forms: DeclarationForm[], teamId: number): RiderLine[] {
  const form = forms
    .filter((item) => item.teamId === teamId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  if (!form) return [];
  return form.riders
    .slice()
    .sort((a, b) => Number(a.isReserve) - Number(b.isReserve) || a.orderIndex - b.orderIndex)
    .map((rider) => ({ rider: publicRiderName(rider), pony: rider.horseName?.trim() || null, reserve: rider.isReserve }));
}

/** The automatic prize-giving: how many places, and how long each place and the winners stay up. */
export const AUTO_PLACES = 6;
export const AUTO_PLACE_SECONDS = 6;
export const AUTO_CHAMPION_SECONDS = 14;

/**
 * The frames of an automatic prize-giving, one per place from last to first, each carrying every place given so far
 * (as the organiser's stepping does). The winners' frame is marked `champions`.
 */
export function autoPrizeGivingFrames(order: RevealPlace[], sectionId: number, sectionName: string, clubOf: (teamId: number) => string | null): PrizeGiving[] {
  return order.map((_, index) => {
    const given = order.slice(0, index + 1);
    return {
      sectionId,
      sectionName,
      places: given.map((place) => ({ teamId: place.teamId, place: place.place, teamName: place.teamName, clubName: clubOf(place.teamId), points: place.points })),
      champions: index === order.length - 1 && given[index].place === 1,
    };
  });
}

/** The age groups whose finals have all just been scored: those in `now` that were not in `before` (null means first look). */
export function newlyFinished(before: ReadonlySet<number> | null, now: ReadonlySet<number>): number[] {
  if (!before) return [];
  return [...now].filter((id) => !before.has(id));
}
