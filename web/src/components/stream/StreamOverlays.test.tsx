import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionDetail, StreamOverlay } from '../../types';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import { api } from '../../api';
import { deferred } from '../../test/streamFakes';
import { liveStream } from '../../test/streamFakes';
import { LiveDataCardOverlay, ProducerBanner, ScoreCardOverlay } from './OverlayExtras';
import { StreamOverlays } from './StreamOverlays';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (_path, config) => ({ data: (config?.params as { sectionId?: number } | undefined)?.sectionId === 6
    ? [{ ...standing(6, 0), teamName: 'Birch U17' }, { ...standing(5, 0), teamName: 'Cedar U17' }]
    : [{ ...standing(1, 5), teamName: 'Oak Seniors' }, { ...standing(2, 0), teamName: 'Ash Seniors' }] }));
});

function sampleCompetition(overrides: Partial<CompetitionDetail> = {}): CompetitionDetail {
  return competition({
    sections: [
      { id: 5, competitionId: 1, format: 2, ageGroup: 'Seniors', displayName: 'Teams Seniors' },
      { id: 6, competitionId: 1, format: 1, ageGroup: 'Under 17', displayName: 'Pairs Under 17' },
    ],
    teams: [
      team(1, { competitionSectionId: 5, displayName: 'Oak Seniors' }),
      team(2, { competitionSectionId: 5, displayName: 'Ash Seniors' }),
      team(3, { competitionSectionId: 5, displayName: 'Elm HC', isHorsConcours: true }),
      team(4, { competitionSectionId: 5, displayName: 'Pine Withdrawn', isWithdrawn: true }),
      team(5, { competitionSectionId: 6, displayName: 'Cedar U17' }),
      team(6, { competitionSectionId: 6, displayName: 'Birch U17' }),
    ],
    sessions: [
      session(1, {
        competitionSectionId: 5,
        sectionName: 'Teams Seniors',
        arenaName: 'Arena 1',
        status: 1,
        orderIndex: 1,
        heats: [
          heat(10, {
            label: 'Heat 1',
            orderIndex: 1,
            entries: [
              { id: 102, teamId: 2, teamName: 'Ash Seniors', laneIndex: 2 },
              { id: 101, teamId: 1, teamName: 'Oak Seniors', laneIndex: 1 },
            ],
            races: [
              race(100, {
                name: 'Bending',
                orderIndex: 1,
                isComplete: true,
                results: [
                  result(1, 1, { points: 5 }),
                  result(2, null, { points: 0, eliminated: true }),
                ],
              }),
              race(101, {
                name: 'Mug Race',
                orderIndex: 2,
                isComplete: false,
                results: [],
              }),
            ],
          }),
          heat(11, {
            label: 'Heat 2',
            orderIndex: 2,
            entries: [
              { id: 201, teamId: 1, teamName: 'Oak Seniors', laneIndex: 1 },
            ],
            races: [
              race(102, { name: 'Bending', orderIndex: 1, results: [] }),
            ],
          }),
        ],
      }),
      session(2, {
        competitionSectionId: 6,
        sectionName: null,
        name: 'Under 17 Session',
        arenaName: 'Arena 2',
        status: 0,
        orderIndex: 2,
        heats: [
          heat(12, {
            label: 'Heat A',
            orderIndex: 1,
            entries: [
              { id: 302, teamId: 6, teamName: 'Cedar U17', laneIndex: 2 },
              { id: 301, teamId: 5, teamName: 'Birch U17', laneIndex: 1 },
            ],
            races: [race(103, { name: 'Sock', orderIndex: 1, results: [] })],
          }),
        ],
      }),
    ],
    ...overrides,
  });
}

function renderWithComp(overlay: Partial<StreamOverlay>, comp = sampleCompetition(), arenaName = 'Arena 1') {
  const value: CompetitionCtx = {
    competition: comp,
    reload: vi.fn(),
    streams: [],
    streamingEnabled: true,
    invoke: vi.fn(),
    ready: 1,
    streamMessages: [],
    overlay: { ...DEFAULT_OVERLAY, ...overlay },
  };
  const content = () => (
    <CompetitionContext.Provider value={value}>
      <StreamOverlays stream={liveStream({ arenaName })} label={null} reconnecting={false} muted={false} onSound={vi.fn()} />
    </CompetitionContext.Provider>
  );
  const view = render(content());
  return { ...view, refresh: (changes: Partial<CompetitionCtx>) => { Object.assign(value, changes); view.rerender(content()); } };

}

