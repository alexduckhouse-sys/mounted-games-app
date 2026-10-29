import { horseboxEntrance } from '../operations/lorryEntrance';
import { cleanWhat3Words } from '../../lib/lorryAndVolunteers';
import type { CompetitionDetail } from '../../types';

/** The words the rows and their summary need, in the viewer's language. */
export interface DetailLabels {
  venue: string; postcode: string; lorryPark: string; organiser: string; email: string; competitionNo: string;
  /** Lower-case names for the one-line summary. */
  summary: { venue: string; postcode: string; what3words: string; lorryPark: string; organiser: string; email: string; competitionNo: string };
}

export interface DetailRow {
  key: 'venue' | 'postcode' | 'what3words' | 'lorry' | 'organiser' | 'email' | 'compNo';
  label: string;
  /** What it is called in the summary line under "See details". */
  summaryName: string;
  value: string;
  href?: string;
  icon?: 'pin' | 'w3w' | 'mail';
}

type DetailFields = Pick<CompetitionDetail, 'location' | 'postcode' | 'what3Words' | 'lorryWhat3Words' | 'lorryLatitude' | 'lorryLongitude' | 'lorryDirectionsNote'
  | 'organiserName' | 'contactEmail' | 'competitionNumber' | 'latitude' | 'longitude' | 'appleMapsUrl'>;

const present = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/** Where the venue is on a map: the organiser's own link, or a search for the pin when only its position is known. */
export function venueMapUrl(competition: Pick<DetailFields, 'appleMapsUrl' | 'latitude' | 'longitude'>): string | null {
  if (competition.appleMapsUrl && competition.appleMapsUrl.length <= 500) {
    try {
      const url = new URL(competition.appleMapsUrl);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch { /* Fall back to coordinates for an invalid saved link. */ }
  }
  if (competition.latitude != null && competition.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${competition.latitude},${competition.longitude}`;
  }
  return null;
}

/** One row for every organiser-set detail that has a value, in the order they are shown. Nothing is made up. */
export function eventDetailRows(competition: DetailFields, labels: DetailLabels): DetailRow[] {
  const rows: DetailRow[] = [];
  const venue = present(competition.location);
  const map = venueMapUrl(competition);
  if (venue) rows.push({ key: 'venue', label: labels.venue, summaryName: labels.summary.venue, value: venue, ...(map ? { href: map, icon: 'pin' as const } : {}) });
  const postcode = present(competition.postcode);
  if (postcode) rows.push({ key: 'postcode', label: labels.postcode, summaryName: labels.summary.postcode, value: postcode, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(postcode)}`, icon: 'pin' });
  const w3w = cleanWhat3Words(competition.what3Words);
  if (w3w) rows.push({ key: 'what3words', label: 'what3words', summaryName: labels.summary.what3words, value: `///${w3w}`, href: `https://what3words.com/${encodeURIComponent(w3w)}`, icon: 'w3w' });
  const entrance = horseboxEntrance(competition);
  const lorryText = [entrance?.what3WordsDisplay, present(entrance?.directionsNote)].filter(Boolean).join(' · ');
  if (entrance && lorryText) rows.push({ key: 'lorry', label: labels.lorryPark, summaryName: labels.summary.lorryPark, value: lorryText, ...(entrance.what3WordsUrl ? { href: entrance.what3WordsUrl, icon: 'w3w' as const } : {}) });
  const organiser = present(competition.organiserName);
  if (organiser) rows.push({ key: 'organiser', label: labels.organiser, summaryName: labels.summary.organiser, value: organiser });
  const email = present(competition.contactEmail);
  if (email) rows.push({ key: 'email', label: labels.email, summaryName: labels.summary.email, value: email, href: `mailto:${email}`, icon: 'mail' });
  const number = present(competition.competitionNumber);
  if (number) rows.push({ key: 'compNo', label: labels.competitionNo, summaryName: labels.summary.competitionNo, value: number });
  return rows;
}
