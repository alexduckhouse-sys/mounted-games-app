import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type CompactPageBarBadge = 'live' | 'finished' | 'next';

export interface CompactPageBarConfig {
  backTo: string;
  /** Names the page the back arrow returns to; defaults to "Back to timetable". */
  backLabel?: string;
  title: string;
  subtitle: string;
  badge: CompactPageBarBadge;
}

/** What a competition page puts in the app header: its own title, a line under it and an optional refresh button. */
export interface PageHeaderConfig {
  title: string;
  /** Replaces the competition name line, e.g. "Hartpury Area Festival · 10:54". */
  subtitle?: string;
  /** A short end to the subtitle (the time it was updated) that stays in view when a long subtitle is cut short. */
  subtitleTail?: string;
  onRefresh?: () => void;
  refreshLabel?: string;
  /** Adds a pencil button that toggles the page's organiser tools; `editing` shows it pressed. */
  onEdit?: () => void;
  editLabel?: string;
  editing?: boolean;
  /** For pages that belong to no competition: plain text in the header, not a button that changes competition. */
  plain?: boolean;
  /** Puts a back arrow where the MG logo is, going here. Use with `plain`. */
  backTo?: string;
  backLabel?: string;
}

type PageHeaderEntry = { title: string; subtitle?: string; subtitleTail?: string; refreshLabel?: string; refresh?: () => void; editLabel?: string; edit?: () => void; editing?: boolean; plain?: boolean; backTo?: string; backLabel?: string };

interface CompactPageBarState {
  config: CompactPageBarConfig | null;
  publish: (owner: symbol, config: CompactPageBarConfig) => void;
  clear: (owner: symbol) => void;
  header: PageHeaderEntry | null;
  publishHeader: (owner: symbol, entry: PageHeaderEntry, priority?: number) => void;
  clearHeader: (owner: symbol) => void;
}

const CompactPageBarCtx = createContext<CompactPageBarState | null>(null);
/** True below the app shell's page outlet, where a published title shows in the top bar. */
const InAppShellCtx = createContext(false);

export function CompactPageBarProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<{ owner: symbol; config: CompactPageBarConfig } | null>(null);
  const [headerEntries, setHeaderEntries] = useState<{ owner: symbol; value: PageHeaderEntry; priority: number }[]>([]);
  const publishHeader = useCallback((owner: symbol, value: PageHeaderEntry, priority = 0) =>
    setHeaderEntries((list) => [...list.filter((item) => item.owner !== owner), { owner, value, priority }]), []);
  const clearHeader = useCallback((owner: symbol) => setHeaderEntries((list) => list.filter((item) => item.owner !== owner)), []);
  // The highest priority wins, and the latest of equals, so a RefineHeader's title beats its page's own.
  const headerEntry = headerEntries.reduce<(typeof headerEntries)[number] | null>((best, item) => !best || item.priority >= best.priority ? item : best, null);
  const publish = useCallback((owner: symbol, config: CompactPageBarConfig) => setEntry({ owner, config }), []);
  const clear = useCallback((owner: symbol) => setEntry((current) => current?.owner === owner ? null : current), []);
  const value = useMemo<CompactPageBarState>(() => ({
    config: entry?.config ?? null,
    publish,
    clear,
    header: headerEntry?.value ?? null,
    publishHeader,
    clearHeader,
  }), [entry, publish, clear, headerEntry, publishHeader, clearHeader]);
  return <CompactPageBarCtx.Provider value={value}>{children}</CompactPageBarCtx.Provider>;
}

/** Wraps the app shell's page outlet. */
export function InAppShell({ children }: { children: ReactNode }) {
  return <InAppShellCtx.Provider value>{children}</InAppShellCtx.Provider>;
}

// This provider and its hooks deliberately share the same context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useInAppShell() {
  return useContext(InAppShellCtx);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompactPageBarState() {
  const context = useContext(CompactPageBarCtx);
  if (!context) throw new Error('useCompactPageBarState must be used within CompactPageBarProvider');
  return context;
}

/** Publish a detail-page header for as long as this component is mounted. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCompactPageBar(config: CompactPageBarConfig) {
  const { publish, clear } = useCompactPageBarState();
  const owner = useRef(Symbol('compact-page-bar'));
  const { backTo, backLabel, title, subtitle, badge } = config;
  useLayoutEffect(() => {
    const ownerKey = owner.current;
    publish(ownerKey, { backTo, backLabel, title, subtitle, badge });
    return () => clear(ownerKey);
  }, [backTo, backLabel, title, subtitle, badge, publish, clear]);
}

/**
 * Show this page's title (and optionally a refresh button) in the app header while it is mounted.
 * Does nothing outside the app shell, so pages stay renderable on their own.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageHeader(config: PageHeaderConfig | null, priority = 0) {
  const context = useContext(CompactPageBarCtx);
  const owner = useRef(Symbol('page-header'));
  const refresh = useRef(config?.onRefresh);
  const edit = useRef(config?.onEdit);
  useLayoutEffect(() => { refresh.current = config?.onRefresh; edit.current = config?.onEdit; });
  const on = config != null;
  const { title = '', subtitle, subtitleTail, refreshLabel, editLabel, editing, plain, backTo, backLabel } = config ?? {};
  const hasRefresh = !!config?.onRefresh;
  const hasEdit = !!config?.onEdit;
  const publishHeader = context?.publishHeader;
  const clearHeader = context?.clearHeader;
  useLayoutEffect(() => {
    if (!on || !publishHeader || !clearHeader) return;
    const ownerKey = owner.current;
    publishHeader(ownerKey, {
      title, subtitle, subtitleTail, refreshLabel, editLabel, editing, plain, backTo, backLabel,
      refresh: hasRefresh ? () => refresh.current?.() : undefined,
      edit: hasEdit ? () => edit.current?.() : undefined,
    }, priority);
    return () => clearHeader(ownerKey);
  }, [on, title, subtitle, subtitleTail, refreshLabel, editLabel, editing, plain, backTo, backLabel, hasRefresh, hasEdit, priority, publishHeader, clearHeader]);
}
