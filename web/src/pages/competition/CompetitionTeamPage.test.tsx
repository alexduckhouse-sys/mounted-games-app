import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider } from '../../components/CompactPageBarContext';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import { CompetitionContext } from './context';
import { CompetitionTeamPage } from './CompetitionTeamPage';
import { publicRiderName } from '../../lib/riderNames';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const authState = vi.hoisted(() => ({ signedIn: true }));
beforeEach(() => { authState.signedIn = true; });

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: authState.signedIn ? { id: 'u1', clubId: 1, roles: ['Trainer'] } : null,
    token: authState.signedIn ? 'test-auth-session' : null,
    hasRole: (role: string) => authState.signedIn && role === 'Trainer',
    canOrganise: () => authState.signedIn,
  }),
}));

/** The one line under the team's name: place, points, bibs and races left. */
const facts = () => screen.getByRole('region', { name: 'Team summary' }).querySelector('p') as HTMLElement;

/** The value beside a label in the plain list (Average per race ...). */
const fact = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

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

  it('renders team details, the plain facts list, follow star, one heats list, declared riders and season history', async () => {
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
    // Bibs: a colour square and the colour in words.
    expect(facts()).toHaveTextContent('Royal Blue bibs');
    expect(facts().querySelector('span[aria-hidden="true"]')).not.toBeNull();

    // Standings loaded: 1st with 24 points (the .01 tie-break is hidden), and the one race left
    await waitFor(() => expect(facts()).toHaveTextContent('1st'));
    expect(facts()).toHaveTextContent('24pts');
    expect(facts()).toHaveTextContent('1 race left');
    expect(screen.queryByText('Qualifying')).toBeNull();
    expect(screen.queryByText('Next on track')).toBeNull();

    // One Heats list: the heat with its lane, and no separate next heat banner or heat tables
    const heats = screen.getByRole('region', { name: 'Heats' });
    expect(within(heats).getByText('Session 1 · Heat 1 · Lane 1')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Next heat' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Scores' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Heat tables' })).toBeNull();

    // Declared riders & ponies with useInitialOnly respected
    expect(await screen.findByRole('link', { name: 'Emma W.' })).toHaveAttribute('href', expect.stringContaining('/stats/riders?name='));
    expect(screen.getByRole('link', { name: 'Pippin' })).toHaveAttribute('href', expect.stringContaining('/stats/ponies?name='));
    expect(screen.getByText(/Pippin/)).toBeInTheDocument();
    expect(screen.getByText('Jack Brown')).toBeInTheDocument();

    // Season & past competitions
    expect(await screen.findByText('Spring Qualifier')).toBeInTheDocument();
    expect(screen.getByText('2nd · 9 pts')).toBeInTheDocument();

    // The follow star sits in the name card, a plain icon button rather than a pill
    const followBtn = within(screen.getByRole('region', { name: 'Team summary' })).getByRole('button', { name: 'Follow Oak A' });
    expect(followBtn.className).not.toMatch(/mg-icon-btn|border/);
    expect(followBtn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(followBtn);
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual([{ competitionId: 1, teamId: 1 }]);
  });
});

