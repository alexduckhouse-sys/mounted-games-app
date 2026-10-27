import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatusProvider, useConnectionStatus, type ConnectionStatus } from '../live/ConnectionStatusContext';
import { BACK_ONLINE_MS, ConnectionPill } from './ConnectionPill';

const START = new Date('2026-10-21T12:00:00Z').getTime();

function status(extra: Partial<ConnectionStatus> = {}): ConnectionStatus {
  return {
    connected: false, online: true, failures: 0, downSince: START,
    intervalMs: 30_000, retrying: false, retry: vi.fn(), ...extra,
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

  it('waits out a short drop, then says live updates are paused', () => {
    const retry = vi.fn();
    show(status({ retry }));
    expect(screen.queryByRole('button')).toBeNull();

    tick(14_000);
    expect(screen.queryByRole('button')).toBeNull();

    tick(1_000);
    const pill = screen.getByRole('button', { name: 'Live updates paused. Checking every 30 seconds. Tap to check now' });
    expect(pill).toHaveTextContent('Live updates paused');
    expect(screen.queryByText(/reconnecting/i)).toBeNull();
    fireEvent.click(pill);
    expect(retry).toHaveBeenCalledOnce();

    tick(30_000);
    expect(screen.getByRole('button', { name: /^Live updates paused/ })).toBeInTheDocument();
  });

  it('says plainly when the phone has no internet, and retries on tap', () => {
    const retry = vi.fn();
    show(status({ online: false, retry }));
    expect(screen.queryByRole('button')).toBeNull();
    tick(5_000);
    const pill = screen.getByRole('button', { name: 'No internet connection. Tap to try again' });
    expect(pill).toHaveTextContent('No internet connection');
    fireEvent.click(pill);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('says when the server cannot be reached', () => {
    const retry = vi.fn();
    show(status({ failures: 2, retry }));
    tick(15_000);
    const pill = screen.getByRole('button', { name: 'Can’t reach the server. Tap to try again' });
    expect(pill).toHaveTextContent('Can’t reach the server');
    fireEvent.click(pill);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps the status badge while the pill shows, and never swaps it out', () => {
    show(status({ failures: 2 }), 'On now');
    expect(screen.getByText('On now')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    tick(15_000);
    expect(screen.getByText('On now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Can’t reach the server/ })).toBeInTheDocument();
  });

  it('shows that it is trying while a requested check runs', () => {
    show(status({ online: false, retrying: true }));
    tick(5_000);
    expect(screen.getByRole('button', { name: 'Trying now' })).toBeDisabled();
  });

  it('says it is back online for a moment once the link returns after the pill was up', () => {
    const live = (
      <ConnectionStatusProvider>
        <Publish value={status({ connected: true, downSince: null })} />
        <ConnectionPill />
      </ConnectionStatusProvider>
    );
    const { rerender } = show(status({ downSince: START - 60_000 }));
    tick(1_000);
    expect(screen.getByRole('button')).toBeInTheDocument();
    rerender(live);
    expect(screen.getByRole('status')).toHaveTextContent('Back online');
    tick(BACK_ONLINE_MS);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays quiet when a short drop comes back before the pill showed', () => {
    const { rerender } = show(status());
    tick(2_000);
    rerender(
      <ConnectionStatusProvider>
        <Publish value={status({ connected: true, downSince: null })} />
        <ConnectionPill />
      </ConnectionStatusProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
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
