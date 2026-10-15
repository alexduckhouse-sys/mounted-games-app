import { useMemo, useState, type ReactNode } from 'react';
import { CompetitionMetaCtx, type CompetitionMeta } from './competitionMeta';

export function CompetitionMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<CompetitionMeta | null>(null);
  const value = useMemo(() => ({ meta, setMeta }), [meta]);
  return <CompetitionMetaCtx.Provider value={value}>{children}</CompetitionMetaCtx.Provider>;
}
