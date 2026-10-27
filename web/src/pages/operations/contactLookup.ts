import { api } from '../../api';
import type { EmergencyContactEntry } from '../../types';

/** Nothing is looked up until this many characters are typed, so the list can never be dumped in one go. */
export const MIN_SEARCH_LENGTH = 2;
/** Show no more than this many at once; a longer list means the search was too wide. */
export const MAX_SHOWN = 30;

export async function fetchEmergencyContacts(competitionId: number, query: string): Promise<EmergencyContactEntry[]> {
  const { data } = await api.get<EmergencyContactEntry[]>(`/competitions/${competitionId}/emergency-contacts`, { params: { q: query.trim() } });
  if (!Array.isArray(data)) throw new Error('Unexpected response');
  return data;
}
