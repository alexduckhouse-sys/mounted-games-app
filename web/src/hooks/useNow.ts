import { useMemo, useSyncExternalStore } from 'react';

type Clock = { now: number; listeners: Set<() => void>; timer?: ReturnType<typeof setInterval> };
const clocks = new Map<number, Clock>();

function clockFor(everyMs: number) {
  let clock = clocks.get(everyMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set() };
    clocks.set(everyMs, clock);
  }
  const current = clock;
  const tick = () => {
    current.now = Date.now();
    for (const listener of current.listeners) listener();
  };
  const visibilityChanged = () => {
    clearInterval(current.timer);
    current.timer = undefined;
    tick();
    if (document.visibilityState !== 'hidden') current.timer = setInterval(tick, everyMs);
  };
  return {
    getSnapshot: () => current.now,
    subscribe: (listener: () => void) => {
      current.listeners.add(listener);
      if (current.listeners.size === 1) {
        visibilityChanged();
        document.addEventListener('visibilitychange', visibilityChanged);
      }
      return () => {
        current.listeners.delete(listener);
        if (current.listeners.size === 0) {
          clearInterval(current.timer);
          current.timer = undefined;
          document.removeEventListener('visibilitychange', visibilityChanged);
        }
      };
    },
  };
}

// Share both the subscription callbacks and the timer across all consumers of an interval.
const stores = new Map<number, ReturnType<typeof clockFor>>();
function storeFor(everyMs: number) {
  let store = stores.get(everyMs);
  if (!store) { store = clockFor(everyMs); stores.set(everyMs, store); }
  return store;
}

/** One clock per interval while visible, regardless of how many heat rows use it. */
export function useNow(everyMs: number): Date {
  const store = useMemo(() => storeFor(everyMs), [everyMs]);
  const now = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(() => new Date(now), [now]);
}
