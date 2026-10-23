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
  clubs: [{ clubName: 'North', entries: 2, competitions: 2, firstDate: '2030-10-01', lastDate: '2031-04-12' }],
  seasons: [{ seasonId: 2031, seasonName: '2031 Season', year: 2031, rank: 1, points: 3, eventsEntered: 1 }],
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

const hit = (kind: number, name: string, competitions = 2) => ({ kind, name, key: name.toLowerCase(), competitions });
const browse = (kind: number, names: string[], overrides: Record<string, unknown> = {}) => ({
  data: { kind, query: '', page: 1, pageSize: 24, total: names.length, items: names.map((name) => hit(kind, name)), ...overrides },
});

describe('StatsPage browse', () => {
  it('lists riders straight away and links each to its profile', async () => {
    vi.mocked(api.get).mockResolvedValue(browse(0, ['Oliver S.', 'Ann Jones']));
    renderAt('/stats');
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    const link = await screen.findByRole('link', { name: /Oliver S\./ });
    expect(link).toHaveAttribute('href', '/stats/riders?name=oliver%20s.');
    expect(link).toHaveTextContent('2 competitions');
    expect(screen.getByRole('tab', { name: 'Riders' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('list', { name: 'Riders' })).toBeInTheDocument();
    expect(screen.getByText(/Only finished competitions count/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/stats/browse', expect.objectContaining({ params: { kind: 0, q: undefined, page: 1 } }));
  });

  it('switches between riders, ponies, teams and clubs', async () => {
    vi.mocked(api.get).mockImplementation(async (_url, config) => {
      const kind = (config?.params as { kind: number }).kind;
      return browse(kind, [['Rider One', 'Pony One', 'Team One', 'Club One'][kind]]);
    });
    renderAt('/stats');
    expect(await screen.findByText('Rider One')).toBeInTheDocument();
    for (const [label, name, href] of [['Ponies', 'Pony One', '/stats/ponies?name=pony%20one'], ['Teams', 'Team One', '/stats/teams?name=team%20one'], ['Clubs', 'Club One', '/stats/clubs?name=club%20one']]) {
      await userEvent.click(screen.getByRole('tab', { name: label }));
      expect(await screen.findByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', href);
      expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
    }
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Name of a club');
    await userEvent.click(screen.getByRole('tab', { name: 'Riders' }));
    expect(await screen.findByText('Rider One')).toBeInTheDocument();
  });

  it('narrows the list as you type', async () => {
    vi.mocked(api.get).mockImplementation(async (_url, config) => {
      const q = (config?.params as { q?: string }).q;
      return browse(0, q ? ['Oliver S.'] : ['Oliver S.', 'Ann Jones'], { query: q ?? '' });
    });
    renderAt('/stats');
    expect(await screen.findByText('Ann Jones')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'o');
    expect(screen.getByText('Type at least two letters to narrow the list.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'li');
    expect(await screen.findByText('1 found')).toBeInTheDocument();
    expect(screen.queryByText('Ann Jones')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/stats/browse', expect.objectContaining({ params: { kind: 0, q: 'oli', page: 1 } }));
  });

  it('starts from the tab and words in the address and says when nothing matches', async () => {
    vi.mocked(api.get).mockResolvedValue(browse(1, []));
    renderAt('/stats?kind=ponies&q=zz');
    expect(screen.getByRole('searchbox')).toHaveValue('zz');
    expect(screen.getByRole('tab', { name: 'Ponies' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    expect(screen.getByText(/No ponies in a finished competition match “zz”/)).toBeInTheDocument();
  });

  it('says so when there are no finished events yet', async () => {
    vi.mocked(api.get).mockResolvedValue(browse(0, []));
    renderAt('/stats');
    expect(await screen.findByText('No finished events yet')).toBeInTheDocument();
    expect(screen.getByText(/once a competition has finished/)).toBeInTheDocument();
  });

  it('shows more when the list runs past a page', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(browse(0, ['Ann', 'Bea'], { total: 3 }))
      .mockResolvedValueOnce(browse(0, ['Cat'], { page: 2, total: 3 }));
    renderAt('/stats');
    await userEvent.click(await screen.findByRole('button', { name: 'Show more (1 left)' }));
    expect(await screen.findByText('Cat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/stats/browse', expect.objectContaining({ params: { kind: 0, q: undefined, page: 2 } }));
  });

  it('shows the error when the list fails', async () => {
    vi.mocked(api.get).mockRejectedValue(Object.assign(new Error('busy'), { response: { status: 429 } }));
    renderAt('/stats?q=oliver');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many searches');
  });

  it('goes back from a profile to the same tab', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: anonymous });
    renderAt('/stats/ponies?name=bramble');
    expect(await screen.findByRole('link', { name: 'Back to the list' })).toHaveAttribute('href', '/stats?kind=ponies');
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
    expect(within(screen.getByRole('list', { name: 'Ponies ridden' })).getByRole('link', { name: 'Bramble' })).toHaveAttribute('href', '/stats/ponies?name=bramble');
    expect(within(screen.getByRole('list', { name: 'Clubs represented' })).getByRole('link', { name: /North/ })).toHaveAttribute('href', '/stats/clubs?name=north');
    expect(within(screen.getByRole('list', { name: 'Seasons' })).getByText('2031 Season')).toBeInTheDocument();
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
