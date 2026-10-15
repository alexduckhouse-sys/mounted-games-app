import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface TickerState { items: string[]; setItems: (items: string[]) => void }
const Ctx = createContext<TickerState | null>(null);

export function TickerProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<string[]>([]);
  const value = useMemo(() => ({ items, setItems }), [items]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTicker() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTicker must be used within TickerProvider');
  return ctx;
}
