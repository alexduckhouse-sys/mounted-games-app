import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamOverlay } from '../../types';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import type { QueuedScoreCard } from '../../lib/scoreCard';
import { competition } from '../../test/factories';
import { liveStream } from '../../test/streamFakes';
import { StreamOverlays } from './StreamOverlays';

function show(overlay: Partial<StreamOverlay>, extra: { label?: string | null; arena?: string; scoreCards?: QueuedScoreCard[] } = {}) {
  const value: CompetitionCtx = {
    competition: competition(), reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [],
    overlay: { ...DEFAULT_OVERLAY, ...overlay }, scoreCards: extra.scoreCards,
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

describe('score card on the video', () => {
  const START = new Date('2026-10-22T10:00:00Z').getTime();
  const card = (arenaName = 'Arena 1', receivedAt = START): QueuedScoreCard => ({
    key: `k-${receivedAt}`, arenaName, heading: 'Seniors Session 1 · Heat 2', receivedAt,
    card: {
      heatId: 1, raceId: 13, raceName: 'Bottle Race', raceNumber: 3, raceCount: 5,
      rows: [
        { teamId: 1, teamName: 'Pony Club Seniors A', total: 15, added: 6, eliminated: false, place: 1, change: 'up' },
        { teamId: 2, teamName: 'England Seniors', total: 14, added: 0, eliminated: true, place: 2, change: 'down' },
        { teamId: 3, teamName: 'Wales Seniors', total: 9, added: 4, eliminated: false, place: 3, change: null },
      ],
    },
  });
  const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });

  it('appears after the delay with the whole heat table, then goes', () => {
    show({ scoreCardDelaySeconds: 4, scoreCardSeconds: 10 }, { scoreCards: [card()] });
    expect(screen.queryByRole('region')).toBeNull();

    tick(4_000);
    const shown = screen.getByRole('region', { name: 'Results: Seniors Session 1 · Heat 2' });
    expect(shown).toHaveTextContent('after Bottle Race (race 3 of 5)');
    expect(shown).toHaveClass('mg-ov-card-right');
    const rows = within(shown).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['1Pony Club Seniors A+615', '2England SeniorsE14', '3Wales Seniors+49']);
    expect(within(rows[0]).getByLabelText('moved up')).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText('moved down')).toBeInTheDocument();

    tick(10_000);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows the newest card for this arena, or a card with no arena anywhere', () => {
    const { unmount } = show({ scoreCardDelaySeconds: 0 }, { scoreCards: [card('Arena 1'), card('Arena 2', START + 1)] });
    tick(1);
    expect(screen.getByRole('region')).toBeInTheDocument();
    unmount();

    show({ scoreCardDelaySeconds: 0 }, { scoreCards: [card('')], arena: 'Arena 9' });
    tick(1);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('stays away when score cards are off, hidden, for another arena, or long past', () => {
    for (const [overlay, cards, arena] of [
      [{ scoreCardMode: 2 as const }, [card()], 'Arena 1'],
      [{ look: { elements: { scoreCard: { show: false } } } }, [card()], 'Arena 1'],
      [{}, [card('Arena 2')], 'Arena 1'],
      [{}, [card('Arena 1', START - 60_000)], 'Arena 1'],
      [{}, [], 'Arena 1'],
    ] as const) {
      const { unmount } = show(overlay, { scoreCards: [...cards], arena });
      tick(5_000);
      expect(screen.queryByRole('region')).toBeNull();
      unmount();
    }
  });

  it('follows the producer’s edits: hidden rows, names and time on screen', () => {
    show({ scoreCardDelaySeconds: 0, scoreCardSeconds: 10 }, { scoreCards: [{ ...card(), hiddenTeamIds: [3], names: { 1: 'PC Seniors A' }, seconds: 20 }] });
    tick(1);
    const shown = screen.getByRole('region');
    expect(within(shown).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['1PC Seniors A+615', '2England SeniorsE14']);
    tick(15_000);
    expect(screen.getByRole('region')).toBeInTheDocument();
    tick(5_000);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('can sit along the bottom', () => {
    show({ scoreCardDelaySeconds: 0, look: { elements: { scoreCard: { show: true, place: 'bottom' } } } }, { scoreCards: [card()] });
    tick(1);
    expect(screen.getByRole('region')).toHaveClass('mg-ov-card-bottom');
  });
});
