import { createContext, useContext } from 'react';
import type { StreamInvoke } from '../../live/streamRuntime';
import type { CompetitionDetail, LiveStream, ChatMessage, Sponsor, StreamOverlay } from '../../types';
import type { OverlaySaveResult } from '../../hooks/useStreamOverlay';
import type { QueuedScoreCard } from '../../lib/scoreCard';

export interface CompetitionCtx {
  competition: CompetitionDetail;
  reload: () => void;
  streams: LiveStream[];
  streamingEnabled: boolean;
  /** True once the server has said whether streaming is set up; missing means assume it has. */
  streamingChecked?: boolean;
  invoke: StreamInvoke;
  ready: number;
  streamMessages: { message: ChatMessage; receivedAt: number }[];
  /** When this copy of the competition last came from the server, or null for an undated saved copy. */
  updatedAt?: Date | null;
  /** A saved response or a disconnected live feed must not be labelled live. */
  isStale?: boolean;
  /** Overlays drawn over the live video; defaults when the API has none. */
  overlay?: StreamOverlay;
  /** Change the overlays (broadcasters only); see `useStreamOverlay`. */
  saveOverlay?: (change: (overlay: StreamOverlay) => StreamOverlay) => Promise<OverlaySaveResult>;
  /** Score cards from recent results, newest last, for the video overlays. */
  scoreCards?: QueuedScoreCard[];
  /** The sponsors on show now, for every place they can appear (see `lib/sponsors.ts`). */
  sponsors?: Sponsor[];
  /** Fetch the sponsors again, e.g. after an organiser changes them. */
  reloadSponsors?: () => void;
  /** Counts the producer's "skip" instructions, so the sponsor cards on screen can move on. */
  sponsorSkip?: { count: number; at: number };
}

export const CompetitionContext = createContext<CompetitionCtx | null>(null);

export function useCompetition() {
  const ctx = useContext(CompetitionContext);
  if (!ctx) throw new Error('useCompetition outside CompetitionPage');
  return ctx;
}
