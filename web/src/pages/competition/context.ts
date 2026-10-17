import { createContext, useContext } from 'react';
import type { StreamInvoke } from '../../live/streamRuntime';
import type { CompetitionDetail, LiveStream, ChatMessage } from '../../types';

export interface CompetitionCtx {
  competition: CompetitionDetail;
  reload: () => void;
  streams: LiveStream[];
  streamingEnabled: boolean;
  invoke: StreamInvoke;
  ready: number;
  streamMessages: { message: ChatMessage; receivedAt: number }[];
  /** When this copy of the competition last came from the server, or null for an undated saved copy. */
  updatedAt?: Date | null;
  /** A saved response or a disconnected live feed must not be labelled live. */
  isStale?: boolean;
}

export const CompetitionContext = createContext<CompetitionCtx | null>(null);

export function useCompetition() {
  const ctx = useContext(CompetitionContext);
  if (!ctx) throw new Error('useCompetition outside CompetitionPage');
  return ctx;
}
