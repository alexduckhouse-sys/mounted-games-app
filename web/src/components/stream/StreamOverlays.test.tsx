import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as framerMotion from 'framer-motion';
import type { CompetitionDetail, StreamOverlay } from '../../types';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import { api } from '../../api';
import { deferred } from '../../test/streamFakes';
import { liveStream } from '../../test/streamFakes';
import {
  BibSwatch as ExtrasBibSwatch,
  HeatBody,
  LanesBody,
  LiveDataCardOverlay,
  NextBody,
  ProducerBanner,
  ScoreCardOverlay,
  ToplistBody,
} from './OverlayExtras';
import { BibSwatch as StreamBibSwatch, StreamOverlays } from './StreamOverlays';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    useReducedMotion: vi.fn(() => true),
  };
});

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

  it('renders Now Racing Lane Bib Ticker underneath heat title when currentHeat has lanes', () => {
    const compWithBibs = sampleCompetition({
      teams: [
        team(1, { displayName: 'Red Wings', bibColour: 'red' }),
        team(2, { displayName: 'Blue Jays', bibColour: 'blue' }),
        team(3, { displayName: 'Green Hornets', bibColour: 'green' }),
      ],
    });

    const heatWithLanes = {
      id: 99,
      sessionId: 1,
      orderIndex: 1,
      races: [],
      lanes: [
        { laneNumber: 3, teamId: 3, teamName: 'Green Hornets' },
        { laneNumber: 1, teamId: 1, teamName: 'Red Wings' },
        { laneNumber: 2, teamId: 2, teamName: 'Blue Jays' },
        { laneNumber: 4, teamId: 999, riderName: 'Solo Rider' }, // no teamName, fallback to riderName
        { laneNumber: 5, teamName: 'Blue Jays' }, // lookup team by teamName
      ],
    };

    render(
      <CompetitionContext.Provider
        value={{
          competition: compWithBibs,
          reload: vi.fn(),
          streams: [],
          streamingEnabled: true,
          invoke: vi.fn(),
          ready: 1,
          streamMessages: [],
          overlay: DEFAULT_OVERLAY,
        }}
      >
        <StreamOverlays
          stream={liveStream({ arenaName: 'Arena 1' })}
          label="Seniors Heat 1"
          reconnecting={false}
          muted={false}
          onSound={vi.fn()}
          currentHeat={heatWithLanes}
        />
      </CompetitionContext.Provider>,
    );

    const ticker = screen.getByTestId('now-racing-lanes');
    expect(ticker).toBeInTheDocument();
    expect(ticker).toHaveTextContent('L1red bibRed Wings');
    expect(ticker).toHaveTextContent('L2blue bibBlue Jays');
    expect(ticker).toHaveTextContent('L3green bibGreen Hornets');
    expect(ticker).toHaveTextContent('L4Solo Rider');
    expect(ticker).toHaveTextContent('L5blue bibBlue Jays');
  });

  it('caps Now Racing Lane Bib Ticker at 6 lanes and sorts by lane number', () => {
    const heatWithManyLanes = {
      id: 99,
      sessionId: 1,
      orderIndex: 1,
      races: [],
      lanes: [
        { laneIndex: 8, teamName: 'Lane 8' },
        { laneIndex: 2, teamName: 'Lane 2' },
        { laneIndex: 7, teamName: 'Lane 7' },
        { laneIndex: 1, teamName: 'Lane 1' },
        { laneIndex: 3, teamName: 'Lane 3' },
        { laneIndex: 6, teamName: 'Lane 6' },
        { laneIndex: 5, teamName: 'Lane 5' },
        { laneIndex: 4, teamName: 'Lane 4' },
      ],
    };

    render(
      <CompetitionContext.Provider
        value={{
          competition: sampleCompetition(),
          reload: vi.fn(),
          streams: [],
          streamingEnabled: true,
          invoke: vi.fn(),
          ready: 1,
          streamMessages: [],
          overlay: DEFAULT_OVERLAY,
        }}
      >
        <StreamOverlays
          stream={liveStream({ arenaName: 'Arena 1' })}
          label="Seniors Heat 1"
          reconnecting={false}
          muted={false}
          onSound={vi.fn()}
          currentHeat={heatWithManyLanes}
        />
      </CompetitionContext.Provider>,
    );

    const ticker = screen.getByTestId('now-racing-lanes');
    expect(ticker).toBeInTheDocument();
    expect(ticker).toHaveTextContent('L1Lane 1');
    expect(ticker).toHaveTextContent('L6Lane 6');
    expect(ticker).not.toHaveTextContent('Lane 7');
    expect(ticker).not.toHaveTextContent('Lane 8');
  });

  it('renders BibSwatch in ScoreCardOverlay when teams have bibColour', () => {
    vi.useFakeTimers();
    const now = new Date('2026-10-22T10:00:00Z').getTime();
    vi.setSystemTime(now);

    const compWithBibs = sampleCompetition({
      teams: [
        team(1, { displayName: 'Oak Seniors', bibColour: 'scarlet' }),
      ],
    });

    render(
      <CompetitionContext.Provider
        value={{
          competition: compWithBibs,
          reload: vi.fn(),
          streams: [],
          streamingEnabled: true,
          invoke: vi.fn(),
          ready: 1,
          streamMessages: [],
          overlay: { ...DEFAULT_OVERLAY, scoreCardDelaySeconds: 0, scoreCardSeconds: 10 },
        }}
      >
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
            key: 'card-1',
            arenaName: 'Arena 1',
            heading: 'Heat 1',
            receivedAt: now,
            card: {
              heatId: 1,
              raceId: 1,
              raceName: 'Bending',
              raceNumber: 1,
              raceCount: 5,
              rows: [
                { teamId: 1, teamName: 'Oak Seniors', total: 6, added: 6, eliminated: false, place: 1, change: 'up' },
                { teamId: 999, teamName: 'Oak Seniors', total: 4, added: 4, eliminated: false, place: 2, change: 'down' },
                { teamId: 888, teamName: 'Unknown', total: 0, added: 0, eliminated: true, place: 3, change: null, ...({ bibColor: 'blue' } as unknown as Record<string, unknown>) },
              ],
            },
          }]}
          teams={compWithBibs.teams}
        />
      </CompetitionContext.Provider>,
    );

    act(() => { vi.advanceTimersByTime(1); });
    const card = screen.getByRole('region', { name: 'Results: Heat 1' });
    expect(card).toHaveTextContent('scarlet bib');
  });

  it('renders BibSwatch in LiveDataCardOverlay toplist, lanes, and heat when teams have bibColour', async () => {
    const compWithBibs = sampleCompetition({
      teams: [
        team(1, { competitionSectionId: 5, displayName: 'Oak Seniors', bibColour: 'red' }),
        team(2, { competitionSectionId: 5, displayName: 'Ash Seniors', bibColour: 'yellow' }),
      ],
    });

    // Toplist card
    const toplist = renderWithComp({ look: { liveCard: 'toplist' } }, compWithBibs);
    const toplistCard = screen.getByRole('region', { name: 'Live toplist: Seniors' });
    await waitFor(() => expect(within(toplistCard).getByText('red bib')).toBeInTheDocument());
    expect(within(toplistCard).getByText('yellow bib')).toBeInTheDocument();
    toplist.unmount();

    // Lanes card
    const lanes = renderWithComp({ look: { liveCard: 'lanes' } }, compWithBibs);
    const lanesCard = screen.getByRole('region', { name: 'Starting lanes: Seniors · Heat 1' });
    expect(within(lanesCard).getByText('red bib')).toBeInTheDocument();
    expect(within(lanesCard).getByText('yellow bib')).toBeInTheDocument();
    lanes.unmount();

    // Heat card
    const heatView = renderWithComp({ look: { liveCard: 'heat' } }, compWithBibs);
    const heatCard = screen.getByRole('region', { name: 'Heat table: Seniors · Heat 1' });
    expect(within(heatCard).getByText('red bib')).toBeInTheDocument();
    expect(within(heatCard).getByText('yellow bib')).toBeInTheDocument();
    heatView.unmount();

    // Next card
    const nextView = renderWithComp({ look: { liveCard: 'next' } }, compWithBibs);
    const nextCard = screen.getByRole('region', { name: 'Up next: Seniors · Heat 2' });
    expect(within(nextCard).getByText('red bib')).toBeInTheDocument();
    nextView.unmount();
  });

  it('renders and hides announcements via StreamNotice and supports sound button', () => {
    vi.useFakeTimers();
    const now = Date.now();
    const onSound = vi.fn();

    const { rerender } = render(
      <StreamOverlays
        stream={liveStream({ arenaName: 'Arena 1', hasAudio: true, audioMuted: false, status: 0 })}
        label={null}
        reconnecting={false}
        muted={true}
        onSound={onSound}
        announcement={{
          message: { id: 10, competitionId: 1, authorName: 'Chief Referee', body: 'Tack check at gate', type: 2, createdAt: new Date().toISOString(), adminOnly: false },
          receivedAt: now,
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Announcement · Tack check at gate');
    const soundButton = screen.getByRole('button', { name: 'Tap for sound' });
    soundButton.click();
    expect(onSound).toHaveBeenCalledTimes(1);

    // After 8 seconds notice fades
    act(() => { vi.advanceTimersByTime(8001); });
    expect(screen.queryByText('Announcement · Tack check at gate')).toBeNull();

    // Regular chat message (type !== 2)
    rerender(
      <StreamOverlays
        stream={liveStream({ arenaName: 'Arena 1', hasAudio: false })}
        label="Heat 1"
        reconnecting={false}
        muted={false}
        onSound={onSound}
        announcement={{
          message: { id: 11, competitionId: 1, authorName: 'Steward Jane', body: 'Lanes drawn', type: 0, createdAt: new Date().toISOString(), adminOnly: false },
          receivedAt: Date.now(),
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Steward Jane · Lanes drawn');

    // Already expired notice on mount returns null
    const old = render(
      <StreamOverlays
        stream={liveStream({ arenaName: 'Arena 1' })}
        label={null}
        reconnecting={false}
        muted={false}
        onSound={onSound}
        announcement={{
          message: { id: 12, competitionId: 1, authorName: 'Admin', body: 'Old', type: 0, createdAt: new Date().toISOString(), adminOnly: false },
          receivedAt: Date.now() - 10000,
        }}
      />,
    );
    expect(old.queryByText('Old')).toBeNull();
    old.unmount();
  });

  it('renders reconnecting and back soon camera move screens', () => {
    const { rerender } = render(
      <StreamOverlays
        stream={liveStream({ arenaName: 'Arena 1', status: 0 })}
        label={null}
        reconnecting={true}
        muted={false}
        onSound={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');

    rerender(
      <StreamOverlays
        stream={liveStream({ arenaName: 'Arena 1', angleName: 'Main Cam', status: 1 })}
        label={null}
        reconnecting={false}
        muted={false}
        onSound={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Back soon');
    expect(within(screen.getByRole('status')).getByText(/Arena 1 · Main Cam/)).toBeInTheDocument();
  });

  it('renders BibSwatch with colour or color and returns null when empty', () => {
    const { container, rerender } = render(<StreamBibSwatch colour="red" />);
    expect(screen.getByText('red bib')).toBeInTheDocument();
    rerender(<StreamBibSwatch color="blue" size={10} />);
    expect(screen.getByText('blue bib')).toBeInTheDocument();
    rerender(<StreamBibSwatch />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StreamBibSwatch colour={null} color={undefined} />);
    expect(container).toBeEmptyDOMElement();

    const extras = render(<ExtrasBibSwatch colour="green" />);
    expect(screen.getByText('green bib')).toBeInTheDocument();
    extras.rerender(<ExtrasBibSwatch color="yellow" size={10} />);
    expect(screen.getByText('yellow bib')).toBeInTheDocument();
    extras.rerender(<ExtrasBibSwatch />);
    expect(extras.container).toBeEmptyDOMElement();
  });

  it('supports stream caption and lane.lane fallback', () => {
    render(
      <StreamOverlays
        stream={liveStream({ arenaName: 'Arena 1', caption: 'Custom Caption' })}
        label="Some Heat"
        reconnecting={false}
        muted={false}
        onSound={vi.fn()}
        currentHeat={{
          id: 99,
          sessionId: 1,
          orderIndex: 1,
          races: [],
          lanes: [
            { lane: 1, teamName: 'Lane One' },
          ],
        }}
      />,
    );
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByTestId('now-racing-lanes')).toHaveTextContent('L1Lane One');
  });

  it('covers motion branches when reduced motion is disabled', () => {
    vi.mocked(framerMotion.useReducedMotion).mockReturnValue(false);

    const comp = sampleCompetition({
      teams: [
        team(1, { displayName: 'Team 1', bibColour: 'red' }),
      ],
    });

    const view = render(
      <StreamOverlays
        stream={liveStream({ arenaName: 'Arena 1' })}
        label="Heat 1"
        reconnecting={false}
        muted={false}
        onSound={vi.fn()}
        currentHeat={{
          id: 1,
          sessionId: 1,
          orderIndex: 1,
          races: [],
          lanes: [{ laneNumber: 1, teamId: 1, teamName: 'Team 1' }],
        }}
      />,
    );
    expect(view.container.querySelector('.mg-ov-strip')).toBeInTheDocument();
    view.unmount();

    // Directly render bodies with reduced=false
    const toplist = render(<ToplistBody competition={comp} rows={[{ teamId: 1, teamName: 'Team 1', position: 1, points: 5 }]} started={true} />);
    expect(toplist.container.querySelector('li')).toBeInTheDocument();
    toplist.unmount();

    const heatBody = render(<HeatBody rows={[{ teamId: 1, teamName: 'Team 1', lane: 1, pts: 5, last: 5, elim: false }]} scored={true} competition={comp} />);
    expect(heatBody.container.querySelector('li')).toBeInTheDocument();
    heatBody.unmount();

    const lanesBody = render(<LanesBody entries={[{ id: 10, teamId: 1, teamName: 'Team 1', laneIndex: 1 }]} competition={comp} />);
    expect(lanesBody.container.querySelector('li')).toBeInTheDocument();
    lanesBody.unmount();

    const nextBody = render(<NextBody entries={[{ id: 10, teamId: 1, teamName: 'Team 1', laneIndex: 1 }]} competition={comp} />);
    expect(nextBody.container.querySelector('li')).toBeInTheDocument();
    nextBody.unmount();

    // Banner with reduced=false
    const banner = render(<ProducerBanner arenaName="Arena 1" overlay={{ ...DEFAULT_OVERLAY, bannerText: 'Banner Alert', bannerStyle: 2 }} />);
    expect(banner.getByRole('status')).toBeInTheDocument();
    banner.unmount();

    const tickerBanner = render(<ProducerBanner arenaName="Arena 1" overlay={{ ...DEFAULT_OVERLAY, bannerText: 'Ticker Text', bannerStyle: 0 }} />);
    expect(tickerBanner.getByRole('status')).toBeInTheDocument();
    tickerBanner.unmount();

    // ScoreCardOverlay with reduced=false
    vi.useFakeTimers();
    const nowTime = 1700000000000;
    vi.setSystemTime(nowTime);
    const scoreCard = render(
      <ScoreCardOverlay
        stream={liveStream({ arenaName: 'Arena 1' })}
        overlay={{ ...DEFAULT_OVERLAY, scoreCardDelaySeconds: 0, scoreCardSeconds: 10 }}
        look={{
          accent: '#F5B82E', background: '#0F1E3D', size: 'medium', logoUrl: null,
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
          key: 'c1', arenaName: 'Arena 1', heading: 'Heat 1', receivedAt: nowTime,
          card: { heatId: 1, raceId: 1, raceName: 'R1', raceNumber: 1, raceCount: 1, rows: [{ teamId: 1, teamName: 'Team 1', total: 5, added: 5, eliminated: false, place: 1, change: null }] },
        }]}
        teams={comp.teams}
      />,
    );
    act(() => { vi.advanceTimersByTime(1); });
    expect(scoreCard.container.querySelector('section')).toBeInTheDocument();
    scoreCard.unmount();
    vi.useRealTimers();

    // LiveDataCardOverlay with reduced=false
    const compCtxVal: CompetitionCtx = { competition: comp, reload: vi.fn(), streams: [], streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [], overlay: { ...DEFAULT_OVERLAY, look: { liveCard: 'lanes' } } };
    const lanesCard = render(
      <CompetitionContext.Provider value={compCtxVal}>
        <LiveDataCardOverlay arenaName="Arena 1" overlay={{ ...DEFAULT_OVERLAY, look: { liveCard: 'lanes' } }} />
      </CompetitionContext.Provider>,
    );
    expect(lanesCard.container.querySelector('section')).toBeInTheDocument();
    lanesCard.unmount();

    const heatCard = render(
      <CompetitionContext.Provider value={compCtxVal}>
        <LiveDataCardOverlay arenaName="Arena 1" overlay={{ ...DEFAULT_OVERLAY, look: { liveCard: 'heat' } }} />
      </CompetitionContext.Provider>,
    );
    expect(heatCard.container.querySelector('section')).toBeInTheDocument();
    heatCard.unmount();

    const toplistCard = render(
      <CompetitionContext.Provider value={compCtxVal}>
        <LiveDataCardOverlay arenaName="Arena 1" overlay={{ ...DEFAULT_OVERLAY, look: { liveCard: 'toplist' } }} />
      </CompetitionContext.Provider>,
    );
    expect(toplistCard.container.querySelector('section')).toBeInTheDocument();
    toplistCard.unmount();

    vi.mocked(framerMotion.useReducedMotion).mockReturnValue(true);
  });

  it('covers break session in activeArenaHeat and banner fallbacks', () => {
    const comp = sampleCompetition({
      sessions: [
        session(1, { arenaName: 'Arena 1', kind: undefined, isBreak: true }),
        session(2, { arenaName: undefined, kind: undefined, isBreak: false }),
      ],
    });
    renderWithComp({ look: { liveCard: 'lanes' } }, comp, 'Arena 1');
  });
});
