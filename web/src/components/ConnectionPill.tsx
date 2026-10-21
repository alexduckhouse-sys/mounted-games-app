import { useEffect, useState, type ReactNode } from 'react';
import { Clock, RefreshCw, WifiOff } from 'lucide-react';
import { useConnectionStatus } from '../live/ConnectionStatusContext';
import { liveState } from '../live/connectionStatus';

const time = (date: Date) => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * Says what the live connection is doing, only when it isn't working. Tapping it checks straight away.
 * `fallback` shows instead while everything is fine (the compact heat header's status badge).
 */
export function ConnectionPill({ fallback = null }: { fallback?: ReactNode }) {
  const { status } = useConnectionStatus();
  const down = status != null && !status.connected;
  // Ticks while the live link is down, so the pill moves from hidden to reconnecting to checking.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!down) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [down]);

  if (!status) return fallback;
  const state = liveState(status, now);
  if (state === 'live' || state === 'connecting') return fallback;

  if (status.retrying) {
    return (
      <button type="button" className="mg-conn-pill mg-conn-polling" disabled aria-label="Trying now">
        <RefreshCw className="mg-conn-spin" aria-hidden="true" />Trying now…
      </button>
    );
  }
  if (state === 'reconnecting') {
    return (
      <button type="button" className="mg-conn-pill mg-conn-reconnecting" onClick={status.retry} aria-label="Reconnecting. Tap to retry now">
        <RefreshCw className="mg-conn-spin" aria-hidden="true" />Reconnecting…
      </button>
    );
  }
  if (state === 'polling') {
    const seconds = Math.round(status.intervalMs / 1000);
    return (
      <button type="button" className="mg-conn-pill mg-conn-polling" onClick={status.retry} aria-label={`Checking every ${seconds} seconds. Tap to check now`}>
        <Clock aria-hidden="true" />Checking every {seconds} s
      </button>
    );
  }
  const updated = status.updatedAt ? time(status.updatedAt) : null;
  return (
    <button type="button" className="mg-conn-pill mg-conn-offline" onClick={status.retry}
      aria-label={updated ? `Offline, last updated ${updated}. Tap to retry` : 'Offline. Tap to retry'}>
      <WifiOff aria-hidden="true" />{updated ? `Offline · updated ${updated}` : 'Offline'}<RefreshCw aria-hidden="true" />
    </button>
  );
}
