import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionDetail, StreamOverlay } from '../../types';
import { CompetitionContext, type CompetitionCtx } from '../../pages/competition/context';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { competition, heat, race, result, session, team } from '../../test/factories';
import { liveStream } from '../../test/streamFakes';
import { LiveDataCardOverlay, ProducerBanner, ScoreCardOverlay } from './OverlayExtras';
import { StreamOverlays } from './StreamOverlays';

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
  return render(
    <CompetitionContext.Provider value={value}>
      <StreamOverlays stream={liveStream({ arenaName })} label={null} reconnecting={false} muted={false} onSound={vi.fn()} />
    </CompetitionContext.Provider>,
  );
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

  it('renders the live toplist card with scored standings and before race 1 state', () => {
    const { unmount } = renderWithComp({ look: { liveCard: 'toplist' } });
    const card = screen.getByRole('region', { name: 'Live toplist: Seniors' });
    expect(card).toHaveTextContent('Seniors · Toplist');
    expect(card).toHaveTextContent('Current standings');
    const items = within(card).getAllByRole('listitem');
    expect(items.map((el) => el.textContent)).toEqual(['1Oak Seniors5', '2Ash Seniors0']);
    unmount();

    // Explicit liveSectionId for an unscored section shows "Before Race 1"
    const unscored = renderWithComp({ look: { liveCard: 'toplist', liveSectionId: 6 } });
    const u17Card = screen.getByRole('region', { name: 'Live toplist: Under 17 Pairs' });
    expect(u17Card).toHaveTextContent('Before Race 1');
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

  it('handles arena fallback when no session matches the arena name or when all heats are finished', () => {
    const comp = sampleCompetition({
      sessions: [
        session(1, {
          competitionSectionId: 5,
          sectionName: 'Teams Seniors',
          arenaName: 'Main Arena',
          status: 2,
          heats: [
            heat(10, {
              label: 'Heat 1',
              orderIndex: 1,
              entries: [{ id: 101, teamId: 1, teamName: 'Oak Seniors', laneIndex: 1 }],
              races: [race(100, { results: [result(1, 1, { points: 5 })] })],
            }),
            heat(11, {
              label: 'Heat 2',
              orderIndex: 2,
              entries: [{ id: 102, teamId: 2, teamName: 'Ash Seniors', laneIndex: 1 }],
              races: [race(101, { results: [] })],
            }),
          ],
        }),
      ],
    });
    const { unmount } = renderWithComp({ look: { liveCard: 'current' in ({} as Record<string, unknown>) ? 'none' : 'lanes' } }, comp, 'Other Arena');
    // Unscored heat index > 0 selects the previous scored heat for 'current'
    expect(screen.getByRole('region', { name: 'Starting lanes: Seniors · Heat 1' })).toBeInTheDocument();
    unmount();

    const nextView = renderWithComp({ look: { liveCard: 'next' } }, comp, 'Other Arena');
    expect(screen.getByRole('region', { name: 'Up next: Seniors · Heat 2' })).toBeInTheDocument();
    nextView.unmount();

    // All heats scored in 'next' mode returns the last heat
    const allDone = sampleCompetition({
      sessions: [
        session(1, {
          status: 2,
          heats: [
            heat(10, {
              label: 'Heat 1',
              entries: [{ id: 101, teamId: 1, teamName: 'Oak Seniors', laneIndex: 1 }],
              races: [race(100, { results: [result(1, 1, { points: 5 })] })],
            }),
          ],
        }),
      ],
    });
    const doneNext = renderWithComp({ look: { liveCard: 'next' } }, allDone);
    expect(screen.getByRole('region', { name: 'Up next: Seniors · Heat 1' })).toBeInTheDocument();
    doneNext.unmount();

    // No heats at all returns null
    renderWithComp({ look: { liveCard: 'lanes' } }, competition({ sessions: [] }));
    expect(screen.queryByRole('region')).toBeNull();
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
