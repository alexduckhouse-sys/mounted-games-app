import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type CompactPageBarBadge = 'live' | 'finished' | 'next';

export interface CompactPageBarConfig {
  backTo: string;
  title: string;
  subtitle: string;
  badge: CompactPageBarBadge;
}

/** What a competition page puts in the app header: its own title, a line under it and an optional refresh button. */
export interface PageHeaderConfig {
  title: string;
  /** Replaces the competition name line, e.g. "Hartpury Area Festival · 10:54". */
  subtitle?: string;
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

type PageHeaderEntry = { title: string; subtitle?: string; refreshLabel?: string; refresh?: () => void; editLabel?: string; edit?: () => void; editing?: boolean; plain?: boolean; backTo?: string; backLabel?: string };

interface CompactPageBarState {
  config: CompactPageBarConfig | null;
  publish: (owner: symbol, config: CompactPageBarConfig) => void;
  clear: (owner: symbol) => void;
  header: PageHeaderEntry | null;
  publishHeader: (owner: symbol, entry: PageHeaderEntry) => void;
  clearHeader: (owner: symbol) => void;
}

const CompactPageBarCtx = createContext<CompactPageBarState | null>(null);

export function CompactPageBarProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<{ owner: symbol; config: CompactPageBarConfig } | null>(null);
  const [headerEntry, setHeaderEntry] = useState<{ owner: symbol; value: PageHeaderEntry } | null>(null);
  const publishHeader = useCallback((owner: symbol, value: PageHeaderEntry) => setHeaderEntry({ owner, value }), []);
  const clearHeader = useCallback((owner: symbol) => setHeaderEntry((current) => current?.owner === owner ? null : current), []);
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

// This provider and its hooks deliberately share the same context module.
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
  const { backTo, title, subtitle, badge } = config;
  useLayoutEffect(() => {
    const ownerKey = owner.current;
    publish(ownerKey, { backTo, title, subtitle, badge });
    return () => clear(ownerKey);
  }, [backTo, title, subtitle, badge, publish, clear]);
}

/**
 * Show this page's title (and optionally a refresh button) in the app header while it is mounted.
 * Does nothing outside the app shell, so pages stay renderable on their own.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageHeader(config: PageHeaderConfig) {
  const context = useContext(CompactPageBarCtx);
  const owner = useRef(Symbol('page-header'));
  const refresh = useRef(config.onRefresh);
  const edit = useRef(config.onEdit);
  useLayoutEffect(() => { refresh.current = config.onRefresh; edit.current = config.onEdit; });
  const { title, subtitle, refreshLabel, editLabel, editing, plain, backTo, backLabel } = config;
  const hasRefresh = !!config.onRefresh;
  const hasEdit = !!config.onEdit;
  const publishHeader = context?.publishHeader;
  const clearHeader = context?.clearHeader;
  useLayoutEffect(() => {
    if (!publishHeader || !clearHeader) return;
    const ownerKey = owner.current;
    publishHeader(ownerKey, {
      title, subtitle, refreshLabel, editLabel, editing, plain, backTo, backLabel,
      refresh: hasRefresh ? () => refresh.current?.() : undefined,
      edit: hasEdit ? () => edit.current?.() : undefined,
    });
    return () => clearHeader(ownerKey);
  }, [title, subtitle, refreshLabel, editLabel, editing, plain, backTo, backLabel, hasRefresh, hasEdit, publishHeader, clearHeader]);
}
