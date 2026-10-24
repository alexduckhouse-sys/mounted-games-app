import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import type { CompetitionSection, Role } from '../../types';
import { DetailsTab, SectionEntryPage } from './DetailsTab';

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
        <Route path="/competitions/:id/enter/:sectionId" element={<SectionEntryPage />} />
      </Routes>
    </MemoryRouter>,
  );
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
    await userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
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

  it('offers Looking for a Pair (50% price) in a pairs section and hides team fields in an individual section', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 12, status: 0, amountMinor: 500 } });
    const { unmount } = mount([section({ format: 1, displayName: 'Pairs U14', priceMinor: 1000 })]);
    await userEvent.click(screen.getByRole('button', { name: /Join/ }));
    const pairBox = screen.getByRole('checkbox', { name: /Looking for a Pair/i });
    await userEvent.click(pairBox);
    await userEvent.type(screen.getByPlaceholderText('Your full name'), 'Solo Pair Rider');
    await userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({
      fullName: 'Solo Pair Rider', lookingForPair: true,
    })));
    unmount();

    mount([section({ format: 3, displayName: 'Individuals Open', priceMinor: 1000 })]);
    await userEvent.click(screen.getByRole('button', { name: /Join/ }));
    expect(screen.queryByPlaceholderText(/Team code/)).not.toBeInTheDocument();
  });
  it('lets a rider join the free guest waiting list when the section is full', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 13, status: 1, amountMinor: 0 } });
    mount([section({ maxParticipants: 1, activeSignupsCount: 1 })]);
    await userEvent.click(screen.getByRole('link', { name: 'Wait for a Guest Ride Spot (Free)' }));
    expect(screen.getByRole('checkbox', { name: 'Wait for a Guest Ride Spot (Free)' })).toBeChecked();
    expect(screen.queryByLabelText('Team code')).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Your full name'), 'Synthetic Guest');
    await userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({ waitingForGuestSpot: true, wholeTeam: false, teamCode: null })));
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

});

describe('w7 entry options', () => {
  beforeEach(() => {
    state.roles = ['Member']; state.organise = false;
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 90, status: 0, amountMinor: 0 } });
  });
  it('lets a rider join a full section waiting list without charging or booking stables', async () => {
    mount([section({ maxParticipants: 1, activeSignupsCount: 1 })]);
    await userEvent.click(screen.getByRole('link', { name: 'Join waiting list (Free)' }));
    await userEvent.type(screen.getByPlaceholderText('Your full name'), 'Synthetic Entrant');
    await userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({ isWaitlist: true, stablesCount: 0, paymentMethod: null })));
    expect(await screen.findByText(/You are on the waiting list/)).toBeInTheDocument();
  });
  it('submits a multi-team BACS entry with stabling and the multiplied price', async () => {
    state.roles = ['Manager'];
    mount([section()]);
    await userEvent.click(screen.getByRole('button', { name: /Join/ }));
    await userEvent.type(screen.getByPlaceholderText('Your full name'), 'Synthetic Manager');
    await userEvent.type(screen.getByPlaceholderText('Pony Club (optional)'), 'Synthetic Club');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enter a whole team' }));
    await userEvent.clear(screen.getByLabelText('Number of teams'));
    await userEvent.type(screen.getByLabelText('Number of teams'), '2');
    await userEvent.clear(screen.getByLabelText('Number of stables'));
    await userEvent.type(screen.getByLabelText('Number of stables'), '3');
    expect(screen.getByText('£20.00')).toBeInTheDocument();
    expect(screen.queryByText('Pay by Card')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({ wholeTeam: true, teamsCount: 2, stablesCount: 3, paymentMethod: 'bacs' })));
  });
});