describe('LiveDataCardOverlay and StreamOverlays data cards', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing outside a competition context or when mode is none', () => {
    const { container, unmount } = render(<LiveDataCardOverlay arenaName="Arena 1" overlay={DEFAULT_OVERLAY} />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    renderWithComp({ look: { liveCard: 'none' } });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders the live toplist card with scored standings and before race 1 state', async () => {
    const { unmount } = renderWithComp({ look: { liveCard: 'toplist' } });
    const card = screen.getByRole('region', { name: 'Live toplist: Seniors' });
    expect(card).toHaveTextContent('Seniors · Toplist');
    await waitFor(() => expect(card).toHaveTextContent('Current standings'));
    const items = within(card).getAllByRole('listitem');
    expect(items.map((el) => el.textContent)).toEqual(['1Oak Seniors5', '2Ash Seniors0']);
    unmount();

    // Explicit liveSectionId for an unscored section shows "Before Race 1"
    const unscored = renderWithComp({ look: { liveCard: 'toplist', liveSectionId: 6 } });
    const u17Card = screen.getByRole('region', { name: 'Live toplist: Under 17 Pairs' });
    await waitFor(() => expect(u17Card).toHaveTextContent('Before Race 1'));
    expect(within(u17Card).getAllByRole('listitem')[0]).toHaveTextContent('—Birch U170');
    unmount();
    unscored.unmount();

    // Empty sections returns null cleanly
    renderWithComp({ look: { liveCard: 'toplist' } }, competition({ sections: [], sessions: [], teams: [] }));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders the heat table card both during a scored heat and before any race is scored', () => {
    const { unmount } = renderWithComp({ look: { liveCard: 'heat' } });
    const card = screen.getByRole('region', { name: 'Heat table: Seniors · Heat 1' });
    expect(card).toHaveTextContent('After race 1 of 2');
    const items = within(card).getAllByRole('listitem');
    expect(items.map((el) => el.textContent)).toEqual(['1Oak Seniors+55', '2Ash SeniorsE0']);
    unmount();

    // Unscored heat in Arena 2 falls back to lane prefixes and total race count
    const unscored = renderWithComp({ bannerText: 'heat' }, sampleCompetition(), 'Arena 2');
    const arena2Card = screen.getByRole('region', { name: 'Heat table: Under 17 Session · Heat A' });
    expect(arena2Card).toHaveTextContent('1 races');
    expect(within(arena2Card).getAllByRole('listitem')[0]).toHaveTextContent('L1Birch U170');
    unscored.unmount();
  });

  it('renders starting lanes and up next cards in lane order', () => {
    const { unmount } = renderWithComp({ look: { liveCard: 'lanes' } });
    const lanes = screen.getByRole('region', { name: 'Starting lanes: Seniors · Heat 1' });
    expect(lanes).toHaveTextContent('Starting lanes');
    expect(within(lanes).getAllByRole('listitem').map((el) => el.textContent)).toEqual([
      'L1Oak SeniorsLane 1',
      'L2Ash SeniorsLane 2',
    ]);
    unmount();

    const nextView = renderWithComp({ look: { liveCard: 'next' } });
    const nextCard = screen.getByRole('region', { name: 'Up next: Seniors · Heat 2' });
    expect(nextCard).toHaveTextContent('Up next in collecting ring');
    expect(within(nextCard).getByRole('listitem')).toHaveTextContent('L1Oak SeniorsLane 1');
    nextView.unmount();
  });

  it('uses the live heat after a completed heat, and shows the next unfinished heat', () => {
    const comp = sampleCompetition();
    const current = comp.sessions[0];
    current.heats[0].races.forEach((race) => { race.isComplete = true; });
    current.heats.push(heat(13, { label: 'Heat 3', orderIndex: 3, races: [race(104)] }));
    const { unmount } = renderWithComp({ look: { liveCard: 'heat' } }, comp, ' arena 1 ');
    expect(screen.getByRole('region', { name: 'Heat table: Seniors · Heat 2' })).toBeVisible();
    unmount();
    renderWithComp({ look: { liveCard: 'next' } }, comp);
    expect(screen.getByRole('region', { name: 'Up next: Seniors · Heat 3' })).toBeVisible();
  });

  it.each(['lanes', 'heat', 'next', 'toplist'])('does not borrow another arena for the %s card', (liveCard) => {
    renderWithComp({ look: { liveCard } }, sampleCompetition(), 'Unknown Arena');
    expect(screen.queryByRole('region')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('keeps unassigned sessions separate from named arenas', () => {
    const comp = sampleCompetition();
    comp.sessions[0].arenaName = null;
    const { unmount } = renderWithComp({ look: { liveCard: 'lanes' } }, comp);
    expect(screen.queryByRole('region')).toBeNull();
    unmount();
    renderWithComp({ look: { liveCard: 'lanes' } }, comp, '');
    expect(screen.getByRole('region', { name: 'Starting lanes: Seniors · Heat 1' })).toBeVisible();
  });

  it('does not offer a completed heat as up next, and retains its final heat table', () => {
    const comp = sampleCompetition();
    comp.sessions[0].status = 2;
    const { unmount } = renderWithComp({ look: { liveCard: 'next' } }, comp);
    expect(screen.queryByRole('region')).toBeNull();
    unmount();
    renderWithComp({ look: { liveCard: 'heat' } }, comp);
    expect(screen.getByRole('region', { name: 'Heat table: Seniors · Heat 2' })).toBeVisible();
  });

  it('shows the first upcoming heat when the arena has not started', () => {
    renderWithComp({ look: { liveCard: 'next' } }, sampleCompetition(), 'Arena 2');
    expect(screen.getByRole('region', { name: 'Up next: Under 17 Session · Heat A' })).toBeVisible();
  });

  it('renders no heat card for an arena without heats', () => {
    renderWithComp({ look: { liveCard: 'lanes' } }, competition({ sessions: [] }));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('uses official final tiers, point corrections, ties and withdrawal rows, excluding HC', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { ...standing(2, 5.5), teamName: 'Ash Seniors', finalTier: 0 },
      { ...standing(1, 5.5), teamName: 'Oak Seniors', finalTier: 0 },
      { ...standing(4, 99), teamName: 'Pine Withdrawn', finalTier: 1, withdrawn: true },
      { ...standing(3, 100), teamName: 'Elm HC' },
    ] });
    renderWithComp({ look: { liveCard: 'toplist' } });
    const card = screen.getByRole('region', { name: 'Live toplist: Seniors' });
    await waitFor(() => expect(within(card).getAllByRole('listitem')).toHaveLength(3));
    expect(within(card).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '1Ash Seniors5.5', '1Oak Seniors5.5', '3Pine Withdrawn99',
    ]);
    expect(api.get).toHaveBeenCalledWith('/competitions/1/standings', expect.objectContaining({ params: { sectionId: 5 } }));
  });

  it('refreshes standings after a score change and a hub rejoin, labelling the last answer on failure', async () => {
    const comp = sampleCompetition();
    const view = renderWithComp({ look: { liveCard: 'toplist' } }, comp);
    await screen.findByText('Current standings');
    vi.mocked(api.get).mockResolvedValueOnce({ data: [{ ...standing(2, 8), teamName: 'Ash Seniors' }] });
    view.refresh({ competition: { ...comp, sessions: [...comp.sessions] } });
    await waitFor(() => expect(screen.getByRole('listitem')).toHaveTextContent('1Ash Seniors8'));
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    view.refresh({ ready: 2 });
    await screen.findByText('Last received standings');
    expect(screen.getByRole('listitem')).toHaveTextContent('1Ash Seniors8');
  });

  it('discards a late response after changing the selected age group', async () => {
    const slow = deferred<{ data: ReturnType<typeof standing>[] }>();
    vi.mocked(api.get).mockReturnValueOnce(slow.promise);
    const view = renderWithComp({ look: { liveCard: 'toplist' } });
    view.refresh({ overlay: { ...DEFAULT_OVERLAY, look: { liveCard: 'toplist', liveSectionId: 6 } } });
    await screen.findByText('Before Race 1');
    await act(async () => { slow.resolve({ data: [{ ...standing(1, 99), teamName: 'Stale Seniors' }] }); });
    expect(screen.queryByText('Stale Seniors')).toBeNull();
    expect(screen.getByRole('region', { name: 'Live toplist: Under 17 Pairs' })).toHaveTextContent('Birch U17');
  });

  it.each([{}, [null], [{ teamId: 1, teamName: 'Invalid Team', totalPoints: 'bad' }]])('handles malformed standings without inventing a ranking', async (data) => {
    vi.mocked(api.get).mockResolvedValue({ data });
    renderWithComp({ look: { liveCard: 'toplist' } });
    await screen.findByText('Standings unavailable');
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('supports ProducerBanner without a stream prop and shows sit-out S in ScoreCardOverlay', () => {
    const { unmount } = render(<ProducerBanner arenaName="Arena 1" overlay={{ ...DEFAULT_OVERLAY, bannerText: 'Tea tent open', bannerStyle: 1 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Tea tent open');
    unmount();

    const noArena = render(<ProducerBanner overlay={{ ...DEFAULT_OVERLAY, bannerText: 'toplist', bannerStyle: 1 }} />);
    expect(noArena.container).toBeEmptyDOMElement();
    noArena.unmount();

    vi.useFakeTimers();
    const now = new Date('2026-10-22T10:00:00Z').getTime();
    vi.setSystemTime(now);
    render(
      <ScoreCardOverlay
        stream={liveStream({ arenaName: 'Arena 1' })}
        overlay={{ ...DEFAULT_OVERLAY, scoreCardDelaySeconds: 0, scoreCardSeconds: 10 }}
        look={{
          accent: '#F5B82E',
          background: '#0F1E3D',
          size: 'medium',
          logoUrl: null,
          elements: {
            logo: { show: false, place: 'top-right' },
            viewers: { show: true, place: 'top-left' },
            arena: { show: false, place: 'top-left' },
            clock: { show: false, place: 'top-right' },
            strip: { show: true, place: 'bottom' },
            scoreCard: { show: true, place: 'right' },
            banner: { show: true, place: 'bottom' },
          },
        }}
        cards={[{
          key: 'sit',
          arenaName: 'Arena 1',
          heading: 'Heat 1',
          receivedAt: now,
          card: {
            heatId: 1,
            raceId: 1,
            raceName: 'Bending',
            raceNumber: 1,
            raceCount: 5,
            rows: [{ teamId: 1, teamName: 'Oak', total: 0, added: 0, eliminated: false, sitOut: true, place: 1, change: null }],
          },
        }]}
      />,
    );
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('region', { name: 'Results: Heat 1' })).toHaveTextContent('1OakS0');
  });
});
