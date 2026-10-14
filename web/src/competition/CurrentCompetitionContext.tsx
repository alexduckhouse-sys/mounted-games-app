import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { competitionCookie, readCompetitionCookie, type CurrentCompetition } from './preference';

export type { CurrentCompetition } from './preference';
interface Venue { competitionId: number; lat: number; lon: number }
type RememberChoice = 'ask' | 'remember' | 'visit';
interface CurrentCompetitionState {
  current: CurrentCompetition | null;
  venue: Venue | null;
  setVenue: (venue: Venue | null) => void;
  rememberChoice: RememberChoice;
  storageError: string | null;
  setCurrent: (c: CurrentCompetition | null) => void;
  setRememberChoice: (choice: RememberChoice) => void;
  clear: () => void;
}
const Ctx = createContext<CurrentCompetitionState | null>(null);

function load() {
  try {
    const saved = readCompetitionCookie(document.cookie);
    if (saved) return { current: saved, choice: 'remember' as RememberChoice };
    const visit = sessionStorage.getItem('mg.competitionVisit');
    const current = visit ? readCompetitionCookie(`mg.competition=${encodeURIComponent(visit)}`) : null;
    return { current, choice: current ? 'visit' as RememberChoice : 'ask' as RememberChoice };
  } catch {
    return { current: null, choice: 'ask' as RememberChoice };
  }
}

export function CurrentCompetitionProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(load);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [current, setCurrentState] = useState<CurrentCompetition | null>(initial.current);
  const [rememberChoice, setRememberChoice] = useState<RememberChoice>(initial.choice);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    // Retire the old preference, which was saved without asking.
    try { localStorage.removeItem('mg.currentCompetition'); } catch { /* Storage may be blocked. */ }
    try {
      document.cookie = competitionCookie(rememberChoice === 'remember' ? current : null, location.protocol === 'https:');
      if (rememberChoice === 'visit' && current) sessionStorage.setItem('mg.competitionVisit', JSON.stringify(current));
      else sessionStorage.removeItem('mg.competitionVisit');
      if (rememberChoice === 'remember' && current && readCompetitionCookie(document.cookie)?.id !== current.id) {
        setStorageError('Your browser could not save this competition. You can still use it for this visit.');
      } else setStorageError(null);
    } catch {
      setStorageError('Your browser could not save this choice. You can still use the competition.');
    }
  }, [current, rememberChoice]);

  const setCurrent = useCallback((c: CurrentCompetition | null) => {
    setCurrentState((prev) => prev?.id === c?.id && prev?.name === c?.name ? prev : c);
  }, []);
  const clear = useCallback(() => setCurrentState(null), []);
  const value = useMemo(() => ({ current, venue: venue?.competitionId === current?.id ? venue : null, setVenue, rememberChoice, storageError, setCurrent, setRememberChoice, clear }),
    [current, venue, rememberChoice, storageError, setCurrent, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentCompetition() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCurrentCompetition must be used inside CurrentCompetitionProvider');
  return ctx;
}
