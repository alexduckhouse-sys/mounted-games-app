import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { sameTickerItems, type TickerItem } from '../lib/ticker';

interface TickerState { watchCompetitionId: number | null; setWatchCompetitionId: (id: number | null) => void; items: TickerItem[]; setItems: (items: TickerItem[]) => void }
const Ctx = createContext<TickerState | null>(null);

export function TickerProvider({ children }: { children: ReactNode }) {
  const [watchCompetitionId, setWatchCompetitionId] = useState<number | null>(null);
  const [items, setRawItems] = useState<TickerItem[]>([]);
  // The page republishes every minute; keep the same list when nothing changed so the rotation is not reset.
  const setItems = useCallback((next: TickerItem[]) => setRawItems((current) => (sameTickerItems(current, next) ? current : next)), []);
  const value = useMemo(() => ({ items, setItems, watchCompetitionId, setWatchCompetitionId }), [items, setItems, watchCompetitionId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// The provider and its hook deliberately share this context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useTicker() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTicker must be used within TickerProvider');
  return ctx;
}
