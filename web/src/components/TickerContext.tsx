import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { sameTickerItems, type TickerItem } from '../lib/ticker';

interface TickerState { items: TickerItem[]; setItems: (items: TickerItem[]) => void }
const Ctx = createContext<TickerState | null>(null);

export function TickerProvider({ children }: { children: ReactNode }) {
  const [items, setRawItems] = useState<TickerItem[]>([]);
  // The page republishes every minute; keep the same list when nothing changed so the rotation is not reset.
  const setItems = useCallback((next: TickerItem[]) => setRawItems((current) => (sameTickerItems(current, next) ? current : next)), []);
  const value = useMemo(() => ({ items, setItems }), [items, setItems]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTicker() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTicker must be used within TickerProvider');
  return ctx;
}
