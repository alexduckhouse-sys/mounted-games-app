import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider } from '../../components/CompactPageBarContext';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import { CompetitionContext } from './context';
import { CompetitionTeamPage } from './CompetitionTeamPage';

const state = vi.hoisted(() => ({
  toggle: vi.fn(),
  favourites: [] as { competitionId: number; teamId: number }[],
}));

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../hooks/useFavourites', () => ({
  useFavourites: () => ({ favourites: state.favourites, error: null, toggle: state.toggle }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', clubId: 1, roles: ['Trainer'] },
    hasRole: (role: string) => role === 'Trainer',
    canOrganise: () => true,
  }),
}));

describe('CompetitionTeamPage', () => {
  beforeEach(() => {
    state.toggle.mockReset();
    state.favourites = [];
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/standings')) {
        return { data: [standing(1, 9), standing(2, 5)] };
      }
      if (url === '/declaration-forms') {
        return {
          data: [
            {
              id: 10,
              teamId: 1,
              teamName: 'Oak A',
              competitionId: 1,
              competitionName: 'Spring Games',
              submittedAt: '2026-06-01T09:00:00Z',
              isLocked: true,
              bibDescription: '[flag:gb-eng] Red with white stars',
              trainerName: 'Jo Coach',
              riders: [
                { id: 1, fullName: 'Ella Hughes', horseName: 'Pickle', ponyHeightHands: 13.2, isCaptain: true, isReserve: false, isGuestRider: false, orderIndex: 0 },
                { id: 2, fullName: 'Rita Reserve', horseName: null, ponyHeightHands: null, isCaptain: false, isReserve: true, isGuestRider: true, orderIndex: 5 },
              ],
            },
          ],
        };
      }
      return { data: [] };
    });
  });

  function mount(teamId = 1) {
    const s1 = session(1, {
      competitionSectionId: 9,
      name: 'Session 1',
      arenaName: 'Main Arena',
      orderIndex: 1,
      heats: [
        heat(11, {
          sessionId: 1,
          label: 'Heat 1',
          orderIndex: 1,
          entries: [{ id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 3 }],
          races: [
            race(101, {
              name: 'Bending',
              isComplete: true,
              results: [result(1, 1, { points: 5 }), result(2, 2, { points: 4 })],
            }),
            race(102, {
              name: 'Flag',
              isComplete: false,
              results: [],
            }),
          ],
        }),
      ],
    });
    const comp = competition({
      id: 1,
      name: 'Spring Games',
      sections: [{ id: 9, competitionId: 1, format: 2, ageGroup: 'U12', displayName: 'Under 12', finalistCount: 2 }],
      teams: [
        team(1, { competitionSectionId: 9, sectionName: 'Under 12', clubName: 'Oak PC', displayName: 'Oak A', bibDescription: '[flag:gb-eng] Red with white stars' }),
        team(2, { competitionSectionId: 9, sectionName: 'Under 12', clubName: 'Beech PC', displayName: 'Beech B' }),
      ],
      sessions: [s1],
    });
    return render(
      <MemoryRouter initialEntries={[`/competitions/1/teams/${teamId}`]}>
        <CompactPageBarProvider>
          <CompetitionContext.Provider
            value={{
              competition: comp,
              reload: vi.fn(),
              streams: [],
              streamingEnabled: false,
              invoke: vi.fn(),
              ready: 1,
              streamMessages: [],
            }}
          >
            <Routes>
              <Route path="/competitions/:id/teams/:teamId" element={<CompetitionTeamPage />} />
              <Route path="/competitions/:id/toplists" element={<p>Toplist page</p>} />
            </Routes>
          </CompetitionContext.Provider>
        </CompactPageBarProvider>
      </MemoryRouter>,
    );
  }

  it('shows the team header, flag, bib description, declared riders, drawn heats with starting lane, and race breakdown', async () => {
    mount(1);
    expect(await screen.findByRole('heading', { name: 'Oak A' })).toBeInTheDocument();
    expect(screen.getByText('Bibs: Red with white stars')).toBeInTheDocument();
    expect(screen.getByText('Jo Coach')).toBeInTheDocument();

    const ridersSection = await screen.findByRole('region', { name: 'Declared riders and ponies' });
    expect(within(ridersSection).getByText('Ella Hughes')).toBeInTheDocument();
    expect(within(ridersSection).getByText('Captain')).toBeInTheDocument();
    expect(within(ridersSection).getByText('Pickle · 13.2 hh')).toBeInTheDocument();
    expect(within(ridersSection).getByText('Rita Reserve')).toBeInTheDocument();

    const heatsSection = screen.getByRole('region', { name: 'Drawn heats and starting lanes' });
    expect(within(heatsSection).getByText('Session 1 · Heat 1')).toBeInTheDocument();
    expect(within(heatsSection).getByText('Lane 1')).toBeInTheDocument();
    expect(within(heatsSection).getByText('5 pts')).toBeInTheDocument();

    const heatTables = screen.getByRole('region', { name: 'Heat tables' });
    expect(within(heatTables).getByRole('table')).toBeInTheDocument();

    const breakdown = await screen.findByRole('region', { name: 'Race-by-race breakdown' });
    expect(within(breakdown).getByText('Bending')).toBeInTheDocument();
    expect(within(breakdown).getByText('1st')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Follow Oak A' }));
    expect(state.toggle).toHaveBeenCalledWith({ competitionId: 1, teamId: 1 });

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Toplist page')).toBeInTheDocument();
  });

  it('handles an unknown team id gracefully', () => {
    mount(999);
    expect(screen.getByText('Team not found in this competition.')).toBeInTheDocument();
  });
});
