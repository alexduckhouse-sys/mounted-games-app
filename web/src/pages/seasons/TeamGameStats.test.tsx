import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { TeamGameStats } from './TeamGameStats';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const summary = {
  competitions: 1, entries: 1, placedEntries: 1, firsts: 1, seconds: 0, thirds: 0, averagePlace: 1,
  entriesWithFinals: 0, finalsReached: 0, aFinals: 0, aFinalPercent: null, races: 1, wins: 1, winPercent: 100,
  points: 3, maxPoints: 3, pointQuotaPercent: 100,
};
const profile = {
  kind: 2, name: 'North A', key: 'p1', detailed: false, raceFiguresAllFormats: true, summary,
  games: null, bestGames: null, worstGames: null, entries: null, partnerships: null,
};

const renderStats = (linked: number) => render(<MemoryRouter><TeamGameStats profileId="p1" linked={linked} /></MemoryRouter>);

beforeEach(() => { vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>); });

describe('TeamGameStats', () => {
  it('stays hidden until an event team is linked', () => {
    const { container } = renderStats(0);
    expect(container).toBeEmptyDOMElement();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the summary and asks anonymous visitors to sign in for the games', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: profile });
    renderStats(2);
    expect(screen.getByRole('status')).toHaveTextContent('Loading race statistics…');
    expect(await screen.findByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/stats/team-profiles/p1', expect.anything());
  });

  it('shows the games to a signed-in viewer', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'u1' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(api.get).mockResolvedValue({ data: { ...profile, detailed: true, games: [{ name: 'Mug Race', races: 1, wins: 1, winPercent: 100, nonFinishes: 0, points: 3, maxPoints: 3, pointQuotaPercent: 100 }], bestGames: ['Mug Race'], worstGames: [] } });
    renderStats(1);
    expect(await screen.findByRole('table')).toHaveTextContent('Mug Race');
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
