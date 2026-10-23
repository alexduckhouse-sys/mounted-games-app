import { createContext, useContext } from 'react';
import type { TrainerRequest } from '../../types';

export interface NeedsYouValue {
  /** Trainer requests waiting for an admin. Empty for everyone else. */
  requests: TrainerRequest[];
  /** What the red badge on the Me tab counts. */
  count: number;
  /** Approves or declines one request; false when the server said no. */
  review: (request: TrainerRequest, action: 'approve' | 'decline') => Promise<boolean>;
}

export const NeedsYouContext = createContext<NeedsYouValue>({ requests: [], count: 0, review: async () => false });

export function useNeedsYou(): NeedsYouValue {
  return useContext(NeedsYouContext);
}
