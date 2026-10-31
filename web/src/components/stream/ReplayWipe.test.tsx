import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import * as exposure from '../../lib/sponsorExposure';
import { competition, sponsor } from '../../test/factories';
import type { Sponsor, StreamOverlay } from '../../types';
import { useReplayWipe, type WipeCard } from './ReplayWipe';

vi.mock('../../lib/sponsorExposure', () => ({ recordSponsorView: vi.fn(), recordSponsorSeconds: vi.fn() }));

type Wipe = (card: WipeCard, swap: () => void) => void;
let run: Wipe = () => {};
const keep = (wipe: Wipe) => { run = wipe; };

function Harness({ accent, sponsor: withSponsor = false }: { accent?: string; sponsor?: boolean }) {
  const { wipe, layer } = useReplayWipe(accent, '#102030', { sponsor: withSponsor });
  useEffect(() => keep(wipe), [wipe]);
  return <>{layer}</>;
}

const band = () => document.querySelector<HTMLElement>('.mg-wipe-band');

afterEach(() => { vi.useRealTimers(); vi.mocked(exposure.recordSponsorView).mockClear(); });

it('swaps straight away when motion is stilled', () => {
  render(<MotionConfig reducedMotion="always"><Harness /></MotionConfig>);
  const swap = vi.fn();
  act(() => run({ title: 'Replay', detail: 'Arena 1 -15s' }, swap));
  expect(swap).toHaveBeenCalledTimes(1);
  expect(band()).toBeNull();
});

it('sweeps the band over, swaps while covered, then sweeps it away', async () => {
  render(<Harness accent="#FF0000" />);
  const swap = vi.fn();
  act(() => run({ title: 'Replay', detail: 'Arena 1 -15s' }, swap));
  expect(band()).not.toBeNull();
  expect(band()!.style.getPropertyValue('--wipe-accent')).toBe('#FF0000');
  expect(screen.getByText('Replay')).toBeInTheDocument();
  expect(screen.getByText('Arena 1 -15s')).toBeInTheDocument();
  expect(swap).not.toHaveBeenCalled();
  await waitFor(() => expect(swap).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(band()).toBeNull(), { timeout: 2000 });
});

it('draws inside the full-screen element when the player is in full screen', () => {
  const frame = document.createElement('div');
  document.body.appendChild(frame);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => frame });
  try {
    render(<Harness />);
    act(() => run({ title: 'Replay' }, vi.fn()));
    expect(frame.querySelector('.mg-wipe-band')).not.toBeNull();
  } finally {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    frame.remove();
  }
});

it('marks the way back to live with a dot and no clip name', async () => {
  render(<Harness />);
  act(() => run({ title: 'Live' }, vi.fn()));
  expect(screen.getByText('Live')).toBeInTheDocument();
  expect(document.querySelector('.mg-wipe-dot')).not.toBeNull();
  expect(document.querySelector('.mg-wipe-words small')).toBeNull();
});

it('does the earlier swap at once when a second wipe starts before the band covers', async () => {
  render(<Harness />);
  const first = vi.fn();
  const second = vi.fn();
  act(() => run({ title: 'Replay', detail: 'One' }, first));
  act(() => run({ title: 'Replay', detail: 'Two' }, second));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  expect(first).toHaveBeenCalledTimes(1);
});

