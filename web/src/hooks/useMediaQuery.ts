import { useEffect, useState } from 'react';

export const DESKTOP_QUERY = '(min-width: 1024px)';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Follows a CSS media query. Without matchMedia (jsdom, old browsers) it stays false, so phones get the phone layout. */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setOn(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return on;
}

/** True from the `lg` breakpoint (1024px) up: laptops and desktops. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
