// Unused in web UI yet — reserved for iOS / upcoming wiring
import { useCallback, useState } from 'react';
import { requestArenaAssistance } from '../lib/arenaAssistance';
import type { ArenaAssistanceService, ChatMessage } from '../types';

export interface UseArenaAssistanceOptions {
  competitionId: number;
  sessionId: number;
  defaultArenaName?: string | null;
  onAnnouncementSent?: (message: ChatMessage) => void;
}

export function useArenaAssistance({
  competitionId,
  sessionId,
  defaultArenaName,
  onAnnouncementSent,
}: UseArenaAssistanceOptions) {
  const [sendingService, setSendingService] = useState<ArenaAssistanceService | null>(null);
  const [lastSent, setLastSent] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const callAssistance = useCallback(
    async (
      service: ArenaAssistanceService,
      options?: { arenaName?: string | null; note?: string | null; holdArena?: boolean },
    ): Promise<ChatMessage | null> => {
      setSendingService(service);
      setError(null);
      try {
        const msg = await requestArenaAssistance(competitionId, sessionId, {
          service,
          arenaName: options?.arenaName ?? defaultArenaName ?? null,
          note: options?.note ?? null,
          holdArena: options?.holdArena ?? true,
        });
        setLastSent(msg);
        onAnnouncementSent?.(msg);
        return msg;
      } catch {
        setError('Could not send the arena call. Check your signal and try again.');
        return null;
      } finally {
        setSendingService(null);
      }
    },
    [competitionId, defaultArenaName, onAnnouncementSent, sessionId],
  );

  return {
    callAssistance,
    sendingService,
    lastSent,
    error,
  };
}
