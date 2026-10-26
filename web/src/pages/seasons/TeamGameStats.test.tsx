import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { TeamGameStats } from './TeamGameStats';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const summary = {
  competitions: 1, entries: 1, placedEntries: 1, firsts: 0, seconds: 0, thirds: 0, averagePlace: 7.9,
  entriesWithFinals: 1, finalsReached: 1, aFinals: 1, aFinalPercent: 100, races: 12, wins: 2, winPercent: 16.7,
  points: 49, maxPoints: 84, pointQuotaPercent: 58.3,
};
const games = [
  { name: 'Two Flag', races: 12, wins: 2, winPercent: 16.7, nonFinishes: 0, points: 49, maxPoints: 84, pointQuotaPercent: 58.3, averagePoints: 4.1, averagePlace: 5.8 },
  { name: 'Mug Shuffle', races: 12, wins: 1, winPercent: 8.3, nonFinishes: 1, points: 43, maxPoints: 84, pointQuotaPercent: 51.2, averagePoints: 3.6, averagePlace: 6.9 },
];
// What the API sends a visitor who isn't signed in: the games are there, the rest of the detail is not.
const profile = {
  kind: 2, name: 'North A', key: 'p1', detailed: false, raceFiguresAllFormats: true, summary,
  games, bestGames: ['Two Flag'], worstGames: ['Mug Shuffle'], entries: null, partnerships: null,
};

const renderStats = (linked: number) => render(<MemoryRouter><TeamGameStats profileId="p1" linked={linked} /></MemoryRouter>);

beforeEach(() => { vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>); });

describe('TeamGameStats', () => {
  it('stays hidden until an event team is linked', () => {
    const { container } = renderStats(0);
    expect(container).toBeEmptyDOMElement();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the figures as a plain list and each game to a visitor who is not signed in, with no sign-in prompt', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: profile });
    renderStats(2);
    expect(screen.getByRole('status')).toHaveTextContent('Loading race statistics…');
    const facts = await screen.findByRole('list', { name: 'By game' });
    expect(api.get).toHaveBeenCalledWith('/stats/team-profiles/p1', expect.anything());
    const figures = screen.getByLabelText('Race statistics');
    expect(within(figures).getByText('Average place').nextSibling).toHaveTextContent('7.9');
    expect(within(figures).getByText('Points').nextSibling).toHaveTextContent('49 of 84 (58.3%)');
    expect(within(figures).getByText('Races won').nextSibling).toHaveTextContent('2 of 12');
    const rows = within(facts).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Two Flag12 races · 2 wins · average 4.1 pts · average place 5.858.3%');
    expect(rows[1]).toHaveTextContent('Mug Shuffle12 races · 1 win · average 3.6 pts · average place 6.951.2%');
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign in to see/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Summary' })).not.toBeInTheDocument();
  });

  it('leaves the by-game list out when the API sent no games', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...profile, games: null, bestGames: null, worstGames: null } });
    renderStats(1);
    expect(await screen.findByLabelText('Race statistics')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'By game' })).not.toBeInTheDocument();
    expect(screen.queryByText('By game')).not.toBeInTheDocument();
  });

  it('reports a failure and hides a missing profile', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const { unmount } = renderStats(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load these statistics');
    unmount();
    vi.mocked(api.get).mockRejectedValueOnce(Object.assign(new Error('gone'), { response: { status: 404 } }));
    const { container } = renderStats(1);
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
