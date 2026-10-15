import { createContext, useContext } from 'react';
import type { CompetitionDetail, Heat } from '../../types';

export interface CompetitionCtx {
  competition: CompetitionDetail;
  reload: () => void;
  /** Apply a heat the server just returned, without downloading the whole competition again. */
  applyHeat: (sessionId: number, heat: Heat) => void;
}

export const CompetitionContext = createContext<CompetitionCtx | null>(null);

export function useCompetition() {
  const ctx = useContext(CompetitionContext);
  if (!ctx) throw new Error('useCompetition outside CompetitionPage');
  return ctx;
}
