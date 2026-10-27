import { cleanWhat3Words, lorryGateLinks, type LorryGateLinks } from '../../lib/lorryAndVolunteers';
import type { CompetitionDetail } from '../../types';

type LorryFields = Pick<CompetitionDetail, 'lorryWhat3Words' | 'lorryLatitude' | 'lorryLongitude' | 'lorryDirectionsNote'>;

/** Three words separated by dots, with or without the leading ///. Letters in any language are fine. */
export function isValidWhat3Words(raw: string | null | undefined): boolean {
  const words = cleanWhat3Words(raw);
  return words !== null && /^[\p{L}\p{M}'-]+\.[\p{L}\p{M}'-]+\.[\p{L}\p{M}'-]+$/u.test(words);
}

/** A latitude and longitude typed as "52.1234, -1.5678", or null when it is not a real position. */
export function parseCoordinates(raw: string): { lat: number; lon: number } | null {
  const match = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(raw);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export interface HorseboxEntrance extends LorryGateLinks {
  wazeUrl: string | null;
}

/** The separate horsebox entrance, when the organiser has given anything about one. */
export function horseboxEntrance(competition: LorryFields): HorseboxEntrance | null {
  const links = lorryGateLinks(competition);
  if (!links.hasDirections) return null;
  const { lorryLatitude: lat, lorryLongitude: lon } = competition;
  const hasCoords = typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon);
  return { ...links, wazeUrl: hasCoords ? `https://waze.com/ul?ll=${lat},${lon}&navigate=yes` : null };
}
