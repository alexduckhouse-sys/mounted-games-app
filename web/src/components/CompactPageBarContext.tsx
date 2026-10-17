import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type CompactPageBarBadge = 'live' | 'finished' | 'next';

export interface CompactPageBarConfig {
  backTo: string;
  title: string;
  subtitle: string;
  badge: CompactPageBarBadge;
}

interface CompactPageBarState {
  config: CompactPageBarConfig | null;
  publish: (owner: symbol, config: CompactPageBarConfig) => void;
  clear: (owner: symbol) => void;
}

const CompactPageBarCtx = createContext<CompactPageBarState | null>(null);

export function CompactPageBarProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<{ owner: symbol; config: CompactPageBarConfig } | null>(null);
  const publish = useCallback((owner: symbol, config: CompactPageBarConfig) => setEntry({ owner, config }), []);
  const clear = useCallback((owner: symbol) => setEntry((current) => current?.owner === owner ? null : current), []);
  const value = useMemo<CompactPageBarState>(() => ({
    config: entry?.config ?? null,
    publish,
    clear,
  }), [entry, publish, clear]);
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
