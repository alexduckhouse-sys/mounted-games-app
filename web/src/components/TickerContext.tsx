import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { sameTickerItems, type TickerItem } from '../lib/ticker';

/** A button a page puts beside the ticker dock, such as the timetable's filters. */
export interface DockAction {
  /** What the button opens, for screen readers ("Day, arena and age group"). */
  label: string;
  /** How many filters are set; shown as a small badge when above zero. */
  count: number;
  onClick: () => void;
  /** The icon on the button: the filters (default) or a list of pages to jump to. */
  icon?: 'filters' | 'list';
}

interface TickerState {
  watchCompetitionId: number | null;
  setWatchCompetitionId: (id: number | null) => void;
  items: TickerItem[];
  setItems: (items: TickerItem[]) => void;
  dockAction: DockAction | null;
  setDockAction: (action: DockAction | null) => void;
}
const Ctx = createContext<TickerState | null>(null);

export function TickerProvider({ children }: { children: ReactNode }) {
  const [watchCompetitionId, setWatchCompetitionId] = useState<number | null>(null);
  const [items, setRawItems] = useState<TickerItem[]>([]);
  const [dockAction, setDockAction] = useState<DockAction | null>(null);
  // The page republishes every minute; keep the same list when nothing changed so the rotation is not reset.
  const setItems = useCallback((next: TickerItem[]) => setRawItems((current) => (sameTickerItems(current, next) ? current : next)), []);
  const value = useMemo(
    () => ({ items, setItems, watchCompetitionId, setWatchCompetitionId, dockAction, setDockAction }),
    [items, setItems, watchCompetitionId, dockAction],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// The provider and its hook deliberately share this context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useTicker() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTicker must be used within TickerProvider');
  return ctx;
}

/** The dock's action without the provider, so pages still render on their own (in tests, for example). */
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalTicker() {
  return useContext(Ctx);
}
