import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { StatsProfile } from '../../types';
import { StatsPage } from './StatsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const summary = {
  competitions: 2, entries: 2, placedEntries: 1, firsts: 1, seconds: 0, thirds: 0, averagePlace: 1,
  entriesWithFinals: 0, finalsReached: 0, aFinals: 0, aFinalPercent: null, races: 2, wins: 1, winPercent: 50,
  points: 3, maxPoints: 6, pointQuotaPercent: 50,
};
const anonymous: StatsProfile = {
  kind: 0, name: 'Oliver S.', key: 'oliver s.', detailed: false, raceFiguresAllFormats: false, summary,
  games: null, bestGames: null, worstGames: null, entries: null, partnerships: null,
};
const detailed: StatsProfile = {
  ...anonymous, detailed: true,
  games: [{ name: 'Bending', races: 1, wins: 1, winPercent: 100, nonFinishes: 0, points: 3, maxPoints: 3, pointQuotaPercent: 100 }],
  bestGames: ['Bending'], worstGames: [],
  entries: [
    {
      competitionId: 1, competitionName: 'Spring Games', startDate: '2031-04-12T00:00:00Z', sectionId: 2, sectionName: 'U14', format: 1,
      teamId: 3, teamName: 'North A', clubName: 'North', isHorsConcours: false, riderName: null, ponyName: 'Bramble',
      place: 1, teamsPlaced: 6, finalTier: 0, races: 2, points: 3, maxPoints: 6, pointQuotaPercent: 50,
      sessions: [{ sessionId: 9, name: 'Morning', points: 3, maxPoints: 6, rank: 2, teams: 6 }],
    },
    {
      competitionId: 4, competitionName: 'Autumn Cup', startDate: '2030-10-01T00:00:00Z', sectionId: 5, sectionName: 'Open', format: 2,
      teamId: 6, teamName: 'North HC', clubName: 'North', isHorsConcours: true, riderName: null, ponyName: null,
      place: null, teamsPlaced: 0, finalTier: null, races: 1, points: 1, maxPoints: 2, pointQuotaPercent: 50,
      sessions: [{ sessionId: 10, name: 'Final', points: 1, maxPoints: 2, rank: null, teams: 4 }],
    },
  ],
  partnerships: [{ riderName: 'Oliver S.', ponyName: 'Bramble', entries: 2, competitions: 2 }],
};

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/stats" element={<StatsPage />} />
    <Route path="/stats/:kind" element={<StatsPage />} />
    <Route path="/login" element={<p>Login page</p>} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>);
});

describe('StatsPage search', () => {
  it('searches as you type and links each hit to its profile', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {
      query: 'oli', riders: [{ kind: 0, name: 'Oliver S.', key: 'oliver s.', competitions: 2 }], ponies: [],
      teams: [{ kind: 2, name: 'Olinda A', key: 'olinda a', competitions: 1 }], clubs: [],
    } });
    renderAt('/stats');
    expect(screen.getByText(/Only finished competitions count/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'o');
    expect(screen.getByText('Type at least two letters.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'li');
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    const link = await screen.findByRole('link', { name: /Oliver S\./ });
    expect(link).toHaveAttribute('href', '/stats/riders?name=oliver%20s.');
    expect(link).toHaveTextContent('Rider · 2 competitions');
    expect(within(screen.getByRole('region', { name: 'Teams' })).getByRole('link')).toHaveTextContent('Team · 1 competition');
    expect(screen.queryByRole('region', { name: 'Ponies' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/stats/search', expect.objectContaining({ params: { q: 'oli' } }));
  });

  it('starts from the words in the address and says when nothing matches', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { query: 'zz', riders: [], ponies: [], teams: [], clubs: [] } });
    renderAt('/stats?q=zz');
    expect(screen.getByRole('searchbox')).toHaveValue('zz');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox'));
    expect(screen.getByText(/Only finished competitions count/)).toBeInTheDocument();
  });

  it('shows the error when the search fails', async () => {
    vi.mocked(api.get).mockRejectedValue(Object.assign(new Error('busy'), { response: { status: 429 } }));
    renderAt('/stats?q=oliver');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many searches');
  });
});

describe('StatsPage profile', () => {
  it('shows the summary and a sign-in prompt to anonymous visitors', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: anonymous });
    renderAt('/stats/riders?name=oliver%20s.');
    expect(screen.getByRole('status')).toHaveTextContent('Loading statistics…');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Oliver S.');
    expect(screen.getByText('Rider stats')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.queryByText('Games in individual and pairs')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/stats/riders?name=oliver%20s.', expect.anything());
    await userEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('shows games, competitions and ponies to a signed-in viewer', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'u1' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(api.get).mockResolvedValue({ data: detailed });
    renderAt('/stats/riders?name=oliver%20s.');
    expect(await screen.findByText('Games in individual and pairs')).toBeInTheDocument();
    expect(screen.getByText('Best').nextSibling).toHaveTextContent('Bending');
    const competitions = screen.getByLabelText('Competitions');
    expect(within(competitions).getByText('Spring Games')).toBeInTheDocument();
    expect(within(competitions).getByText(/U14 \(Pairs\) · North A on Bramble/)).toBeInTheDocument();
    expect(within(competitions).getByText('1st')).toBeInTheDocument();
    expect(within(competitions).getByText('of 6')).toBeInTheDocument();
    expect(within(competitions).getByText(/A Final\. Point quota 50% \(3 of 6 points over 2 races\)/)).toBeInTheDocument();
    expect(within(competitions).getByText('2nd of 6')).toBeInTheDocument();
    expect(within(competitions).getAllByText('HC')).toHaveLength(2);
    expect(within(screen.getByRole('list', { name: 'Ponies ridden' })).getByText('Bramble')).toBeInTheDocument();
  });

  it.each([
    ['a pony', 1, 'Riders', 'Oliver S.'],
    ['a team', 2, 'Riders and ponies', 'Oliver S. on Bramble'],
  ])('names the partnerships for %s', async (_label, kind, title, text) => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...detailed, kind, raceFiguresAllFormats: kind === 2, games: [], bestGames: [], worstGames: [] } });
    renderAt('/stats/teams?name=north%20a');
    expect(await screen.findByRole('list', { name: title })).toHaveTextContent(text);
    expect(screen.getByText(kind === 2 ? 'No races to show yet.' : /No individual or pairs races yet/)).toBeInTheDocument();
  });

  it('says so when there is nothing to list', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...detailed, games: [], entries: [], partnerships: [] } });
    renderAt('/stats/clubs?name=north');
    expect(await screen.findByText('No finished competitions yet.')).toBeInTheDocument();
    expect(screen.getByText('No ponies were named on the declaration forms.')).toBeInTheDocument();
  });

  it.each(['/stats/horses?name=bramble', '/stats/riders?name=x', '/stats/riders'])('explains an address it cannot use (%s)', async (path) => {
    renderAt(path);
    expect(await screen.findByText('No statistics found')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('explains a missing profile and a failed load', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(Object.assign(new Error('gone'), { response: { status: 404 } }));
    const { unmount } = renderAt('/stats/ponies?name=bramble');
    expect(await screen.findByText('No statistics found')).toBeInTheDocument();
    unmount();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    renderAt('/stats/ponies?name=bramble');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load these statistics');
  });
});
