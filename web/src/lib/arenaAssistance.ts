import { api } from '../api';
import type { ArenaAssistanceService, ChatMessage, RequestArenaAssistanceRequest } from '../types';

export interface ArenaAssistanceOption {
  id: ArenaAssistanceService;
  label: string;
  shortLabel: string;
  defaultHoldArena: boolean;
}

export const ARENA_ASSISTANCE_SERVICES: readonly ArenaAssistanceOption[] = [
  { id: 'farrier', label: 'Call Farrier', shortLabel: 'Farrier', defaultHoldArena: true },
  { id: 'vet', label: 'Call Vet', shortLabel: 'Vet', defaultHoldArena: true },
  { id: 'first-aid', label: 'Call First Aid', shortLabel: 'First Aid', defaultHoldArena: true },
];

/** Display title for an arena assistance service (`Farrier`, `Vet`, or `First Aid`). */
export function arenaAssistanceLabel(service: ArenaAssistanceService): string {
  if (service === 'farrier') return 'Farrier';
  if (service === 'vet') return 'Vet';
  return 'First Aid';
}

/** Build the competition notice text for a farrier, vet, or first-aid call to an arena. */
export function formatArenaAssistanceMessage(
  service: ArenaAssistanceService,
  arenaName?: string | null,
  note?: string | null,
): string {
  const arena = arenaName?.trim() || 'Main Arena';
  const title = arenaAssistanceLabel(service);
  const extra = note?.trim();
  return extra ? `${title} needed at ${arena} — ${extra}` : `${title} needed at ${arena}`;
}

/** Post a priority arena assistance call (`Farrier` / `Vet` / `First Aid`) and optionally hold the arena session. */
export async function requestArenaAssistance(
  competitionId: number,
  sessionId: number,
  payload: RequestArenaAssistanceRequest,
): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessage>(
    `/competitions/${competitionId}/sessions/${sessionId}/assistance`,
    payload,
  );
  return data;
}
