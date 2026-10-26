import { useEffect, useState, type ReactNode } from 'react';
import { Clock, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useConnectionStatus } from '../live/ConnectionStatusContext';
import { liveState } from '../live/connectionStatus';

const time = (date: Date) => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** How long "Back online" shows once the live link returns after the pill had appeared. */
export const BACK_ONLINE_MS = 2600;

/**
 * Says what the live connection is doing, only once it has really been lost (see `liveState`). Tapping it
 * checks straight away. The pill floats just under the top bar so it never moves the bar's own controls.
 * `fallback` is the compact heat header's status badge; it always shows.
 */
export function ConnectionPill({ fallback = null }: { fallback?: ReactNode }) {
  const pill = useConnectionPill();
  return <>{fallback}{pill}</>;
}

function useConnectionPill(): ReactNode {
  const { status } = useConnectionStatus();
  const down = status != null && !status.connected;
  // Ticks while the live link is down, so the pill moves from hidden to reconnecting to checking.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!down) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [down]);

  const state = status ? liveState(status, now) : 'live';
  const shown = state !== 'live' && state !== 'connecting';
  // After the pill has been up, the link coming back gets a short green "Back online" before it goes.
  const [wasShown, setWasShown] = useState(false);
  const [returns, setReturns] = useState(0);
  const [cleared, setCleared] = useState(0);
  if (shown !== wasShown) {
    setWasShown(shown);
    if (!shown && status?.connected) setReturns(returns + 1);
  }
  useEffect(() => {
    if (returns === 0) return;
    const timer = setTimeout(() => setCleared(returns), BACK_ONLINE_MS);
    return () => clearTimeout(timer);
  }, [returns]);

  if (!status) return null;
  if (!shown) {
    if (returns > cleared && status.connected) {
      return <span role="status" className="mg-conn-pill mg-conn-back"><Wifi aria-hidden="true" />Back online</span>;
    }
    return null;
  }

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
      <WifiOff aria-hidden="true" />{updated ? `Offline · updated ${updated}` : 'Offline'}
    </button>
  );
}