it('still swaps if the sweep never reports back, and cleans up on unmount', () => {
  vi.useFakeTimers();
  const { unmount } = render(<Harness />);
  const swap = vi.fn();
  act(() => run({ title: 'Replay' }, swap));
  act(() => { vi.advanceTimersByTime(800); });
  expect(swap).toHaveBeenCalledTimes(1);
  // A wipe still holding when the player closes leaves no timers behind.
  act(() => run({ title: 'Live' }, vi.fn()));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

// ---- the sponsor before a replay ----

const LOGO = '/api/competitions/4/sponsors/7/logo?v=1';
const replays = (id: number, extra: Partial<Sponsor> = {}) => sponsor(id, { name: `Sponsor ${id}`, showOn: 64, ...extra });

function inCompetition(sponsors: Sponsor[], overlay: Partial<StreamOverlay> = {}, children: ReactNode = <Harness sponsor />) {
  const value: CompetitionCtx = {
    competition: competition({ id: 4 }), reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [],
    overlay: { ...DEFAULT_OVERLAY, ...overlay }, sponsors, sponsorSkip: { count: 0, at: 0 },
  };
  return <CompetitionContext.Provider value={value}>{children}</CompetitionContext.Provider>;
}

const pause = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const WAIT = { timeout: 4000 };

it('shows the sponsor before a replay, holds the swap, and counts the view', async () => {
  render(inCompetition([replays(7, { logoUrl: LOGO })]));
  const swap = vi.fn();
  act(() => run({ title: 'Replay', detail: 'Arena 1 -15s' }, swap));
  expect(screen.getByText('Replay brought to you by')).toBeInTheDocument();
  expect(screen.getByAltText('Sponsor 7')).toHaveAttribute('src', LOGO);
  expect(screen.queryByText('Arena 1 -15s')).toBeNull();
  expect(exposure.recordSponsorView).toHaveBeenCalledWith(4, 7, 'Replays');
  // Covered by now, but the replay waits for the logo to have its moment.
  await pause(900);
  expect(swap).not.toHaveBeenCalled();
  expect(band()).not.toBeNull();
  await waitFor(() => expect(swap).toHaveBeenCalledTimes(1), WAIT);
  await waitFor(() => expect(band()).toBeNull(), WAIT);
  expect(exposure.recordSponsorView).toHaveBeenCalledTimes(1);
});

it('shows the name when the sponsor has no logo, or the logo will not load', () => {
  const { unmount } = render(inCompetition([replays(7, { name: 'Acme Feeds' })]));
  act(() => run({ title: 'Replay' }, vi.fn()));
  expect(screen.getByText('Acme Feeds')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  unmount();

  render(inCompetition([replays(8, { name: 'Bailey Saddlery', logoUrl: LOGO })]));
  act(() => run({ title: 'Replay' }, vi.fn()));
  expect(screen.queryByText('Bailey Saddlery')).toBeNull();
  fireEvent.error(screen.getByAltText('Bailey Saddlery'));
  expect(screen.getByText('Bailey Saddlery')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});

it('does not show a sponsor on the way back to live', async () => {
  render(inCompetition([replays(7)]));
  const swap = vi.fn();
  act(() => run({ title: 'Live' }, swap));
  expect(screen.queryByText('Replay brought to you by')).toBeNull();
  expect(screen.queryByText('Sponsor 7')).toBeNull();
  await waitFor(() => expect(swap).toHaveBeenCalledTimes(1));
  expect(exposure.recordSponsorView).not.toHaveBeenCalled();
});

it('shows no sponsor when the producer has switched sponsors off', async () => {
  render(inCompetition([replays(7)], { sponsorMode: 2 }));
  const swap = vi.fn();
  act(() => run({ title: 'Replay' }, swap));
  expect(screen.queryByText('Replay brought to you by')).toBeNull();
  await waitFor(() => expect(swap).toHaveBeenCalledTimes(1));
  expect(exposure.recordSponsorView).not.toHaveBeenCalled();
});

it('shows no sponsor when none has the replay place, outside a competition, or when the player has not asked for one', async () => {
  const { unmount } = render(inCompetition([sponsor(1, { showOn: 63 })]));
  const first = vi.fn();
  act(() => run({ title: 'Replay' }, first));
  expect(screen.queryByText('Replay brought to you by')).toBeNull();
  await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
  unmount();

  const outside = render(<Harness sponsor />);
  const second = vi.fn();
  act(() => run({ title: 'Replay' }, second));
  expect(screen.queryByText('Replay brought to you by')).toBeNull();
  await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  outside.unmount();

  render(inCompetition([replays(7)], {}, <Harness />));
  const third = vi.fn();
  act(() => run({ title: 'Replay' }, third));
  expect(screen.queryByText('Replay brought to you by')).toBeNull();
  await waitFor(() => expect(third).toHaveBeenCalledTimes(1));
  expect(exposure.recordSponsorView).not.toHaveBeenCalled();
});

it('takes turns through the sponsors, one for each replay, in the organiser order', async () => {
  render(inCompetition([replays(2, { sortOrder: 2 }), replays(1, { sortOrder: 1 })]));
  act(() => run({ title: 'Replay' }, vi.fn()));
  expect(screen.getByText('Sponsor 1')).toBeInTheDocument();
  await waitFor(() => expect(band()).toBeNull(), WAIT);
  act(() => run({ title: 'Replay' }, vi.fn()));
  expect(screen.getByText('Sponsor 2')).toBeInTheDocument();
  expect(screen.queryByText('Sponsor 1')).toBeNull();
  expect(vi.mocked(exposure.recordSponsorView).mock.calls.map((call) => call[1])).toEqual([1, 2]);
}, 15_000);

it('keeps the swap straight away, with no band and no sponsor, when motion is stilled', () => {
  render(<MotionConfig reducedMotion="always">{inCompetition([replays(7)])}</MotionConfig>);
  const swap = vi.fn();
  act(() => run({ title: 'Replay', detail: 'Arena 1 -15s' }, swap));
  expect(swap).toHaveBeenCalledTimes(1);
  expect(band()).toBeNull();
  expect(exposure.recordSponsorView).not.toHaveBeenCalled();
});

it('does the held swap at once when another wipe starts during the sponsor hold, and leaves no timers on unmount', async () => {
  const view = render(inCompetition([replays(7)]));
  const replay = vi.fn();
  act(() => run({ title: 'Replay' }, replay));
  await pause(700);
  expect(replay).not.toHaveBeenCalled();
  act(() => run({ title: 'Live' }, vi.fn()));
  expect(replay).toHaveBeenCalledTimes(1);
  view.unmount();
});
