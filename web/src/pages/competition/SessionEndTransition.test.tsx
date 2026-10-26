import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, heat, race, result, session, team } from '../../test/factories';
import type { DeclarationForm, Session, Team } from '../../types';
import { SessionEndTransition } from './SessionEndTransition';

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canManage: () => true }) }));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function mount(finished: Session, sessions: Session[], teams: Team[] = []) {
  const onAdvanced = vi.fn();
  render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes>
        <Route path="*" element={
          <>
            <SessionEndTransition competition={competition({ sessions, teams })} finishedSession={finished} onClose={vi.fn()} onAdvanced={onAdvanced} />
            <Where />
          </>
        } />
      </Routes>
    </MemoryRouter>,
  );
  return { onAdvanced };
}

describe('SessionEndTransition', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('moves on to the next session in the same arena, not another arena', async () => {
    const one = session(1, { name: 'Arena 1 morning', arenaName: 'Arena 1', status: 1 });
    const other = session(2, { name: 'Arena 2 morning', arenaName: 'Arena 2' });
    const next = session(3, { name: 'Arena 1 afternoon', arenaName: 'Arena 1' });
    const { onAdvanced } = mount(one, [one, other, next]);

    expect(screen.getByRole('heading', { name: 'Arena 1 afternoon' })).toBeInTheDocument();
    expect(screen.queryByText('Arena 2 morning')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await waitFor(() => expect(onAdvanced).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/1/status', { status: 2 });
    expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/3/status', { status: 1 });
    expect(api.put).not.toHaveBeenCalledWith('/competitions/1/sessions/2/status', expect.anything());
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/competitions/1/session/3'));
  });

  it('says it was the final session when the rest of the day is in another arena', () => {
    const one = session(1, { arenaName: 'Arena 1', status: 1 });
    mount(one, [one, session(2, { name: 'Elsewhere', arenaName: 'Arena 2' })]);
    expect(screen.getByText('That was the final session.')).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
  });

  it('shows the next break and real session of the same arena only', () => {
    const one = session(1, { arenaName: 'Arena 1', status: 1 });
    const breakOther = session(2, { name: 'Other break', arenaName: 'Arena 2', isBreak: true, kind: 1 });
    const breakHere = session(3, { name: 'Lunch', arenaName: 'Arena 1', isBreak: true, kind: 1, durationMinutes: 30 });
    const afterHere = session(4, { name: 'Afternoon', arenaName: 'Arena 1' });
    mount(one, [one, breakOther, breakHere, afterHere, session(5, { name: 'Other real', arenaName: 'Arena 2' })]);
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.getByText('Afternoon')).toBeInTheDocument();
    expect(screen.queryByText('Other break')).not.toBeInTheDocument();
    expect(screen.queryByText('Other real')).not.toBeInTheDocument();
  });

  it('treats a missing, empty or blank arena name as the same single arena', () => {
    const one = session(1, { status: 1 });
    const next = session(2, { name: 'Next one', arenaName: '' });
    mount(one, [one, next]);
    expect(screen.getByRole('heading', { name: 'Next one' })).toBeInTheDocument();
  });

  it('displays a Prize Giving (Last to First) readout for completed finals with places, points, club, trainer, riders and ponies', async () => {
    const declarations: DeclarationForm[] = [
      {
        id: 101,
        teamId: 1,
        teamName: 'Rockwood A',
        competitionId: 1,
        competitionName: 'Spring Games',
        submittedAt: '2026-06-01T08:00:00Z',
        isLocked: false,
        trainerName: 'Sarah Coach',
        riders: [
          { id: 1, fullName: 'Alice Rider', horseName: 'Starlight', isCaptain: true, isReserve: false, orderIndex: 1 },
          { id: 2, fullName: 'Ben Rider', horseName: 'Thunder', isCaptain: false, isReserve: false, orderIndex: 2 },
        ],
      },
      {
        id: 102,
        teamId: 2,
        teamName: 'Stockport A',
        competitionId: 1,
        competitionName: 'Spring Games',
        submittedAt: '2026-06-01T08:00:00Z',
        isLocked: false,
        riders: [
          { id: 3, fullName: 'Chloe Rider', horseName: 'Bramble', isCaptain: true, isReserve: false, orderIndex: 1 },
        ],
      },
    ];
    vi.mocked(api.get).mockResolvedValue({ data: declarations });

    const teams = [
      team(1, { displayName: 'Rockwood A', clubName: 'Rockwood Harriers' }),
      team(2, { displayName: 'Stockport A', clubName: 'Stockport PC', trainerName: 'Tom Trainer' }),
      team(3, { displayName: 'Gower A', clubName: 'Gower MG', trainerName: 'Gwen Coach' }),
    ];

    const finalHeat = heat(10, {
      label: 'A Final',
      orderIndex: 1,
      entries: [
        { id: 1, teamId: 1, teamName: 'Rockwood A', laneIndex: 1 },
        { id: 2, teamId: 2, teamName: 'Stockport A', laneIndex: 2 },
        { id: 3, teamId: 3, teamName: 'Gower A', laneIndex: 3 },
      ],
      races: [
        race(100, {
          name: 'Flag',
          isComplete: true,
          results: [
            result(1, 1, { teamName: 'Rockwood A', points: 25 }),
            result(2, 2, { teamName: 'Stockport A', points: 18 }),
            result(3, 3, { teamName: 'Gower A', points: 12 }),
          ],
        }),
      ],
    });

    const finalsSession = session(1, { name: 'Finals · Seniors', status: 2, heats: [finalHeat] });
    mount(finalsSession, [finalsSession], teams);

    expect(await screen.findByText('Trained by Sarah Coach')).toBeInTheDocument();
    expect(screen.getByText(/Prize Giving \(Last to First\)/i)).toBeInTheDocument();

    const aFinal = screen.getByRole('region', { name: 'A Final' });
    const items = within(aFinal).getAllByRole('listitem').filter((el) => el.parentElement?.tagName === 'OL');
    expect(items).toHaveLength(3);

    // Ordered from last place (3rd) up to 1st place
    expect(items[0]).toHaveTextContent('3rd');
    expect(items[0]).toHaveTextContent('Gower A');
    expect(items[0]).toHaveTextContent('Gower MG');
    expect(items[0]).toHaveTextContent('12 pts');
    expect(items[0]).toHaveTextContent('Trained by Gwen Coach');

    expect(items[1]).toHaveTextContent('2nd');
    expect(items[1]).toHaveTextContent('Stockport A');
    expect(items[1]).toHaveTextContent('Stockport PC');
    expect(items[1]).toHaveTextContent('18 pts');
    expect(items[1]).toHaveTextContent('Trained by Tom Trainer');
    expect(items[1]).toHaveTextContent('Chloe Rider — Bramble');

    expect(items[2]).toHaveTextContent('1st');
    expect(items[2]).toHaveTextContent('Rockwood A');
    expect(items[2]).toHaveTextContent('Rockwood Harriers');
    expect(items[2]).toHaveTextContent('25 pts');
    expect(items[2]).toHaveTextContent('Trained by Sarah Coach');
    expect(items[2]).toHaveTextContent('Alice Rider — Starlight');
    expect(items[2]).toHaveTextContent('Ben Rider — Thunder');
  });

  it('includes carried-over heat points, masks useInitialOnly surnames, omits reserves and HC teams, and orders B Final before A Final', async () => {
    const declarations: DeclarationForm[] = [
      {
        id: 201,
        teamId: 1,
        teamName: 'Rockwood A',
        competitionId: 1,
        competitionName: 'Spring Games',
        submittedAt: '2026-06-01T08:00:00Z',
        isLocked: true,
        riders: [
          { id: 11, fullName: 'Daisy MinorSurname', useInitialOnly: true, horseName: 'Misty', isCaptain: true, isReserve: false, orderIndex: 1 },
          { id: 12, fullName: 'Reserve Person', horseName: 'Spare', isCaptain: false, isReserve: true, orderIndex: 2 },
        ],
      },
    ];
    vi.mocked(api.get).mockResolvedValue({ data: declarations });

    const teams = [
      team(1, { displayName: 'Rockwood A', clubName: 'Rockwood' }),
      team(2, { displayName: 'Stockport A', clubName: 'Stockport' }),
      team(9, { displayName: 'Guest HC', isHorsConcours: true }),
    ];

    const qualifyingSession = session(1, {
      name: 'Heats',
      orderIndex: 1,
      status: 2,
      heats: [
        heat(1, {
          label: 'Heat 1',
          orderIndex: 1,
          entries: [
            { id: 1, teamId: 1, teamName: 'Rockwood A', laneIndex: 1 },
            { id: 2, teamId: 2, teamName: 'Stockport A', laneIndex: 2 },
          ],
          races: [
            race(1, {
              name: 'Bending',
              isComplete: true,
              results: [
                result(1, 1, { teamName: 'Rockwood A', points: 90 }),
                result(2, 2, { teamName: 'Stockport A', points: 60 }),
              ],
            }),
          ],
        }),
      ],
    });

    const aFinal = heat(10, {
      label: 'A Final',
      orderIndex: 1,
      entries: [
        { id: 1, teamId: 1, teamName: 'Rockwood A', laneIndex: 1 },
        { id: 2, teamId: 2, teamName: 'Stockport A', laneIndex: 2 },
        { id: 9, teamId: 9, teamName: 'Guest HC', laneIndex: 3 },
      ],
      races: [
        race(100, {
          name: 'Flag',
          isComplete: true,
          results: [
            result(1, 2, { teamName: 'Rockwood A', points: 20 }),
            result(2, 1, { teamName: 'Stockport A', points: 25 }),
            result(9, 1, { teamName: 'Guest HC', points: 30 }),
          ],
        }),
      ],
    });

    const bFinal = heat(11, {
      label: 'B Final',
      orderIndex: 2,
      entries: [{ id: 3, teamId: 3, teamName: 'Gower B', laneIndex: 1 }],
      races: [
        race(101, {
          name: 'Flag',
          isComplete: true,
          results: [result(3, 1, { teamName: 'Gower B', points: 10 })],
        }),
      ],
    });

    const finalsSession = session(2, { name: 'Finals', orderIndex: 2, status: 2, heats: [aFinal, bFinal] });
    mount(finalsSession, [qualifyingSession, finalsSession], teams);

    expect(await screen.findByText(/Daisy M\. — Misty/)).toBeInTheDocument();
    expect(screen.queryByText(/MinorSurname/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reserve Person/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Guest HC/)).not.toBeInTheDocument();

    const regions = screen.getAllByRole('region');
    expect(regions.map((r) => r.getAttribute('aria-label'))).toEqual(['B Final', 'A Final']);

    const aFinalItems = within(screen.getByRole('region', { name: 'A Final' }))
      .getAllByRole('listitem')
      .filter((el) => el.parentElement?.tagName === 'OL');
    expect(aFinalItems[0]).toHaveTextContent('2nd');
    expect(aFinalItems[0]).toHaveTextContent('Stockport A');
    expect(aFinalItems[0]).toHaveTextContent('85 pts');
    expect(aFinalItems[1]).toHaveTextContent('1st');
    expect(aFinalItems[1]).toHaveTextContent('Rockwood A');
    expect(aFinalItems[1]).toHaveTextContent('110 pts');
  });
});
