import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface CurrentCompetition {
  id: number;
  name: string;
}

interface CurrentCompetitionState {
  current: CurrentCompetition | null;
  setCurrent: (c: CurrentCompetition | null) => void;
  clear: () => void;
}

const Ctx = createContext<CurrentCompetitionState | null>(null);

const STORAGE_KEY = 'mg.currentCompetition';

function load(): CurrentCompetition | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CurrentCompetition;
    if (typeof parsed.id !== 'number' || typeof parsed.name !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function CurrentCompetitionProvider({ children }: { children: ReactNode }) {
  const [current, setCurrentState] = useState<CurrentCompetition | null>(() => load());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (current) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    else window.localStorage.removeItem(STORAGE_KEY);
  }, [current]);

  const setCurrent = useCallback((c: CurrentCompetition | null) => {
    setCurrentState((prev) => {
      if (c == null) return null;
      if (prev && prev.id === c.id && prev.name === c.name) return prev;
      return c;
    });
  }, []);

  const value = useMemo<CurrentCompetitionState>(
    () => ({ current, setCurrent, clear: () => setCurrentState(null) }),
    [current, setCurrent]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentCompetition() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCurrentCompetition must be used inside CurrentCompetitionProvider');
  return ctx;
}
