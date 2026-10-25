import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as framerMotion from 'framer-motion';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import * as exposure from '../../lib/sponsorExposure';
import type { Session, Sponsor, StreamOverlay } from '../../types';
import { competition, session, sponsor } from '../../test/factories';
import { liveStream } from '../../test/streamFakes';
import { SponsorOverlay } from './SponsorOverlay';
import { StreamOverlays } from './StreamOverlays';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

vi.mock('../../lib/sponsorExposure', () => ({ recordSponsorView: vi.fn(), recordSponsorSeconds: vi.fn() }));

const onBreak: Session[] = [session(1, { kind: 1, isBreak: true, status: 1, arenaName: 'Arena 1' })];
const racing: Session[] = [session(1, { kind: 0, status: 1, arenaName: 'Arena 1' })];

function ctx(sponsors: Sponsor[], sessions: Session[], overlay: Partial<StreamOverlay> = {}, skip = { count: 0, at: 0 }): CompetitionCtx {
  return {
    competition: competition({ id: 4, sessions }), reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [],
    overlay: { ...DEFAULT_OVERLAY, ...overlay }, sponsors, sponsorSkip: skip,
  };
}
const view = (value: CompetitionCtx, track = true) => (
  <CompetitionContext.Provider value={value}><div className="relative"><SponsorOverlay arenaName="Arena 1" track={track} /></div></CompetitionContext.Provider>
);

const cards = [
  sponsor(1, { name: 'Supporter Co', tier: 2, showOn: 16 }), sponsor(2, { name: 'Headline Ltd', tier: 0, showOn: 16 }), sponsor(3, { name: 'Major Plc', tier: 1, showOn: 16 }),
];

