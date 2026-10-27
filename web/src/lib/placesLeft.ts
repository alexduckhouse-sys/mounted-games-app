import type { CompetitionSection } from '../types';
import { remainingPlaces } from './entryOptions';

const NOUN: Record<number, string> = { 1: 'pair', 2: 'team', 3: 'rider' };

/**
 * "6 team places left", "1 pair place left". Null when there is nothing helpful to say: entries are closed or
 * locked, the number is unknown or uncapped, or the group is full (the Full and waiting-list flow covers that).
 * The count is the server's; it is never worked out from the team list.
 */
export function placesLeftText(section: Pick<CompetitionSection, 'format' | 'maxParticipants' | 'activeSignupsCount'>, closed = false): string | null {
  if (closed) return null;
  const left = remainingPlaces(section);
  if (left == null || left === 0) return null;
  const noun = NOUN[section.format] ?? 'entry';
  const place = left === 1 ? 'place' : 'places';
  return `${left} ${noun === 'entry' ? '' : `${noun} `}${place} left`.replace('  ', ' ');
}
