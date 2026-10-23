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
  /** Entries are open and nothing else is yet (see `competitionPhase`): the public tab bar shrinks to Enter and Details. */
  entryPhase?: boolean;
  /** Needed to tell whether the viewer organises this competition. */
  createdByUserId?: string | null;
}
export interface CompetitionMetaState { meta: CompetitionMeta | null; setMeta: (meta: CompetitionMeta | null) => void }
export const CompetitionMetaCtx = createContext<CompetitionMetaState | null>(null);

export function useCompetitionMeta() {
  const ctx = useContext(CompetitionMetaCtx);
  if (!ctx) throw new Error('useCompetitionMeta must be used within CompetitionMetaProvider');
  return ctx;
}
