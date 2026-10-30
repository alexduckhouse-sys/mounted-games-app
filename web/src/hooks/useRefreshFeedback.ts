import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefreshHandler, RefreshOutcome } from '../lib/refreshOutcome';

export type RefreshPhase = 'idle' | 'loading' | RefreshOutcome;

/** A quick answer still gets this much of a turn, so the arrow doesn't flash. */
export const REFRESH_MIN_SPIN_MS = 650;
/** How long the result shows before the arrow comes back. */
export const REFRESH_RESULT_MS = 1_800;
/** API reads time out after 15 seconds, so a refresh still going after this never answered. */
export const REFRESH_GIVE_UP_MS = 20_000;

export interface RefreshFeedback {
  phase: RefreshPhase;
  tap: () => void;
}

function isPromise(value: unknown): value is Promise<RefreshOutcome | void> {
  return typeof (value as Promise<unknown> | undefined)?.then === 'function';
}

/** A short buzz when the answer arrives (Android; iPhones ignore it), a double one when it failed. */
function buzz(outcome: RefreshOutcome) {
  try {
    navigator.vibrate?.(outcome === 'failed' || outcome === 'offline' ? [20, 60, 20] : 12);
  } catch { /* not allowed here */ }
}

/**
 * Drives a refresh button: spins while the page's refresh is under way, then shows how it went for a moment.
 * Taps while it spins are ignored. A new `resetKey` (the page address) starts again with a plain arrow.
 */
export function useRefreshFeedback(onRefresh: RefreshHandler | undefined, resetKey?: unknown): RefreshFeedback {
  const [state, setState] = useState<{ key: unknown; phase: RefreshPhase }>({ key: resetKey, phase: 'idle' });
  const phase = state.key === resetKey ? state.phase : 'idle';
  const handler = useRef(onRefresh);
  const latest = useRef({ key: resetKey, phase });
  useLayoutEffect(() => {
    handler.current = onRefresh;
    latest.current = { key: resetKey, phase };
  });
  const run = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => { for (const timer of pending) clearTimeout(timer); pending.clear(); };
  }, []);

  const tap = useCallback(() => {
    const refresh = handler.current;
    const { key, phase: now } = latest.current;
    if (!refresh || now === 'loading') return;
    const id = ++run.current;
    const started = Date.now();
    const show = (next: RefreshPhase) => { if (run.current === id) setState({ key, phase: next }); };
    const after = (ms: number, then: () => void) => {
      const timer = setTimeout(() => { timers.current.delete(timer); then(); }, ms);
      timers.current.add(timer);
    };
    latest.current = { key, phase: 'loading' };
    show('loading');
    let result: ReturnType<RefreshHandler>;
    try { result = refresh(); } catch { result = Promise.resolve<RefreshOutcome>('failed'); }
    const outcome: Promise<RefreshOutcome | 'idle'> = isPromise(result)
      ? Promise.race([
        result.then((value) => value ?? 'updated', () => 'failed' as const),
        new Promise<RefreshOutcome>((resolve) => after(REFRESH_GIVE_UP_MS, () => resolve('failed'))),
      ])
      : Promise.resolve('idle' as const);
    void outcome.then((next) => {
      const finish = () => {
        // A newer tap, or a new page, has taken over.
        if (run.current !== id || latest.current.key !== key) return;
        show(next);
        if (next === 'idle') return;
        buzz(next);
        after(REFRESH_RESULT_MS, () => show('idle'));
      };
      const wait = started + REFRESH_MIN_SPIN_MS - Date.now();
      if (wait > 0) after(wait, finish);
      else finish();
    });
  }, []);

  return { phase, tap };
}
