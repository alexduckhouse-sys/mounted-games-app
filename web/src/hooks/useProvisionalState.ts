import { useEffect, useState } from 'react';
import type { SessionProvisionalState } from '../lib/provisionalResults';

/**
 * Works out the provisional state now and keeps it current: once a second while the query window is counting down,
 * so the pill turns Official on its own when the window closes. `compute` gets the time to use.
 */
export function useProvisionalState(compute: (nowMs: number) => SessionProvisionalState | null): SessionProvisionalState | null {
  const [now, setNow] = useState(() => Date.now());
  const state = compute(now);
  const counting = state?.status === 'provisional';
  useEffect(() => {
    if (!counting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [counting]);
  return state;
}