describe('CompetitionTeamPage detailed view', () => {
  beforeEach(() => {
    localStorage.clear();
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

  it('shows the team header, flag, bib description, declared riders, heats with lanes, stats and race breakdown', async () => {
    mount(1);
    expect(await screen.findByRole('heading', { name: 'Oak A' })).toBeInTheDocument();
    expect(facts()).toHaveTextContent('Red with white stars bibs');
    expect(screen.getByText('Jo Coach')).toBeInTheDocument();

    const ridersSection = await screen.findByRole('region', { name: 'Declared riders and ponies' });
    expect(within(ridersSection).getByText('Ella Hughes')).toBeInTheDocument();
    expect(within(ridersSection).getByText('Captain')).toBeInTheDocument();
    expect(within(ridersSection).getByRole('link', { name: 'Pickle' }).parentElement).toHaveTextContent('Pickle · 13.2 hh');
    expect(within(ridersSection).getByText('Rita Reserve')).toBeInTheDocument();

    const heatsSection = screen.getByRole('region', { name: 'Heats' });
    expect(within(heatsSection).getByText('Session 1 · Heat 1 · Lane 1')).toBeInTheDocument();
    expect(within(heatsSection).getByText('Main Arena')).toBeInTheDocument();
    expect(within(heatsSection).getByText('5 pts')).toBeInTheDocument();
    // Each heat opens in place; the session page is one link further on.
    const toggle = within(heatsSection).getByRole('button', { name: /Session 1 · Heat 1/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(heatsSection).queryByRole('link', { name: /Open full session view/ })).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByRole('table')).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByRole('link', { name: /Open full session view/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=11');
    expect((panel as HTMLElement).querySelector('tr.heat-row-me')).not.toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Stats: a plain list, then each race with its runs, best place and average
    const stats = screen.getByRole('region', { name: 'Stats' });
    expect(fact('Average per race')).toHaveTextContent('5.0 pts');
    expect(fact('Average place')).toHaveTextContent('1.0');
    expect(fact('Races won')).toHaveTextContent('1 of 1');
    expect(fact('Point quota')).toHaveTextContent('100%');
    expect(within(stats).getByText('By race')).toBeInTheDocument();
    expect(within(stats).getByText('1 run · best 1st · average 5.0 pts')).toBeInTheDocument();

    const breakdown = await screen.findByRole('region', { name: 'Race-by-race breakdown' });
    expect(within(breakdown).getByText('Bending')).toBeInTheDocument();
    expect(within(breakdown).getByText('1st')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Follow Oak A' }));
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual([{ competitionId: 1, teamId: 1 }]);

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Toplist page')).toBeInTheDocument();
  });

  it('handles an unknown team id gracefully', () => {
    mount(999);
    expect(screen.getByText('Team not found in this competition.')).toBeInTheDocument();
  });
});


it('renders one embedded score table for an entire race-finals session without replacing the team header', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  const entries = [{ id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 1 }];
  const heats = [
    heat(11, { sessionId: 1, orderIndex: 0, label: 'Bending · Q1', raceRoundId: 100, raceRoundStage: 1, entries,
      races: [race(101, { name: 'Bending', isComplete: true, results: [result(1, 1, { points: 1 })] })] }),
    heat(12, { sessionId: 1, orderIndex: 1, label: 'Bending · Final', raceRoundId: 100, raceRoundStage: 2, entries,
      races: [race(102, { name: 'Bending', results: [] })] }),
  ];
  const comp = competition({ teams: [team(1, { displayName: 'Oak A' })], sessions: [session(1, { heats })] });
  render(<MemoryRouter initialEntries={['/competitions/1/teams/1']}><CompactPageBarProvider>
    <CompetitionContext.Provider value={{ competition: comp, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] }}>
      <Routes><Route path="/competitions/:id/teams/:teamId" element={<CompetitionTeamPage />} /></Routes>
    </CompetitionContext.Provider>
  </CompactPageBarProvider></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1, name: 'Oak A' })).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  // A heat shows its lane; a final doesn't, because final lanes come from the rankings.
  const heatList = within(screen.getByRole('region', { name: 'Heats' }));
  expect(heatList.getByText('Session 1 · Bending · Q1 · Lane 1')).toBeInTheDocument();
  expect(heatList.getByText('Session 1 · Bending · Final')).toBeInTheDocument();
  expect(heatList.queryByText(/Final · Lane/)).toBeNull();
  expect(await screen.findByText('No dec form yet.')).toBeInTheDocument();
});


describe('declaration response scoping', () => {
  const privateForm = { id: 1, competitionId: 1, teamId: 1, trainerName: 'Private Test Coach', riders: [{ id: 1, fullName: 'Private Test Rider', horseName: 'Test Pony', orderIndex: 0 }] };
  function view() {
    const comp = competition({ teams: [team(1, { displayName: 'Oak A' }), team(2, { displayName: 'Birch B' })] });
    return <MemoryRouter initialEntries={['/competitions/1/teams/1']}><CompactPageBarProvider>
      <CompetitionContext.Provider value={{ competition: comp, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] }}>
        <Link to="/competitions/1/teams/2">Switch team</Link>
        <Routes><Route path="/competitions/:id/teams/:teamId" element={<CompetitionTeamPage />} /></Routes>
      </CompetitionContext.Provider>
    </CompactPageBarProvider></MemoryRouter>;
  }

  it('clears a staff response immediately on sign-out while the public response is still pending', async () => {
    let resolvePublic!: (value: { data: unknown[] }) => void;
    vi.mocked(api.get).mockImplementation((url: string) => url === '/declaration-forms'
      ? authState.signedIn ? Promise.resolve({ data: [privateForm] }) : new Promise((resolve) => { resolvePublic = resolve; })
      : Promise.resolve({ data: [] }));
    const page = render(view());
    expect(await screen.findByText('Private Test Coach')).toBeInTheDocument();
    authState.signedIn = false;
    page.rerender(view());
    expect(screen.queryByText('Private Test Coach')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Test Rider')).not.toBeInTheDocument();
    expect(screen.getByText('Loading declaration…')).toBeInTheDocument();
    await act(async () => resolvePublic({ data: [] }));
    expect(screen.getByText('No dec form yet.')).toBeInTheDocument();
  });

  it('hides the previous team declaration during navigation before the next response arrives', async () => {
    let resolveNext!: (value: { data: unknown[] }) => void;
    let declarations = 0;
    vi.mocked(api.get).mockImplementation((url: string) => url === '/declaration-forms'
      ? declarations++ === 0 ? Promise.resolve({ data: [privateForm] }) : new Promise((resolve) => { resolveNext = resolve; })
      : Promise.resolve({ data: [] }));
    render(view());
    expect(await screen.findByText('Private Test Rider')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Switch team' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Birch B' })).toBeInTheDocument();
    expect(screen.queryByText('Private Test Rider')).not.toBeInTheDocument();
    expect(screen.getByText('Loading declaration…')).toBeInTheDocument();
    await act(async () => resolveNext({ data: [] }));
    expect(screen.getByText('No dec form yet.')).toBeInTheDocument();
  });

  it('ignores a late staff response after sign-out', async () => {
    let resolveStaff!: (value: { data: unknown[] }) => void;
    vi.mocked(api.get).mockImplementation((url: string) => url === '/declaration-forms' && authState.signedIn
      ? new Promise((resolve) => { resolveStaff = resolve; }) : Promise.resolve({ data: [] }));
    const page = render(view());
    authState.signedIn = false;
    page.rerender(view());
    expect(await screen.findByText('No dec form yet.')).toBeInTheDocument();
    await act(async () => resolveStaff({ data: [privateForm] }));
    expect(screen.queryByText('Private Test Rider')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Test Coach')).not.toBeInTheDocument();
  });
});


