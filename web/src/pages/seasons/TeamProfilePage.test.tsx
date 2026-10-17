import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
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
    await user.click(await screen.findByRole('button', { name: 'Link event' }));
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

    expect(await screen.findByText('League')).toBeInTheDocument();
    expect(screen.queryByText('Profile details')).not.toBeInTheDocument();
    expect(screen.queryByText('Link an event team')).not.toBeInTheDocument();
  });

  it('locks club and suffix after the profile has been linked', async () => {
    currentHistory = { ...history, eventTeams: [{ id: 1, teamProfileId: profile.id, competitionId: 12, competitionName: 'Spring', teamId: 41, teamName: 'North Club A', linkedAt: '2031-05-04' }] };
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit profile' }));
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
