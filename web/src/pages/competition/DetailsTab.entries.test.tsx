import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import type { CompetitionSection, Role } from '../../types';
import { DetailsTab } from './DetailsTab';

const state = vi.hoisted(() => ({ roles: ['Member'] as string[], organise: false }));
const section = (extra: Partial<CompetitionSection> = {}): CompetitionSection => ({
  id: 5, competitionId: 1, format: 2, ageGroup: 'U12', displayName: 'Teams U12', priceMinor: 1000, ...extra,
});
const data = vi.hoisted(() => ({ sections: [] as unknown[] }));

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  useCompetition: () => ({ competition: { ...competition(), sections: data.sections }, reload: vi.fn() }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', roles: state.roles },
    canEdit: () => false,
    canManage: () => false,
    canOrganise: () => state.organise,
    hasRole: (role: Role) => state.roles.includes(role),
  }),
}));
vi.mock('./CompetitionTeamCard', () => ({ CompetitionTeamCard: () => null }));

function mount(sections: CompetitionSection[]) {
  data.sections = sections;
  return render(<MemoryRouter><DetailsTab /></MemoryRouter>);
}

describe('DetailsTab entries (seats and whole-team entry)', () => {
  beforeEach(() => {
    state.roles = ['Member'];
    state.organise = false;
    vi.mocked(api.get).mockResolvedValue({ data: [] });
  });

  it('shows riders and visitors the real seats left, using the count the API sends', () => {
    mount([section({ maxParticipants: 4, activeSignupsCount: 3 })]);
    expect(screen.getByText(/1 of 4 places left/)).toBeInTheDocument();
  });

  it('says the section is full once paid and pending entries fill it', () => {
    mount([section({ maxParticipants: 4, activeSignupsCount: 4 })]);
    expect(screen.getAllByText(/^Full/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Join/ })).not.toBeInTheDocument();
  });

  it('counts pending as well as paid entries for organisers', async () => {
    state.organise = true;
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url.endsWith('/signups') ? [
        { id: 1, competitionSectionId: 5, fullName: 'A', status: 1 },
        { id: 2, competitionSectionId: 5, fullName: 'B', status: 0 },
        { id: 3, competitionSectionId: 5, fullName: 'C', status: 3 },
      ] : [],
    }));
    mount([section({ maxParticipants: 4, activeSignupsCount: 0 })]);
    expect(await screen.findByText(/2 of 4 places left/)).toBeInTheDocument();
  });

  it('offers a whole-team entry to a team manager in a team section only', async () => {
    state.roles = ['Manager'];
    mount([section()]);
    await userEvent.click(screen.getByRole('button', { name: /Join/ }));
    expect(screen.getByRole('checkbox', { name: 'Enter a whole team' })).toBeInTheDocument();
  });

  it('sends the whole-team entry with its team name', async () => {
    state.roles = ['Trainer'];
    vi.mocked(api.post).mockResolvedValue({ data: { id: 9, status: 0, amountMinor: 1000 } });
    mount([section()]);
    await userEvent.click(screen.getByRole('button', { name: /Join/ }));
    await userEvent.type(screen.getByPlaceholderText('Your full name'), 'Pat Manager');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enter a whole team' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('e.g. Welsh Dragons'), 'Welsh Dragons');
    await userEvent.click(screen.getByRole('checkbox', { name: /parental consent/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({
      fullName: 'Pat Manager', teamName: 'Welsh Dragons', wholeTeam: true,
    })));
  });

  it('does not offer a whole-team entry to a rider, or in a pairs section', async () => {
    mount([section()]);
    await userEvent.click(screen.getByRole('button', { name: /Join/ }));
    expect(screen.queryByRole('checkbox', { name: 'Enter a whole team' })).not.toBeInTheDocument();
  });

  it('does not offer a whole-team entry in a pairs section', async () => {
    state.roles = ['Manager'];
    mount([section({ format: 1 })]);
    await userEvent.click(screen.getByRole('button', { name: /Join/ }));
    expect(screen.queryByRole('checkbox', { name: 'Enter a whole team' })).not.toBeInTheDocument();
  });
});
