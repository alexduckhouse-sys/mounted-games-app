import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sameTickerItems, type TickerItem } from '../lib/ticker';

/** A button a page puts beside the ticker dock, such as the timetable's filters. */
export interface DockAction {
  /** What the button opens, for screen readers ("Day, arena and age group"). */
  label: string;
  /** How many filters are set; shown as a small badge when above zero. */
  count: number;
  onClick: () => void;
  /**
   * The icon on the button: the filters (default), a list of places to jump to, a page's tools or settings,
   * a plus for the page's one "add" action, or print.
   */
  icon?: DockIcon;
}

export type DockIcon = 'filters' | 'list' | 'settings' | 'plus' | 'print';

interface TickerState {
  watchCompetitionId: number | null;
  setWatchCompetitionId: (id: number | null) => void;
  items: TickerItem[];
  setItems: (items: TickerItem[]) => void;
  dockAction: DockAction | null;
  setDockAction: (action: DockAction | null) => void;
  /** True while the dock is actually on screen (the shell leaves it off on some pages, such as print and scoring). */
  docked: boolean;
  setDockHosts: (change: (count: number) => number) => void;
  /** True while a quiet page (such as the not-found page) is open: the dock keeps its page button but shows no ticker line. */
  quiet: boolean;
  setQuiet: (quiet: boolean) => void;
}
const Ctx = createContext<TickerState | null>(null);

export function TickerProvider({ children }: { children: ReactNode }) {
  const [watchCompetitionId, setWatchCompetitionId] = useState<number | null>(null);
  const [items, setRawItems] = useState<TickerItem[]>([]);
  const [dockAction, setDockAction] = useState<DockAction | null>(null);
  const [dockHosts, setDockHosts] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const docked = dockHosts > 0;
  // The page republishes every minute; keep the same list when nothing changed so the rotation is not reset.
  const setItems = useCallback((next: TickerItem[]) => setRawItems((current) => (sameTickerItems(current, next) ? current : next)), []);
  const value = useMemo(
    () => ({ items, setItems, watchCompetitionId, setWatchCompetitionId, dockAction, setDockAction, docked, setDockHosts, quiet, setQuiet }),
    [items, setItems, watchCompetitionId, dockAction, docked, quiet],
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

/** Called by the dock itself while it is mounted, so pages know their button will really be drawn. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDockHost() {
  const setDockHosts = useContext(Ctx)?.setDockHosts;
  // Before paint, so a page never flashes its own button for a frame first.
  useLayoutEffect(() => {
    if (!setDockHosts) return;
    setDockHosts((n) => n + 1);
    return () => setDockHosts((n) => n - 1);
  }, [setDockHosts]);
}

/**
 * Puts a page's one button beside the ticker dock while the page is open (pass null for none). Returns false when
 * there is no dock on screen (a page rendered on its own, or one where the shell leaves the dock off, such as print),
 * so the page can show its own button instead.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useDockAction(action: { label: string; onClick: () => void; icon?: DockIcon; count?: number } | null): boolean {
  const ctx = useContext(Ctx);
  const setDockAction = ctx?.setDockAction;
  // The latest handler, so a page can pass a fresh arrow function on every render without re-publishing the button.
  const onClick = useRef(action?.onClick);
  useLayoutEffect(() => { onClick.current = action?.onClick; });
  const shown = action != null;
  const label = action?.label ?? '';
  const icon = action?.icon;
  const count = action?.count ?? 0;
  useEffect(() => {
    if (!setDockAction || !shown) return;
    setDockAction({ label, count, icon, onClick: () => onClick.current?.() });
    return () => setDockAction(null);
  }, [setDockAction, shown, label, icon, count]);
  return ctx?.docked ?? false;
}

/**
 * Marks the page as a quiet one: no ticker line over it (a page's own dock button still shows). Pages that can be
 * recognised by their address are listed in `AppShell` instead; this is for the ones that can't, such as "not found".
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useQuietTicker() {
  const setQuiet = useContext(Ctx)?.setQuiet;
  useLayoutEffect(() => {
    if (!setQuiet) return;
    setQuiet(true);
    return () => setQuiet(false);
  }, [setQuiet]);
}
