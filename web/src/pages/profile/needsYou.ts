import { createContext, useContext } from 'react';
import type { Team, TrainerRequest } from '../../types';

export interface NeedsYouValue {
  /** People waiting to join: trainer requests for a club's manager, and for an admin those plus manager requests. */
  requests: TrainerRequest[];
  /** The teams the person coaches, manages or follows; null until they have loaded. */
  teams: Team[] | null;
  /** Teams this person fills in the dec form for that still have none. */
  decForms: Team[];
  /** What the red badge on the Me tab counts: requests plus missing dec forms. */
  count: number;
  /** Approves or declines one request; false when the server said no. */
  review: (request: TrainerRequest, action: 'approve' | 'decline') => Promise<boolean>;
  /** Why the last approve or decline failed (the server's message when it sent one); null when it didn't. */
  reviewError?: string | null;
}

export const NeedsYouContext = createContext<NeedsYouValue>({ requests: [], teams: null, decForms: [], count: 0, review: async () => false });

export function useNeedsYou(): NeedsYouValue {
  return useContext(NeedsYouContext);
}
