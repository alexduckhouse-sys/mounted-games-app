import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import { buildToplist } from '../../lib/toplist';
import { CompetitionContext } from './context';
import { ToplistView } from './ToplistView';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

const list = (points: number[]) => buildToplist(points.map((p, i) => standing(i + 1, p)), [], [], 9, null);
const positions = () => within(screen.getByRole('region', { name: 'Totals' })).getAllByRole('listitem').map((li) => li.textContent?.split(/[A-Za-z(]/)[0].trim());

describe('ToplistView positions', () => {
  it('shows a dash instead of every team being joint first before any race is scored', () => {
    render(<MemoryRouter><ToplistView list={list([0, 0, 0])} section={null} /></MemoryRouter>);
    expect(positions()).toEqual(['—', '—', '—']);
    expect(screen.queryByText(/joint/i)).not.toBeInTheDocument();
  });

  it('shows real positions, with ties marked and points gap behind the leader, once there are points', () => {
    render(<ToplistView list={list([6, 6, 2])} section={null} />);
    expect(positions()).toEqual(['1', '1', '3']);
    expect(screen.getAllByText('(joint)', { exact: false })).toHaveLength(2);
    expect(screen.getByText('−4')).toHaveAttribute('title', '4 behind leader');
  });

  it('does not show a zero-point gap for a hidden run-off tie-breaker', () => {
    render(<ToplistView list={list([24.01, 24])} section={null} />);
    expect(screen.queryByText('−0')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/behind leader/)).not.toBeInTheDocument();
  });

  it('uses the dash in the by-session table too and keeps the selected view when switching age groups', async () => {
    const sessions = [{ id: 1, label: 'S1', title: 'Session 1' }];
    const before = { ...list([0, 0]), bySession: { sessions, cells: new Map<number, number[]>() } };
    const { rerender } = render(<MemoryRouter><ToplistView list={before} section={{ id: 8, competitionId: 3, format: 2, ageGroup: 'Open', displayName: 'Open' }} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'By session' }));
    const body = within(screen.getByRole('region', { name: 'Points by session' })).getAllByRole('row').slice(1);
    expect(body.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['—', '—']);

    const nextSection = { ...list([5, 3]), bySession: { sessions, cells: new Map([[1, [5]], [2, [3]]]) } };
    rerender(<MemoryRouter><ToplistView list={nextSection} section={{ id: 9, competitionId: 3, format: 2, ageGroup: 'U17', displayName: 'Under 17' }} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'By session' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Points by session' })).toBeInTheDocument();
  });

  it('hides .01 run-off tie-breaker points while keeping .01 winner ranked ahead and highlights followed teams', () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ competitionId: 1, teamId: 2 }]));
    const toplist = list([24, 24.01, 24.51]);
    render(
      <MemoryRouter>
        <ToplistView list={toplist} section={{ id: 9, competitionId: 1, format: 2, ageGroup: 'Seniors', displayName: 'Seniors' }} />
      </MemoryRouter>,
    );
    const items = within(screen.getByRole('region', { name: 'Totals' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Team 3');
    expect(items[0]).toHaveTextContent('24.5');
    expect(items[1]).toHaveTextContent('Team 2');
    expect(items[1]).toHaveTextContent('24');
    expect(items[1]).not.toHaveTextContent('24.01');
    expect(items[1]).toHaveAttribute('data-followed', 'true');
    expect(items[2]).toHaveTextContent('Team 1');
    expect(screen.getByRole('link', { name: /Team 2/ })).toHaveAttribute('href', '/competitions/1/teams/2');
  });

  it('shows Prize Giving (Last to First) in Finals with trainer, club, riders and ponies', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        {
          id: 1,
          teamId: 1,
          teamName: 'Team 1',
          competitionId: 1,
          competitionName: 'Spring Games',
          submittedAt: '2026-06-01T09:00:00Z',
          isLocked: false,
          trainerName: 'Sarah Coach',
          riders: [
            { id: 10, fullName: 'Alice Smith', horseName: 'Starlight', isCaptain: true, isReserve: false, orderIndex: 0, useInitialOnly: true },
          ],
        },
      ],
    });
    const finalSession = session(2, {
      competitionSectionId: 9,
      name: 'Finals',
      heats: [
        heat(2, {
          sessionId: 2,
          label: 'A Final',
          raceRoundStage: 2,
          entries: [
            { id: 1, teamId: 1, teamName: 'Team 1', laneIndex: 1 },
            { id: 2, teamId: 2, teamName: 'Team 2', laneIndex: 2 },
          ],
          races: [
            race(2, {
              name: 'Flag',
              isComplete: true,
              results: [
                result(2, 1, { points: 6 }),
                result(1, 2, { points: 4 }),
              ],
            }),
          ],
        }),
      ],
    });
    const comp = competition({
      id: 1,
      teams: [
        team(1, { competitionSectionId: 9, clubName: 'Oak Pony Club', displayName: 'Team 1' }),
        team(2, { competitionSectionId: 9, clubName: 'Beech Pony Club', displayName: 'Team 2' }),
      ],
      sessions: [finalSession],
    });
    const toplist = buildToplist([standing(2, 6), standing(1, 4)], [finalSession], comp.teams, 9, null);

    render(
      <MemoryRouter>
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
          <ToplistView list={toplist} section={{ id: 9, competitionId: 1, format: 2, ageGroup: 'Seniors', displayName: 'Seniors' }} />
        </CompetitionContext.Provider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Prize Giving (Last to First)' }));
    const prizeList = await screen.findByRole('list', { name: 'A Final prize giving' });
    const prizeRows = within(prizeList).getAllByRole('listitem').filter((li) => li.parentElement === prizeList);
    // Ordered last (2nd: Team 1) to first (1st: Team 2)
    expect(prizeRows[0]).toHaveTextContent('2nd · Team 1');
    expect(prizeRows[0]).toHaveTextContent('Oak Pony Club');
    expect(prizeRows[0]).toHaveTextContent('Trained by Sarah Coach');
    expect(prizeRows[0]).toHaveTextContent('Alice S. — Starlight');
    expect(prizeRows[1]).toHaveTextContent('1st · Team 2');
  });
});
