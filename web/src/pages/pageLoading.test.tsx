import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, team } from '../test/factories';
import type { ShopPost } from '../types';
import { CompetitionContext } from './competition/context';
import { TeamsTab } from './competition/TeamsTab';
import { ShopPage } from './ShopPage';
import { chooseOption, selectedValue } from '../test/select';

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

beforeEach(() => {
  hoisted.current = null;
  hoisted.user = null;
  hoisted.roles = [];
  serve(() => []);
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
    await waitFor(() => expect(selectedValue(screen.getByLabelText(/Club/))).toBe('3'));
    expect(selectedValue(screen.getByLabelText(/Section/))).toBe('5');
  });

  it('keeps a different club and section once picked', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await waitFor(() => expect(selectedValue(screen.getByLabelText(/Club/))).toBe('3'));
    chooseOption(screen.getByLabelText(/Club/), '4');
    chooseOption(screen.getByLabelText(/Section/), '6');
    expect(selectedValue(screen.getByLabelText(/Club/))).toBe('4');
    expect(selectedValue(screen.getByLabelText(/Section/))).toBe('6');
  });

  it('creates the team with the defaults and resets the form', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await waitFor(() => expect(selectedValue(screen.getByLabelText(/Club/))).toBe('3'));
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/teams', expect.objectContaining({ competitionSectionId: 5, clubId: 3, suffix: 'A' })));
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await waitFor(() => expect(selectedValue(screen.getByLabelText(/Club/))).toBe('3'));
  });
});