beforeEach(() => { vi.mocked(framerMotion.useReducedMotion).mockReturnValue(true); vi.useFakeTimers(); vi.setSystemTime(0); vi.mocked(exposure.recordSponsorView).mockClear(); vi.mocked(exposure.recordSponsorSeconds).mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('sponsor cards over the video', () => {
  it('rotate during a break, headline sponsor first', () => {
    render(view(ctx(cards, onBreak)));
    expect(screen.getByRole('complementary', { name: 'Headline sponsor' })).toHaveTextContent('Headline Ltd');
    act(() => { vi.advanceTimersByTime(8_100); });
    expect(screen.getByRole('complementary', { name: 'Major sponsor' })).toHaveTextContent('Major Plc');
    act(() => { vi.advanceTimersByTime(8_000); });
    expect(screen.getByRole('complementary', { name: 'Supporter sponsor' })).toHaveTextContent('Supporter Co');
    expect(screen.getByText('Supporter')).toBeInTheDocument();
  });

  it('do not show while a race is running, unless the producer forces them on', () => {
    const { container, rerender } = render(view(ctx(cards, racing)));
    expect(container.querySelector('aside')).toBeNull();
    rerender(view(ctx(cards, racing, { sponsorMode: 1 })));
    expect(screen.getByRole('complementary', { name: 'Headline sponsor' })).toBeInTheDocument();
  });

  it('are switched off by the producer, even in a break', () => {
    const { container } = render(view(ctx([...cards, sponsor(9, { showOn: 8 })], onBreak, { sponsorMode: 2 })));
    expect(container.querySelector('aside')).toBeNull();
  });

  it('move on when the producer skips, and skips from before are ignored', () => {
    const { rerender } = render(view(ctx(cards, onBreak, {}, { count: 2, at: 1 })));
    expect(screen.getByRole('complementary', { name: 'Headline sponsor' })).toBeInTheDocument();
    vi.setSystemTime(3_000);
    rerender(view(ctx(cards, onBreak, {}, { count: 3, at: 3_000 })));
    expect(screen.getByRole('complementary', { name: 'Major sponsor' })).toBeInTheDocument();
  });

  it('count each card shown and the seconds it stays, but not in a preview', () => {
    const { unmount } = render(view(ctx(cards, onBreak)));
    expect(exposure.recordSponsorView).toHaveBeenCalledWith(4, 2, 'BreakStream');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(exposure.recordSponsorSeconds).toHaveBeenCalledTimes(3);
    expect(exposure.recordSponsorSeconds).toHaveBeenCalledWith(4, 2, 'BreakStream', 1);
    unmount();

    vi.mocked(exposure.recordSponsorView).mockClear();
    vi.mocked(exposure.recordSponsorSeconds).mockClear();
    render(view(ctx(cards, onBreak), false));
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(exposure.recordSponsorView).not.toHaveBeenCalled();
    expect(exposure.recordSponsorSeconds).not.toHaveBeenCalled();
  });

  it('do not count seconds while the tab is hidden', () => {
    render(view(ctx(cards, onBreak)));
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(exposure.recordSponsorSeconds).not.toHaveBeenCalled();
    state.mockRestore();
  });
});

describe('the small logo over the video', () => {
  const logos = [sponsor(5, { name: 'Logo Co', showOn: 8 })];

  it('shows at other times, with the sponsor’s link', () => {
    render(view(ctx([sponsor(5, { name: 'Logo Co', showOn: 8, linkUrl: 'https://logo.example' })], racing)));
    expect(screen.getByRole('complementary', { name: 'Sponsor' })).toHaveTextContent('Logo Co');
    expect(screen.getByRole('link', { name: 'Logo Co' })).toHaveAttribute('rel', 'sponsored noopener noreferrer');
    expect(exposure.recordSponsorView).toHaveBeenCalledWith(4, 5, 'Stream');
  });

  it('gives way to the cards in a break', () => {
    render(view(ctx([...logos, ...cards], onBreak)));
    expect(screen.queryByRole('complementary', { name: 'Sponsor' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Headline sponsor' })).toBeInTheDocument();
  });

  it('stays when there are no break sponsors, and goes with the producer’s off switch', () => {
    const { container, rerender } = render(view(ctx(logos, onBreak)));
    expect(container.querySelector('aside')).not.toBeNull();
    rerender(view(ctx(logos, onBreak, { sponsorMode: 2 })));
    expect(container.querySelector('aside')).toBeNull();
  });

  it('draws nothing outside a competition page or without sponsors', () => {
    const { container } = render(<SponsorOverlay arenaName="Arena 1" />);
    expect(container).toBeEmptyDOMElement();
    const empty = render(view(ctx([], onBreak)));
    expect(empty.container.querySelector('aside')).toBeNull();
  });
});

describe('inside the stream overlays', () => {
  const overlays = (id: number) => (
    <CompetitionContext.Provider value={ctx(cards, onBreak)}>
      <StreamOverlays stream={liveStream({ id, arenaName: 'Arena 1' })} label={null} reconnecting={false} muted={false} onSound={vi.fn()} />
    </CompetitionContext.Provider>
  );

  it('draw over a viewer’s video and count it', () => {
    render(overlays(7));
    expect(screen.getByRole('complementary', { name: 'Headline sponsor' })).toBeInTheDocument();
    expect(exposure.recordSponsorView).toHaveBeenCalledWith(4, 2, 'BreakStream');
  });

  it('draw over the producer’s sample video without counting it', () => {
    render(overlays(0));
    expect(screen.getByRole('complementary', { name: 'Headline sponsor' })).toBeInTheDocument();
    expect(exposure.recordSponsorView).not.toHaveBeenCalled();
  });

  it('respects reduced motion when rendering cards and bugs', () => {
    vi.mocked(framerMotion.useReducedMotion).mockReturnValue(true);
    const { unmount } = render(view(ctx(cards, onBreak)));
    expect(screen.getByRole('complementary', { name: 'Headline sponsor' })).toBeInTheDocument();
    unmount();

    render(view(ctx([sponsor(5, { name: 'Logo Co', showOn: 8 })], racing)));
    expect(screen.getByRole('complementary', { name: 'Sponsor' })).toBeInTheDocument();
    vi.mocked(framerMotion.useReducedMotion).mockReturnValue(false);
  });
});
