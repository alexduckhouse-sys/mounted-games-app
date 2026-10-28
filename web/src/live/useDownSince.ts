import { useEffect, useRef, useState } from 'react';

interface Down {
  /** When the live link was lost (ms since epoch), or null while connected. */
  since: number | null;
}

/**
 * Tracks how long the live link has been down, for the connection pill's grace periods.
 * Coming back to a tab or app that was in the background starts the clock again: a phone that
 * slept has a dead socket and needs a moment to reconnect, which isn't news.
 */
export function useDownSince(connected: boolean): { downSince: number | null } {
  const [down, setDown] = useState<Down>(() => ({ since: connected ? null : Date.now() }));
  const connectedRef = useRef(connected);
  useEffect(() => { connectedRef.current = connected; }, [connected]);

  useEffect(() => {
    // The time of the change is read here, not in render, so render stays pure.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDown((prev) => {
      if (connected) return prev.since === null ? prev : { since: null };
      return prev.since === null ? { since: Date.now() } : prev;
    });
  }, [connected]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== 'visible' || connectedRef.current) return;
      setDown({ since: Date.now() });
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, []);

  return { downSince: down.since };
}
