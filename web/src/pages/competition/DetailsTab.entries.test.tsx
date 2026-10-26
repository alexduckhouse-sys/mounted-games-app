import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
  return render(
    <MemoryRouter initialEntries={['/competitions/1/details']}>
      <Routes>
        <Route path="/competitions/:id/details" element={<DetailsTab />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DetailsTab matchmaker', () => {
  beforeEach(() => {
    state.roles = ['Member'];
    state.organise = false;
    vi.mocked(api.get).mockResolvedValue({ data: [] });
  });

  it('offers pair requests only from the signed-in rider’s own seeking entry', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.endsWith('/matchmaking') ? [
      { signupId: 20, competitionSectionId: 5, fullName: 'Synthetic Partner', lookingForPair: true },
    ] : url === '/me/signups' ? [{ id: 10, competitionSectionId: 5, lookingForPair: true, status: 0 }] : [] }));
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    mount([section({ format: 1 })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Request pair-up with Synthetic Partner' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/my/signups/10/pair-request', { targetSignupId: 20 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Pair-up request sent.');
  });

  it('lists a team with a guest rider spot, and a rider waiting for one', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.endsWith('/matchmaking') ? [
      { signupId: 21, competitionSectionId: 5, fullName: 'Cat', teamName: 'Clover A', lookingForPair: false, lookingForGuestRiders: true, waitingForGuestSpot: false },
      { signupId: 22, competitionSectionId: 5, fullName: 'Dan', lookingForPair: false, lookingForGuestRiders: false, waitingForGuestSpot: true },
    ] : [] }));
    mount([section()]);
    expect(await screen.findByText('Guest rider spot available')).toBeInTheDocument();
    expect(screen.getByText('Guest rider spot wanted')).toBeInTheDocument();
  });

  it('says so when a pair-up request cannot be sent', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.endsWith('/matchmaking') ? [
      { signupId: 20, competitionSectionId: 5, fullName: 'Synthetic Partner', lookingForPair: true },
    ] : url === '/me/signups' ? [{ id: 10, competitionSectionId: 5, lookingForPair: true, status: 0 }] : [] }));
    vi.mocked(api.post).mockRejectedValue(new Error('no'));
    mount([section({ format: 1 })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Request pair-up with Synthetic Partner' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not send the pair-up request');
  });
});
