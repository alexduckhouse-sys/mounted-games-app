import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosRequestConfig } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { CurrentCompetition } from '../competition/preference';
import { competition, team } from '../test/factories';
import type { DeclarationForm, ShopPost } from '../types';
import { CompetitionContext } from './competition/context';
import { TeamsTab } from './competition/TeamsTab';
import { DashboardPage } from './DashboardPage';
import { DeclarationsIndexPage } from './DeclarationsIndexPage';
import { FormatPage } from './admin/FormatPage';
import { ShopPage } from './ShopPage';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const hoisted = vi.hoisted(() => ({
  current: null as unknown,
  user: null as unknown,
  roles: [] as string[],
}));
vi.mock('../competition/CurrentCompetitionContext', () => ({
  useCurrentCompetition: () => ({ current: hoisted.current, venue: null, setCurrent: vi.fn() }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: hoisted.user,
    hasRole: (role: string) => hoisted.roles.includes(role),
    canEdit: () => hoisted.roles.includes('Admin'),
    canOrganise: () => true,
  }),
}));

type Reply = (url: string, config?: AxiosRequestConfig) => unknown;
function serve(reply: Reply) {
  vi.mocked(api.get).mockImplementation((url: string, config?: AxiosRequestConfig) => {
    try { return Promise.resolve({ data: reply(url, config) }); } catch (e) { return Promise.reject(e); }
  });
}
const setCurrent = (c: CurrentCompetition | null) => { hoisted.current = c; };

const decForm = (id: number, competitionId: number, competitionName: string): DeclarationForm => ({
  id, teamId: id, teamName: `Team ${id}`, competitionId, competitionName,
  submittedAt: '2026-06-01T09:00:00Z', isLocked: false, riders: [],
});

beforeEach(() => {
  hoisted.current = null;
  hoisted.user = null;
  hoisted.roles = [];
  serve(() => []);
});

describe('DashboardPage', () => {
  it('names the focused competition once it has loaded, and falls back to the active one', async () => {
    setCurrent({ id: 7, name: 'Summer Show' });
    serve((url) => (url === '/competitions' ? [] : { id: 7, name: 'Summer Show', isActive: true }));
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText('Summer Show is live today.')).toBeInTheDocument();
  });

  it('says so when there is no competition to focus on', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText('No live competition right now.')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/competitions\/\d+$/));
  });

  it('forgets the detail when the focused competition cannot be loaded', async () => {
    setCurrent({ id: 9, name: 'Winter Show' });
    serve((url) => { if (url === '/competitions') return [{ id: 1, name: 'Active Show', isActive: true, isArchived: false }]; throw new Error('gone'); });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText('Active Show is live today.')).toBeInTheDocument();
  });
});

