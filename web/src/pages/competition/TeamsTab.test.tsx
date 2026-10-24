import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, team } from '../../test/factories';
import { TeamsTab } from './TeamsTab';
import { chooseOption, optionLabels } from '../../test/select';

const state = vi.hoisted(() => ({ edit: true }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./context', () => ({
  useCompetition: () => ({
    competition: competition({ teams: [team(1, { displayName: 'Oak A', clubId: 7, trainerUserId: null })] }),
    reload: vi.fn(),
  }),
}));
vi.mock('../../hooks/useFavourites', () => ({ useFavourites: () => ({ favourites: [], error: null, toggle: vi.fn() }) }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', clubId: 7, roles: ['Admin'] },
    hasRole: (role: string) => role === 'Admin',
    canEdit: () => state.edit,
    canOrganise: () => false,
  }),
}));

describe('TeamsTab trainers', () => {
  beforeEach(() => {
    state.edit = true;
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url === '/clubs/7/trainers' ? [{ userId: 'tr-1', fullName: 'Pat Trainer' }] : [],
    }));
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('lets an organiser put a club trainer in charge of a team', async () => {
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    await waitFor(() => expect(optionLabels(screen.getByLabelText('Trainer for Oak A'))).toContain('Pat Trainer'), { timeout: 5000 });
    chooseOption(screen.getByLabelText('Trainer for Oak A'), 'tr-1');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/1', { trainerUserId: 'tr-1' }));
  });

  it('only names the trainer when the viewer cannot organise', () => {
    state.edit = false;
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    expect(screen.queryByLabelText('Trainer for Oak A')).not.toBeInTheDocument();
    expect(screen.getByText('No trainer assigned')).toBeInTheDocument();
  });

  it('says so when the change cannot be saved', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    await waitFor(() => expect(optionLabels(screen.getByLabelText('Trainer for Oak A'))).toContain('Pat Trainer'), { timeout: 5000 });
    chooseOption(screen.getByLabelText('Trainer for Oak A'), 'tr-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not change the trainer.');
  });

  it('flags a team whose dec form broke an organiser’s limit', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url === '/declaration-forms' ? [{ id: 1, teamId: 1, flagCount: 2 }] : [],
    }));
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    expect(await screen.findByText('2 flagged')).toBeInTheDocument();
  });
  it('allows creating a custom team with free-text club and team name without a required suffix', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await userEvent.type(screen.getByPlaceholderText('e.g. Stockport PC'), 'New Valley PC');
    await userEvent.type(screen.getByPlaceholderText('e.g. Welsh Dragons (optional)'), 'Valley Flyers');
    await userEvent.click(screen.getByRole('button', { name: /Create team/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/teams', expect.objectContaining({
      clubName: 'New Valley PC',
      name: 'Valley Flyers',
      suffix: '',
    })));
  });
});
