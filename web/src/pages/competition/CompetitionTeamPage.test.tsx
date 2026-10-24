import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider } from '../../components/CompactPageBarContext';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import { CompetitionContext } from './context';
import { CompetitionTeamPage } from './CompetitionTeamPage';
import { publicRiderName } from '../../lib/riderNames';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

describe('CompetitionTeamPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('formats rider names respecting useInitialOnly', () => {
    expect(publicRiderName({ fullName: 'Alice Smith', useInitialOnly: true })).toBe('Alice S.');
    expect(publicRiderName({ fullName: 'Alice Smith', useInitialOnly: false })).toBe('Alice Smith');
    expect(publicRiderName({ fullName: 'Alice S.', useInitialOnly: true })).toBe('Alice S.');
  });

  it('renders team details, bib colour, toplist rank & points, follow button, next heat banner, heat scores, declared riders and season history', async () => {
    const h1 = heat(10, {
      sessionId: 1,
      orderIndex: 0,
      label: 'Heat 1',
      entries: [
        { id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 2 },
        { id: 2, teamId: 2, teamName: 'Beech B', laneIndex: 3 },
      ],
      races: [
        race(100, { name: 'Bending', orderIndex: 0, isComplete: true, results: [result(1, 1, { points: 6 }), result(2, 2, { points: 5 })] }),
        race(101, { name: 'Mug', orderIndex: 1, isComplete: false, results: [] }),
      ],
    });
    const s1 = session(1, {
      competitionSectionId: 9,
      sectionName: 'Teams Under 12',
      status: 1,
      scheduledStart: '2026-07-01T10:00:00Z',
      heats: [h1],
    });
    const comp = competition({
      id: 1,
      name: 'Summer Championships',
      sections: [{ id: 9, competitionId: 1, format: 2, ageGroup: 'Under 12', displayName: 'Teams Under 12', finalistCount: 6 }],
      teams: [
        team(1, {
          competitionSectionId: 9,
          sectionName: 'Teams Under 12',
          clubId: 5,
          clubName: 'Oak Pony Club',
          displayName: 'Oak A',
          bibColour: 'Royal Blue',
        }),
        team(2, {
          competitionSectionId: 9,
          sectionName: 'Teams Under 12',
          clubId: 6,
          clubName: 'Beech Pony Club',
          displayName: 'Beech B',
        }),
      ],
      sessions: [s1],
    });

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/standings')) {
        return Promise.resolve({ data: [standing(1, 24.01), standing(2, 18)] });
      }
      if (url === '/declaration-forms') {
        return Promise.resolve({
          data: [
            {
              id: 1,
              teamId: 1,
              teamName: 'Oak A',
              competitionId: 1,
              competitionName: 'Summer Championships',
              submittedAt: '2026-07-01T08:00:00Z',
              isLocked: false,
              riders: [
                { id: 1, fullName: 'Emma Watson', horseName: 'Pippin', ponyHeightHands: 13.2, isCaptain: true, isReserve: false, orderIndex: 0, useInitialOnly: true },
                { id: 2, fullName: 'Jack Brown', horseName: 'Bramble', isCaptain: false, isReserve: true, orderIndex: 1, useInitialOnly: false },
              ],
            },
          ],
        });
      }
      if (url === '/team-profiles') {
        return Promise.resolve({
          data: [{ id: 42, clubId: 5, clubName: 'Oak Pony Club', suffix: 'A', displayName: 'Oak A', canManage: false }],
        });
      }
      if (url === '/team-profiles/42/history') {
        return Promise.resolve({
          data: {
            profile: { id: 42, clubId: 5, clubName: 'Oak Pony Club', suffix: 'A', displayName: 'Oak A', canManage: false },
            eventTeams: [],
            publishedResults: [
              {
                seasonId: 1,
                seasonTitle: '2026 League',
                seasonYear: 2026,
                roundId: 1,
                roundOrder: 1,
                competitionName: 'Spring Qualifier',
                competitionDate: '2026-05-01',
                publicationVersion: 1,
                publishedAt: '2026-05-02T00:00:00Z',
                eventRank: 2,
                eventPoints: 20,
                seasonPoints: 9,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <MemoryRouter initialEntries={['/competitions/1/teams/1']}>
        <CompactPageBarProvider>
          <CompetitionContext.Provider
            value={{
              competition: comp,
              reload: vi.fn(),
              streams: [],
              streamingEnabled: false,
              invoke: vi.fn(),
              ready: 0,
              streamMessages: [],
            }}
          >
            <Routes>
              <Route path="/competitions/:id/teams/:teamId" element={<CompetitionTeamPage />} />
            </Routes>
          </CompetitionContext.Provider>
        </CompactPageBarProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Oak A' })).toBeInTheDocument();
    expect(screen.getByText(/Oak Pony Club/)).toBeInTheDocument();
    expect(screen.getByText('Royal Blue')).toBeInTheDocument();

    // Standings loaded: 1st · 24 pts (with .01 hidden)
    expect(await screen.findByText('1st · 24 pts')).toBeInTheDocument();

    // Next heat banner
    const nextHeatRegion = screen.getByRole('region', { name: 'Next heat' });
    expect(within(nextHeatRegion).getByText(/Session 1 · Heat 1 · Lane 2/)).toBeInTheDocument();

    // HeatScores table rendered
    expect(screen.getByRole('region', { name: 'Scores' })).toBeInTheDocument();

    // Declared riders & ponies with useInitialOnly respected
    expect(await screen.findByRole('link', { name: 'Emma W.' })).toHaveAttribute('href', expect.stringContaining('/stats/riders?name='));
    expect(screen.getByRole('link', { name: 'Pippin' })).toHaveAttribute('href', expect.stringContaining('/stats/ponies?name='));
    expect(screen.getByText(/Pippin/)).toBeInTheDocument();
    expect(screen.getByText('Jack Brown')).toBeInTheDocument();

    // Season & past competitions
    expect(await screen.findByText('Spring Qualifier')).toBeInTheDocument();
    expect(screen.getByText('2nd · 9 pts')).toBeInTheDocument();

    // Follow button
    const followBtn = screen.getByRole('button', { name: 'Follow Oak A' });
    expect(followBtn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(followBtn);
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual([{ competitionId: 1, teamId: 1 }]);
  });
});