describe('DeclarationsIndexPage', () => {
  it('shows a loading state, then the forms for the current competition', async () => {
    setCurrent({ id: 1, name: 'Spring Games' });
    serve((_url, config) => (config?.params?.competitionId === 1 ? [decForm(1, 1, 'Spring Games')] : []));
    render(<MemoryRouter><DeclarationsIndexPage /></MemoryRouter>);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Team 1' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('loads again when switching to the all-forms view', async () => {
    setCurrent({ id: 1, name: 'Spring Games' });
    serve((_url, config) => (config?.params?.competitionId === 1 ? [decForm(1, 1, 'Spring Games')] : [decForm(1, 1, 'Spring Games'), decForm(2, 2, 'Autumn Games')]));
    render(<MemoryRouter><DeclarationsIndexPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Team 1' });
    await userEvent.click(screen.getByRole('button', { name: /All my forms/ }));
    expect(await screen.findByText('Everyone else\'s locked forms (2)')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/declaration-forms', { params: {} });
  });

  it('treats a failed request as an empty list', async () => {
    serve(() => { throw new Error('offline'); });
    render(<MemoryRouter><DeclarationsIndexPage /></MemoryRouter>);
    expect(await screen.findByText('No dec forms yet.')).toBeInTheDocument();
  });
});

describe('ShopPage', () => {
  const post = (id: number): ShopPost => ({
    id, authorName: 'Sam', title: `Saddle ${id}`, body: 'Good condition', createdAt: new Date().toISOString(),
    isDeleted: false, commentCount: 0, reportCount: 0,
  });

  it('shows loading, then the posts', async () => {
    serve(() => [post(1), post(2)]);
    render(<MemoryRouter><ShopPage /></MemoryRouter>);
    expect(screen.getByText('Loading posts…')).toBeInTheDocument();
    expect(await screen.findByText('Saddle 1')).toBeInTheDocument();
    expect(screen.getByText('Saddle 2')).toBeInTheDocument();
    expect(screen.queryByText('Loading posts…')).not.toBeInTheDocument();
  });

  it('stops loading when the request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><ShopPage /></MemoryRouter>);
    expect(await screen.findByText(/Nothing for sale yet/)).toBeInTheDocument();
  });
});

describe('TeamsTab new team form', () => {
  const data = competition({
    sections: [{ id: 5, displayName: 'Seniors' }, { id: 6, displayName: 'Juniors' }] as never,
    teams: [team(1)],
  });
  function mount() {
    return render(
      <MemoryRouter>
        <CompetitionContext.Provider value={{ competition: data, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [] }}>
          <TeamsTab />
        </CompetitionContext.Provider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    hoisted.roles = ['Trainer'];
    hoisted.user = { id: 'u1', fullName: 'Pat Trainer', clubId: 3 };
    serve((url) => (url === '/clubs' ? [{ id: 3, name: 'Oak PC' }, { id: 4, name: 'Elm PC' }] : []));
  });

  it('opens on the first section and the trainer\'s own club', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await waitFor(() => expect(screen.getByLabelText(/Club/)).toHaveValue('3'));
    expect(screen.getByLabelText(/Section/)).toHaveValue('5');
  });

  it('keeps a different club and section once picked', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await waitFor(() => expect(screen.getByLabelText(/Club/)).toHaveValue('3'));
    await userEvent.selectOptions(screen.getByLabelText(/Club/), '4');
    await userEvent.selectOptions(screen.getByLabelText(/Section/), '6');
    expect(screen.getByLabelText(/Club/)).toHaveValue('4');
    expect(screen.getByLabelText(/Section/)).toHaveValue('6');
  });

  it('creates the team with the defaults and resets the form', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await waitFor(() => expect(screen.getByLabelText(/Club/)).toHaveValue('3'));
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/teams', expect.objectContaining({ competitionSectionId: 5, clubId: 3, suffix: 'A' })));
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await waitFor(() => expect(screen.getByLabelText(/Club/)).toHaveValue('3'));
  });
});

describe('FormatPage', () => {
  const detail = { id: 4, name: 'Autumn Games', sections: [], teams: [], sessions: [], signupsLocked: false, createdByUserId: 'u1' };
  function mount() {
    return render(
      <MemoryRouter initialEntries={['/admin/competitions/4/format']}>
        <Routes><Route path="/admin/competitions/:id/format" element={<FormatPage />} /></Routes>
      </MemoryRouter>,
    );
  }

  it('loads the competition and its signups on arrival', async () => {
    serve((url) => (url === '/competitions/4' ? detail : []));
    mount();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Format competition/ })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/competitions/4/signups');
  });

  it('shows the error when the competition cannot be loaded', async () => {
    serve(() => { throw new Error('nope'); });
    mount();
    expect(await screen.findByText('Could not load organiser details. Please try again.')).toBeInTheDocument();
  });

  it('reloads after the lock is toggled', async () => {
    serve((url) => (url === '/competitions/4' ? detail : []));
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    mount();
    await screen.findByRole('heading', { name: /Format competition/ });
    const before = vi.mocked(api.get).mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Close signups now' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/4/signups-locked', { locked: true });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(before));
  });
});
