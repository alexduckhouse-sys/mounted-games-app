import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatusProvider, useConnectionStatus, type ConnectionStatus } from '../live/ConnectionStatusContext';
import { ConnectionPill } from './ConnectionPill';

const START = new Date('2026-10-21T12:00:00Z').getTime();

function status(extra: Partial<ConnectionStatus> = {}): ConnectionStatus {
  return {
    connected: false, online: true, failures: 0, downSince: START, everConnected: true,
    updatedAt: new Date('2026-10-21T11:04:00Z'), intervalMs: 30_000, retrying: false, retry: vi.fn(), ...extra,
  };
}

function Publish({ value }: { value: ConnectionStatus | null }) {
  const { setStatus } = useConnectionStatus();
  useEffect(() => { setStatus(value); }, [value, setStatus]);
  return null;
}

function show(value: ConnectionStatus | null, fallback?: string) {
  return render(
    <ConnectionStatusProvider>
      <Publish value={value} />
      <ConnectionPill fallback={fallback ? <span>{fallback}</span> : undefined} />
    </ConnectionStatusProvider>,
  );
}

/** Lets the pill's one-second clock tick. */
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
afterEach(() => { vi.useRealTimers(); });

describe('ConnectionPill', () => {
  it('shows nothing, or the fallback, when no competition page is open', () => {
    const { container } = show(null);
    expect(container).toBeEmptyDOMElement();
    show(null, 'On now');
    expect(screen.getByText('On now')).toBeInTheDocument();
  });

  it('shows the fallback while the live link works', () => {
    show(status({ connected: true, downSince: null }), 'On now');
    expect(screen.getByText('On now')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('waits out a short drop, then says it is reconnecting, then that it is checking', () => {
    const retry = vi.fn();
    show(status({ retry }));
    expect(screen.queryByRole('button')).toBeNull();

    tick(3_000);
    const reconnecting = screen.getByRole('button', { name: 'Reconnecting. Tap to retry now' });
    fireEvent.click(reconnecting);
    expect(retry).toHaveBeenCalledOnce();

    tick(17_000);
    expect(screen.getByRole('button', { name: 'Checking every 30 seconds. Tap to check now' })).toHaveTextContent('Checking every 30 s');
  });

  it('shows when the phone last got an update while offline, and retries on tap', () => {
    const retry = vi.fn();
    show(status({ online: false, retry }));
    const pill = screen.getByRole('button', { name: /^Offline, last updated \d\d:\d\d\. Tap to retry$/ });
    expect(pill).toHaveTextContent(/Offline · updated \d\d:\d\d/);
    fireEvent.click(pill);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('says plainly it is offline when nothing has arrived yet', () => {
    show(status({ failures: 2, updatedAt: null }));
    expect(screen.getByRole('button', { name: 'Offline. Tap to retry' })).toHaveTextContent('Offline');
  });

  it('shows that it is trying while a requested check runs', () => {
    show(status({ online: false, retrying: true }));
    expect(screen.getByRole('button', { name: 'Trying now' })).toBeDisabled();
  });

  it('stops ticking once the live link is back', () => {
    const { rerender } = show(status());
    rerender(
      <ConnectionStatusProvider>
        <Publish value={status({ connected: true, downSince: null })} />
        <ConnectionPill />
      </ConnectionStatusProvider>,
    );
    tick(30_000);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('useConnectionStatus', () => {
  it('needs its provider', () => {
    function Orphan() { useConnectionStatus(); return null; }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow('useConnectionStatus must be used within ConnectionStatusProvider');
  });
});
