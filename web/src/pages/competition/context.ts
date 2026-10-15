import { createContext, useContext } from 'react';
import type { CompetitionDetail } from '../../types';

export interface CompetitionCtx {
  competition: CompetitionDetail;
  reload: () => void;
}

export const CompetitionContext = createContext<CompetitionCtx | null>(null);

export function useCompetition() {
  const ctx = useContext(CompetitionContext);
  if (!ctx) throw new Error('useCompetition outside CompetitionPage');
  return ctx;
}
