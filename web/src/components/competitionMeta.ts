import { createContext, useContext } from 'react';

/** What the header and menu show about the open competition, published by the competition page. */
export interface CompetitionMeta {
  id: number;
  name: string;
  startDate: string;
  endDate?: string | null;
  location?: string | null;
  /** A session is in the arena right now. */
  live: boolean;
}
export interface CompetitionMetaState { meta: CompetitionMeta | null; setMeta: (meta: CompetitionMeta | null) => void }
export const CompetitionMetaCtx = createContext<CompetitionMetaState | null>(null);

export function useCompetitionMeta() {
  const ctx = useContext(CompetitionMetaCtx);
  if (!ctx) throw new Error('useCompetitionMeta must be used within CompetitionMetaProvider');
  return ctx;
}
