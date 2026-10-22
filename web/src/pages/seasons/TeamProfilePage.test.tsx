import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { readFavourites } from '../../lib/favourites';
import TeamProfilePage from './TeamProfilePage';
import type { TeamProfileHistory } from './teamProfileTypes';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const profile = { id: 'profile-1', clubId: 3, clubName: 'North Club', suffix: 'A', displayName: 'North Club A', createdAt: '2030-01-01', updatedAt: '2030-01-01', canManage: true };
const history: TeamProfileHistory = { profile, eventTeams: [], publishedResults: [] };
let currentHistory = history;

function renderPage() {
  return render(<MemoryRouter initialEntries={['/team-profiles/profile-1']}><Routes><Route path="/team-profiles/:id" element={<TeamProfilePage />} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  currentHistory = history;
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'owner' }, canOrganise: () => true, hasRole: () => false, canEdit: () => false,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/team-profiles') return { data: [profile] };
    if (url === '/clubs') return { data: [{ id: 3, name: 'North Club' }] };
    if (String(url).endsWith('/history')) return { data: currentHistory };
    if (url === '/competitions') return { data: [{ id: 12, name: 'Spring', startDate: '2031-05-04' }] };
    if (url === '/competitions/12') return { data: { id: 12, name: 'Spring', createdByUserId: 'owner', teams: [{ id: 40, clubId: 9, suffix: 'A', displayName: 'Wrong club A' }, { id: 41, clubId: 3, suffix: 'A', displayName: 'North Club A' }, { id: 42, clubId: 3, suffix: 'B', displayName: 'North Club B' }] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
});

describe('TeamProfilePage', () => {
  it('requires the organiser to choose a matching event team explicitly', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Link event' }));
    const competition = await screen.findByLabelText('Competition');
    await user.selectOptions(competition, '12');
    const team = await screen.findByLabelText('Event team');
    expect(screen.queryByRole('option', { name: 'Wrong club A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'North Club B' })).not.toBeInTheDocument();
    await user.selectOptions(team, '41');
    await user.click(screen.getByRole('button', { name: 'Link event team' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/12/team-profile-links', {
      teamProfileId: 'profile-1', teamId: 41,
    }));
  });

  it('shows published history without owner controls for a public viewer', async () => {
    const publicHistory = { ...history, profile: { ...profile, canManage: false }, publishedResults: [{ seasonId: 'season-1', seasonTitle: 'League', seasonYear: 2031, roundId: 'round-1', roundOrder: 1, competitionName: 'Spring', competitionDate: '2031-05-04', publicationVersion: 2, publishedAt: '2031-05-05', eventRank: 1, eventPoints: 12, seasonPoints: 10 }] };
    vi.mocked(useAuth).mockReturnValue({
      user: null, canOrganise: () => false, hasRole: () => false, canEdit: () => false,
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/team-profiles') return { data: [publicHistory.profile] };
      if (url === '/clubs') return { data: [] };
      if (String(url).endsWith('/history')) return { data: publicHistory };
      throw new Error(`Unexpected GET ${url}`);
    });
    renderPage();

    expect(await screen.findByText('League · 2031')).toBeInTheDocument();
    expect(screen.getByText(/10 pts · 1 round/)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Link an event team')).not.toBeInTheDocument();
    expect(screen.getByText('Public results only. No rider names.')).toBeInTheDocument();
  });

  it('shows the place, the best-N summary, dropped results and rounds not entered, using the season table', async () => {
    const result = (roundId: string, order: number, name: string, date: string, rank: number, points: number) => ({ seasonId: 'season-1', seasonTitle: 'League', seasonYear: 2031, roundId, roundOrder: order, competitionName: name, competitionDate: date, publicationVersion: 1, publishedAt: date, eventRank: rank, eventPoints: 0, seasonPoints: points });
    const round = (id: string, order: number, name: string, date: string, published: number | null) => ({ id, competitionId: order, competitionName: name, competitionDate: date, competitionSectionId: order, sectionName: 'U14', orderIndex: order, isIncluded: true, publishedVersion: published, publishedAt: null, publicationIsCurrent: true });
    const linked = { ...history, profile: { ...profile, canManage: false }, publishedResults: [result('r1', 1, 'Club Day', '2031-04-26T00:00:00Z', 1, 10), result('r3', 3, 'May Cup', '2031-05-31T00:00:00Z', 4, 5)] };
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/team-profiles') return { data: [linked.profile] };
      if (url === '/clubs') return { data: [] };
      if (String(url).endsWith('/history')) return { data: linked };
      if (url === '/seasons/season-1') return { data: { id: 'season-1', title: 'League', year: 2031, format: 2, ageGroup: 'U14', bestResultsToCount: 1, placePoints: [], canManage: false, rounds: [round('r1', 1, 'Club Day', '2031-04-26T00:00:00Z', 1), round('r2', 2, 'Spring Qualifier', '2031-05-10T00:00:00Z', 1), round('r3', 3, 'May Cup', '2031-05-31T00:00:00Z', 1), round('r4', 4, 'Autumn Classic', '2031-09-12T00:00:00Z', null)] } };
      if (url === '/seasons/season-1/standings') return { data: { standings: [
        { rank: 3, teamProfileId: 'profile-1', teamName: 'North Club A', clubName: 'North Club', totalPoints: 10, rounds: [{ roundId: 'r1', eventRank: 1, seasonPoints: 10, counted: true }, { roundId: 'r3', eventRank: 4, seasonPoints: 5, counted: false }] },
        { rank: 3, teamProfileId: 'other', teamName: 'South Club B', clubName: 'South Club', totalPoints: 10, rounds: [] },
      ] } };
      throw new Error(`Unexpected GET ${url}`);
    });
    renderPage();

    expect(await screen.findByText('U14 Teams · 2031')).toBeInTheDocument();
    expect(screen.getByText(/best 1 of 2 rounds/)).toHaveTextContent('=3rd · 10 pts · best 1 of 2 rounds');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('R3 · May Cup31 May · dropped4th5');
    expect(rows[0].querySelector('s')).toHaveTextContent('5');
    expect(rows[1]).toHaveTextContent('R2 · Spring Qualifier10 May · did not enter——');
    expect(rows[2]).toHaveTextContent('R1 · Club Day26 Apr1st10');
    expect(screen.getByRole('link', { name: 'Back to standings' })).toHaveAttribute('href', '/seasons/season-1');
  });

  it('follows the linked event teams on this device from the star in the header', async () => {
    currentHistory = { ...history, eventTeams: [{ id: 1, teamProfileId: profile.id, competitionId: 12, competitionName: 'Spring', teamId: 41, teamName: 'North Club A', linkedAt: '2031-05-04' }] };
    const user = userEvent.setup();
    renderPage();

    const star = await screen.findByRole('button', { name: 'Star North Club A' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    expect(readFavourites()).toEqual([{ competitionId: 12, teamId: 41 }]);
    expect(screen.getByRole('button', { name: 'Unstar North Club A' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Unstar North Club A' }));
    expect(readFavourites()).toEqual([]);
  });

  it('has no star when no event team is linked yet', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'North Club A' });
    expect(screen.queryByRole('button', { name: /Star/ })).not.toBeInTheDocument();
  });

  it('locks club and suffix after the profile has been linked', async () => {
    currentHistory = { ...history, eventTeams: [{ id: 1, teamProfileId: profile.id, competitionId: 12, competitionName: 'Spring', teamId: 41, teamName: 'North Club A', linkedAt: '2031-05-04' }] };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Edit profile' }));
    expect(screen.getByLabelText('Club')).toBeDisabled();
    expect(screen.getByLabelText('Suffix')).toBeDisabled();
    expect(screen.getByLabelText('Display name')).toBeEnabled();
  });

  it('retries a failed list load without showing a false empty state', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/team-profiles']}><Routes><Route path="/team-profiles" element={<TeamProfilePage />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load team profiles.');
    expect(screen.queryByText('No team profiles yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('North Club A')).toBeInTheDocument();
  });

  it('does not allow the create form to be cancelled while submission is in flight', async () => {
    let resolveCreate!: (value: { data: typeof profile }) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/team-profiles']}><Routes><Route path="/team-profiles" element={<TeamProfilePage />} /><Route path="/team-profiles/:profileId" element={<TeamProfilePage />} /></Routes></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'New profile' }));
    await user.selectOptions(screen.getByLabelText('Club'), '3');
    await user.type(screen.getByLabelText('Suffix'), 'A');
    await user.type(screen.getByLabelText('Display name'), 'North Club A');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => resolveCreate({ data: profile }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });
});
