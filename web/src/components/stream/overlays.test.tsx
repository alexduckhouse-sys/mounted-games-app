import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamOverlay } from '../../types';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { competition } from '../../test/factories';
import { liveStream } from '../../test/streamFakes';
import { StreamOverlays } from './StreamOverlays';

function show(overlay: Partial<StreamOverlay>, extra: { label?: string | null; arena?: string } = {}) {
  const value: CompetitionCtx = {
    competition: competition(), reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [],
    overlay: { ...DEFAULT_OVERLAY, ...overlay },
  };
  return render(
    <CompetitionContext.Provider value={value}>
      <div className="relative">
        <StreamOverlays stream={liveStream({ arenaName: extra.arena ?? 'Arena 1' })} label={extra.label ?? null} reconnecting={false} muted={false} onSound={vi.fn()} />
      </div>
    </CompetitionContext.Provider>,
  );
}

afterEach(() => { vi.useRealTimers(); });

describe('producer overlays on the video', () => {
  it('shows nothing extra with the default settings', () => {
    show({});
    expect(screen.getByText('LIVE')).toBeVisible();
    expect(screen.getByText('12 watching')).toBeVisible();
    expect(screen.getByText('Live from')).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('draws each banner style', () => {
    const { unmount } = show({ bannerText: 'Lunch break until 1pm', bannerStyle: 0 });
    expect(screen.getByRole('status', { name: 'Lunch break until 1pm' })).toHaveClass('mg-ov-ticker');
    unmount();

    const lower = show({ bannerText: 'Lunch break until 1pm', bannerStyle: 1 });
    expect(screen.getByRole('status')).toHaveClass('mg-ov-lower');
    expect(screen.getByRole('status')).toHaveTextContent('Lunch break until 1pm');
    lower.unmount();

    show({ bannerText: 'Please clear the arena', bannerStyle: 2, look: { elements: { banner: { show: true, place: 'top' } } } });
    expect(screen.getByRole('status')).toHaveTextContent('Please clear the arena');
    expect(screen.getByRole('status').querySelector('.mg-ov-alert')).not.toBeNull();
  });

  it('puts a lower-bar banner at the top when asked', () => {
    show({ bannerText: 'Gates open', bannerStyle: 1, look: { elements: { banner: { show: true, place: 'top' } } } });
    expect(screen.getByRole('status')).toHaveClass('top-12');
  });

  it('keeps a banner to the arenas chosen for it, and hides it when switched off', () => {
    const { unmount } = show({ bannerText: 'Arena 1 only', bannerArenas: ['Arena 1'] }, { arena: 'Arena 2' });
    expect(screen.queryByRole('status')).toBeNull();
    unmount();
    show({ bannerText: 'Hidden', look: { elements: { banner: { show: false } } } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('hides the now-racing strip when it is off, and can move it to the top', () => {
    const { unmount } = show({ stripMode: 2 }, { label: 'Seniors · Heat 2' });
    expect(screen.queryByText('Seniors · Heat 2')).toBeNull();
    unmount();

    show({ look: { elements: { strip: { show: true, place: 'top' } } } }, { label: 'Seniors · Heat 2' });
    expect(screen.getByText('Now racing').closest('.mg-ov-strip')).toHaveClass('top-0');
  });

  it('shows the corner pieces the producer picks, in the corners they pick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T13:05:00'));
    const { container } = show({
      look: {
        size: 'large', accent: '#ff0000', logoUrl: 'https://example.com/logo.png',
        elements: {
          viewers: { show: false }, arena: { show: true, place: 'top-right' }, clock: { show: true, place: 'top-right' },
          logo: { show: true, place: 'top-right' },
        },
      },
    });

    expect(screen.queryByText('12 watching')).toBeNull();
    const topRight = screen.getByText('Arena 1').closest('div')!;
    expect(topRight).toHaveClass('right-3', 'top-3');
    expect(topRight).toHaveTextContent('13:05');
    expect(topRight.querySelector('img')).toHaveAttribute('src', 'https://example.com/logo.png');
    expect(container.querySelector('.mg-ov-large')).toHaveStyle({ '--ov-accent': '#ff0000' });

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(topRight).toHaveTextContent('13:06');
  });

  it('puts chips in the bottom corners too', () => {
    show({ look: { elements: { arena: { show: true, place: 'bottom-left' }, clock: { show: true, place: 'bottom-right' } } } });
    expect(screen.getByText('Arena 1').closest('div')).toHaveClass('left-3', 'bottom-14');
  });
});
