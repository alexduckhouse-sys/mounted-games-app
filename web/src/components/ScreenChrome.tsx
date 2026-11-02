import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ScreenChromeState {
  /** True while a page has asked for the ticker dock to be left out (the scoring screen). */
  hidden: boolean;
  hide: (owner: symbol) => void;
  show: (owner: symbol) => void;
}

const Ctx = createContext<ScreenChromeState | null>(null);

export function ScreenChromeProvider({ children }: { children: ReactNode }) {
  const [owners, setOwners] = useState<symbol[]>([]);
  const hide = useCallback((owner: symbol) => setOwners((cur) => (cur.includes(owner) ? cur : [...cur, owner])), []);
  const show = useCallback((owner: symbol) => setOwners((cur) => cur.filter((o) => o !== owner)), []);
  const value = useMemo(() => ({ hidden: owners.length > 0, hide, show }), [owners, hide, show]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Whether a page has asked for the ticker dock to be hidden. False outside the app shell. */
// The provider and its hooks deliberately share this context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useChromeHidden(): boolean {
  return useContext(Ctx)?.hidden ?? false;
}

/** Hides the ticker dock for as long as `active` is true. Does nothing outside the app shell. */
// eslint-disable-next-line react-refresh/only-export-components
export function useHideChrome(active: boolean) {
  const context = useContext(Ctx);
  const owner = useRef(Symbol('hide-chrome'));
  const hide = context?.hide;
  const show = context?.show;
  useLayoutEffect(() => {
    if (!active || !hide || !show) return;
    const key = owner.current;
    hide(key);
    return () => show(key);
  }, [active, hide, show]);
}
