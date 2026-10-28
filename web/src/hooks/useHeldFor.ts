import { useEffect, useState } from 'react';

/**
 * True once `active` has stayed true for `ms` without a break; false again as soon as it turns false. For notices that
 * should only show when a state lasts, not for the moment it passes through (a refresh that is about to land).
 */
export function useHeldFor(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  // A break starts the wait again (reset while rendering, not in an effect).
  const [seen, setSeen] = useState(active);
  if (seen !== active) { setSeen(active); setHeld(false); }
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && held;
}
