import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import type { StatsProfile } from '../../types';
import TeamProfileStatsPage from './TeamProfileStatsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const summary = {
  competitions: 4, entries: 4, placedEntries: 4, firsts: 1, seconds: 3, thirds: 0, averagePlace: 1.75,
  entriesWithFinals: 3, finalsReached: 3, aFinals: 3, aFinalPercent: 100, races: 50, wins: 22, winPercent: 44,
  points: 195, maxPoints: 264, pointQuotaPercent: 73.9,
};
const run = (competitionName: string, startDate: string, place: number | null, points: number, eliminated = false) => ({ competitionName, startDate, place, eliminated, points, maxPoints: 6 });
const games = [
  { name: 'Bending', races: 4, wins: 2, winPercent: 50, nonFinishes: 0, points: 20, maxPoints: 24, pointQuotaPercent: 86.5, averagePoints: 5, averagePlace: 1.5, runs: [
    run('EGUK National', '2026-08-22T00:00:00', 2, 5), run('EGUK English', '2026-09-19T00:00:00', 1, 6), run('EGUK Winter', '2026-11-07T00:00:00', null, 0, true), run('EGUK Celtic', '2026-12-05T00:00:00', 1, 6),
  ] },
  { name: 'Tack Shop', races: 3, wins: 1, winPercent: 33.3, nonFinishes: 0, points: 10, maxPoints: 18, pointQuotaPercent: 80, averagePoints: 3.3, averagePlace: 2 },
];
const profile: StatsProfile = {
  kind: 2, name: 'Atherstone U14', key: 'p1', detailed: false, raceFiguresAllFormats: true, summary,
  games, bestGames: ['Bending'], worstGames: ['Tack Shop'], entries: null, partnerships: null,
};

function HeaderProbe() {
  const { header } = useCompactPageBarState();
  return <span data-testid="header">{header ? `${header.title}|${header.subtitle ?? ''}|${header.backTo ?? ''}` : 'none'}</span>;
}
const renderPage = () => render(<MemoryRouter initialEntries={['/team-profiles/p1/stats']}><CompactPageBarProvider>
  <Routes><Route path="/team-profiles/:profileId/stats" element={<TeamProfileStatsPage />} /></Routes><HeaderProbe />
</CompactPageBarProvider></MemoryRouter>);

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(api.get).mockResolvedValue({ data: profile });
});

describe('TeamProfileStatsPage', () => {
  it('shows the four headline figures two by two, then each game with its share of the points on offer', async () => {
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading race statistics…');
    const tiles = await screen.findByLabelText('Race statistics');
    expect(api.get).toHaveBeenCalledWith('/stats/team-profiles/p1', expect.anything());
    expect(within(tiles).getByText('Races won (22 of 50)').nextSibling).toHaveTextContent('44%');
    expect(within(tiles).getByText('Points per race').nextSibling).toHaveTextContent('3.9');
    expect(within(tiles).getByText('Average place').nextSibling).toHaveTextContent('1.8');
    expect(within(tiles).getByText('Podiums in 4 competitions').nextSibling).toHaveTextContent('4');
    const list = screen.getByRole('list', { name: 'By game' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Bending86.5%');
    expect(within(rows[0]).getByRole('img', { name: '86.5% of the points available' }).firstElementChild).toHaveStyle({ width: '86.5%' });
    expect(rows[1]).toHaveTextContent('Tack Shop80%');
    expect(screen.getByText('share of points available')).toBeInTheDocument();
  });

  it('puts "Stats" and the team name in the header, with a back link to the team', async () => {
    renderPage();
    await screen.findByLabelText('Race statistics');
    expect(screen.getByTestId('header')).toHaveTextContent('Stats|Atherstone U14|/team-profiles/p1');
  });

  it('opens a game into a bar graph of every run: the place over each bar, the competition and month under it, and the average', async () => {
    renderPage();
    const toggle = await screen.findByRole('button', { name: /Bending/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('img', { name: /Every Bending run/ })).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Every Bending run · best 6, worst 0, won 2 of 4')).toBeInTheDocument();
    const graph = screen.getByRole('img', { name: 'Every Bending run, points scored' });
    const drawn = [...graph.querySelectorAll('text')].map((node) => node.textContent);
    expect(drawn).toEqual(expect.arrayContaining(['2nd', '1st', 'E', 'National', 'English', 'Winter', 'Celtic', 'Aug', 'Sep', 'Nov', 'Dec']));
    expect(graph.querySelectorAll('rect')).toHaveLength(4);
    expect(screen.getByText('Average 5 pts a run')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bending runs' })).toHaveTextContent('EGUK Winter, 2026-11-07: put out, 0 points');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows just the line for a game whose runs the API did not send', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Tack Shop/ }));
    expect(screen.getByText('Tack Shop · won 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Every Tack Shop run/ })).toBeNull();
  });

  it('says so when no races have been scored', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...profile, summary: { ...summary, races: 0, wins: 0, winPercent: null, points: 0 }, games: [] } });
    renderPage();
    expect(await screen.findByText('No races have been scored for this team yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Race statistics')).toBeNull();
  });

  it('leaves the by-game list out when the API sent no games', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...profile, games: null } });
    renderPage();
    expect(await screen.findByLabelText('Race statistics')).toBeInTheDocument();
    expect(screen.queryByText('By game')).toBeNull();
  });

  it('reports a failure, and a team profile that is not there', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const first = renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load these statistics');
    first.unmount();
    vi.mocked(api.get).mockRejectedValueOnce(Object.assign(new Error('gone'), { response: { status: 404 } }));
    renderPage();
    expect(await screen.findByText('Team profile not found')).toBeInTheDocument();
  });
});
