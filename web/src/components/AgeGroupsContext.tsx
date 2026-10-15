import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface AgeGroupLink { id: number; name: string }
interface AgeGroupsState { competitionId: number | null; groups: AgeGroupLink[]; setGroups: (competitionId: number | null, groups: AgeGroupLink[]) => void }
const Ctx = createContext<AgeGroupsState | null>(null);

/** The open competition's age groups, published by the competition page for the menu. */
export function AgeGroupsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ competitionId: number | null; groups: AgeGroupLink[] }>({ competitionId: null, groups: [] });
  const value = useMemo(() => ({ ...state, setGroups: (competitionId: number | null, groups: AgeGroupLink[]) => setState({ competitionId, groups }) }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAgeGroups() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAgeGroups must be used within AgeGroupsProvider');
  return ctx;
}
