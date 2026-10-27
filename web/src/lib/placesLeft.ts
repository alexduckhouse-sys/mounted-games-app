import type { CompetitionSection } from '../types';
import type { MessageKey } from '../i18n/en';
import { tr } from '../i18n/translate';
import { remainingPlaces } from './entryOptions';

const PLACES: Record<number, MessageKey> = { 1: 'entries.places.pair', 2: 'entries.places.team', 3: 'entries.places.rider' };

/**
 * "6 team places left", "1 pair place left". Null when there is nothing helpful to say: entries are closed or
 * locked, the number is unknown or uncapped, or the group is full (the Full and waiting-list flow covers that).
 * The count is the server's; it is never worked out from the team list.
 */
export function placesLeftText(section: Pick<CompetitionSection, 'format' | 'maxParticipants' | 'activeSignupsCount'>, closed = false): string | null {
  if (closed) return null;
  const left = remainingPlaces(section);
  if (left == null || left === 0) return null;
  return tr(PLACES[section.format] ?? 'entries.places.entry', { count: left });
}