it('shows the current place and points from the toplist, finals included', async () => {
  vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.includes('/standings') ? [standing(1, 20), standing(2, 8)] : [] }));
  const entries = [{ id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 0 }, { id: 2, teamId: 2, teamName: 'Birch B', laneIndex: 1 }];
  const comp = competition({
    teams: [team(1, { competitionSectionId: 9, displayName: 'Oak A' }), team(2, { competitionSectionId: 9, displayName: 'Birch B' })],
    sections: [{ id: 9, competitionId: 1, format: 2, ageGroup: 'Open', displayName: 'Open', finalistCount: 2 }],
    sessions: [
      session(1, { competitionSectionId: 9, name: 'Qualifier', orderIndex: 1, heats: [heat(11, { sessionId: 1, label: 'Heat 1', entries,
        races: [race(101, { name: 'Bending', isComplete: true, results: [result(1, 1, { points: 4 }), result(2, 2, { points: 6 })] })] })] }),
      session(2, { competitionSectionId: 9, name: 'Finals', orderIndex: 2, heats: [heat(12, { sessionId: 2, label: 'A Final', entries,
        races: [race(102, { name: 'Flag', isComplete: true, results: [result(3, 1, { points: 16 }), result(4, 2, { points: 2 })] })] })] }),
    ],
  });
  render(<MemoryRouter initialEntries={['/competitions/1/teams/1']}><CompactPageBarProvider>
    <CompetitionContext.Provider value={{ competition: comp, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] }}>
      <Routes><Route path="/competitions/:id/teams/:teamId" element={<CompetitionTeamPage />} /></Routes>
    </CompetitionContext.Provider>
  </CompactPageBarProvider></MemoryRouter>);
  await waitFor(() => expect(facts()).toHaveTextContent('1st'));
  expect(facts()).toHaveTextContent('20pts');
  const heats = within(screen.getByRole('region', { name: 'Heats' }));
  expect(heats.getByText('Qualifier · Heat 1 · Lane 1')).toBeInTheDocument();
  expect(heats.getByText('Finals · A Final')).toBeInTheDocument();
});

it('says stats show once the team has raced, and that it is not placed yet', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  const comp = competition({
    teams: [team(1, { displayName: 'Oak A' })],
    sessions: [session(1, { heats: [heat(11, { sessionId: 1, label: 'Heat 1', entries: [{ id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 0 }], races: [race(101, { name: 'Bending' })] })] })],
  });
  render(<MemoryRouter initialEntries={['/competitions/1/teams/1']}><CompactPageBarProvider>
    <CompetitionContext.Provider value={{ competition: comp, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] }}>
      <Routes><Route path="/competitions/:id/teams/:teamId" element={<CompetitionTeamPage />} /></Routes>
    </CompetitionContext.Provider>
  </CompactPageBarProvider></MemoryRouter>);
  expect(await screen.findByText('Stats show once Oak A has raced.')).toBeInTheDocument();
  expect(screen.queryByText('Average per race')).toBeNull();
  expect(screen.queryByText('By race')).toBeNull();
  expect(facts()).toHaveTextContent('Not placed yet');
  expect(facts()).toHaveTextContent('0pts');
  expect(facts()).toHaveTextContent('No races left');
});
