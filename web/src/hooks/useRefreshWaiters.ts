import { useMemo, useRef } from 'react';
import type { RefreshOutcome } from '../lib/refreshOutcome';

/**
 * Lets a refresh that only starts a load (bumping a counter an effect watches) hand back a promise of how it went.
 * `wait()` gives the promise; the effect calls `settle(outcome)` when a load finishes. A load that was cancelled by a
 * newer one doesn't settle, so the waiter gets the newer load's answer.
 */
export function useRefreshWaiters() {
  const waiters = useRef<Array<(outcome: RefreshOutcome) => void>>([]);
  return useMemo(() => ({
    wait: () => new Promise<RefreshOutcome>((resolve) => { waiters.current.push(resolve); }),
    /** True while someone tapped refresh and is waiting, so the work of comparing answers is only done then. */
    pending: () => waiters.current.length > 0,
    settle: (outcome: RefreshOutcome) => {
      const waiting = waiters.current;
      waiters.current = [];
      for (const resolve of waiting) resolve(outcome);
    },
  }), []);
}
