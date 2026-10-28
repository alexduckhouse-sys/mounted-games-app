import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import type { CompetitionDetail, CompetitionSection, Role } from '../../types';
import { EntryPage } from './EntryPage';

const state = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null, roles: ['Member'] as string[], organise: false, detail: null as unknown, reload: vi.fn() }));

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  useCompetition: () => ({ competition: state.detail, reload: state.reload }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: state.user,
    canEdit: () => false,
    canManage: () => false,
    canOrganise: () => state.organise,
    hasRole: (role: Role) => state.roles.includes(role),
  }),
}));

const section = (extra: Partial<CompetitionSection> = {}): CompetitionSection => ({
  id: 5, competitionId: 1, format: 2, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 1000, ...extra,
});

function Where() {
  const { pathname, search, state: navState } = useLocation();
  return <p data-testid="where">{pathname}{search}{(navState as { from?: string } | null)?.from ? ` from ${(navState as { from: string }).from}` : ''}</p>;
}

function mount(path: string, sections: CompetitionSection[] = [section()], extra: Partial<CompetitionDetail> = {}) {
  state.detail = competition({ id: 1, name: 'Spring Games', paymentDestination: 'Club 12-34-56', sections, ...extra });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/competitions/:id/enter/*" element={<EntryPage />} />
        <Route path="/login" element={<Where />} />
        <Route path="/competitions/:id/details" element={<p>Details page</p>} />
        <Route path="/me/signups/:signupId/test-payment" element={<p>Test payment page</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

async function fill(name = 'Alice Rider') {
  await userEvent.type(screen.getByLabelText('Your name'), name);
  await userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
}

const next = () => screen.getByRole('button', { name: /^Next/ });
const stepLabels = () => within(screen.getByRole('list', { name: 'Entry steps' })).getAllByRole('listitem').map((li) => li.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'u1' };
  state.roles = ['Member'];
  state.organise = false;
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 9, status: 0, amountMinor: 1000 } });
});

describe('step 1: what you are entering', () => {
  it('lists each age group with its entry types and fees, and a three-step stepper', () => {
    mount('/competitions/1/enter', [section(), section({ id: 6, displayName: 'Under 16', format: 3, priceMinor: 2550 })]);
    expect(screen.getByRole('heading', { name: 'What are you entering?' })).toBeInTheDocument();
    expect(stepLabels()).toEqual(['1Section', '2Your details', '3Pay']);
    const teams = screen.getByRole('region', { name: 'Under 12' });
    expect(within(teams).getByRole('link', { name: /^Team£10/ })).toHaveAttribute('href', '/competitions/1/enter/5');
    expect(within(teams).getByRole('link', { name: /^Guest riderLooking for a teamFree/ })).toHaveAttribute('href', '/competitions/1/enter/5?type=guest');
    const individuals = screen.getByRole('region', { name: 'Under 16' });
    expect(within(individuals).getByRole('link', { name: /^Individual£25\.50/ })).toBeInTheDocument();
  });

  it('offers a solo pair partner at half the pair fee', () => {
    mount('/competitions/1/enter', [section({ format: 1, displayName: 'Pairs U14', priceMinor: 1000 })]);
    expect(screen.getByRole('link', { name: /^Pair£10/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Solo riderLooking for a pair partner£5/ })).toHaveAttribute('href', '/competitions/1/enter/5?type=partner');
  });

  it('offers only the waiting list and guest riders once a team age group is full', () => {
    mount('/competitions/1/enter', [section({ maxParticipants: 1, activeSignupsCount: 1 })]);
    expect(screen.getByRole('link', { name: /Join the waiting list/ })).toHaveAttribute('href', '/competitions/1/enter/5?type=waitlist');
    expect(screen.getByRole('link', { name: /^Guest rider/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Team/ })).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign in, then back to the choice they made', () => {
    state.user = null;
    mount('/competitions/1/enter');
    expect(screen.getByRole('link', { name: /^Team/ })).toHaveAttribute('href', '/login');
  });

  it('says entries are closed instead of offering them', () => {
    mount('/competitions/1/enter', [section()], { signupsLocked: true });
    expect(screen.getByRole('status')).toHaveTextContent('Entries are closed for this competition.');
    expect(screen.queryByRole('link', { name: /^Team/ })).not.toBeInTheDocument();
  });

  it('shows Section not found for an age group that does not exist', () => {
    mount('/competitions/1/enter/999');
    expect(screen.getByRole('alert')).toHaveTextContent('Section not found.');
  });

  it('asks a signed-out visitor to sign in on a deep link to a form', () => {
    state.user = null;
    mount('/competitions/1/enter/5');
    expect(screen.getByRole('link', { name: 'Sign in to enter' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });
});

describe('steps 2 and 3: details, then pay', () => {
  it('goes from the choice to the details, then pay, then submits', async () => {
    mount('/competitions/1/enter');
    await userEvent.click(screen.getByRole('link', { name: /^Team/ }));
    expect(screen.getByRole('heading', { name: 'Under 12 · team' })).toBeInTheDocument();
    expect(screen.getByText('£10', { selector: '.ev-price' })).toBeInTheDocument();
    expect(next()).toBeDisabled();
    await fill();
    expect(next()).toHaveTextContent('Next: pay £10');
    await userEvent.click(next());

    expect(screen.getByRole('heading', { name: 'Pay £10 by bank transfer' })).toBeInTheDocument();
    expect(screen.getByText('Club 12-34-56')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Entry steps' })).toBeInTheDocument();
    expect(screen.getAllByText('Alice Rider').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('heading', { name: 'Entry submitted' })).toBeInTheDocument();
    expect(screen.getByText(/Under 12 team at Spring Games\./)).toBeInTheDocument();
    expect(screen.getByText(/The organiser marks it paid once your transfer arrives/)).toBeInTheDocument();
    const bank = screen.getByRole('region', { name: 'Bank transfer details' });
    expect(bank).toHaveTextContent('Club 12-34-56');
    expect(bank).toHaveTextContent('Alice Rider');
    expect(bank).toHaveTextContent('£10');
    expect(within(bank).getByRole('button', { name: 'Copy bank details' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({
      fullName: 'Alice Rider', teamCode: null, paymentMethod: 'bacs', acceptTerms: true, waitingForGuestSpot: false, isWaitlist: false,
    }));
    expect(screen.getByRole('link', { name: 'Back to details' })).toBeInTheDocument();
  });

  it('keeps what you typed when you go back with Edit', async () => {
    mount('/competitions/1/enter/5');
    await fill('Ann Rider');
    await userEvent.click(next());
    await userEvent.click(screen.getByRole('link', { name: 'Edit' }));
    expect(screen.getByLabelText('Your name')).toHaveValue('Ann Rider');
    expect(screen.getByTestId('where')).toHaveTextContent('/competitions/1/enter/5');
  });

  it('sends a direct visit to the pay step back to the details', () => {
    mount('/competitions/1/enter/5/pay');
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('gives guest riders two steps, Free, and a Submit on the details', async () => {
    mount('/competitions/1/enter/5?type=guest');
    expect(stepLabels()).toEqual(['Section', '2Your details']);
    expect(screen.getByRole('heading', { name: 'Under 12 · guest rider' })).toBeInTheDocument();
    expect(screen.getByText('Free', { selector: '.ev-price' })).toBeInTheDocument();
    expect(screen.queryByText('Stables')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Team name/)).not.toBeInTheDocument();
    await fill('Synthetic Guest');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({
      waitingForGuestSpot: true, wholeTeam: false, teamName: null, stablesCount: 0, paymentMethod: null,
    })));
    expect(await screen.findByRole('heading', { name: 'Entry submitted' })).toBeInTheDocument();
    expect(screen.getByText(/Teams looking for a guest rider can invite you/)).toBeInTheDocument();
  });

  it('puts a full age group on the waiting list without charging or booking stables', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 90, status: 0, amountMinor: 0 } });
    mount('/competitions/1/enter', [section({ maxParticipants: 1, activeSignupsCount: 1 })]);
    await userEvent.click(screen.getByRole('link', { name: /Join the waiting list/ }));
    expect(stepLabels()).toHaveLength(2);
    await fill('Synthetic Entrant');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({ isWaitlist: true, stablesCount: 0, paymentMethod: null })));
    expect(await screen.findByText(/You are on the waiting list/)).toBeInTheDocument();
    expect(screen.queryByText("You're entered")).not.toBeInTheDocument();
  });

  it('still reads ?waitlist=1 from an older link', () => {
    mount('/competitions/1/enter/5?waitlist=1');
    expect(screen.getByRole('heading', { name: 'Under 12 · waiting list' })).toBeInTheDocument();
  });

  it('does not take an entry for a full age group from a direct link', () => {
    mount('/competitions/1/enter/5', [section({ maxParticipants: 1, activeSignupsCount: 1 })]);
    expect(screen.getByRole('status')).toHaveTextContent('Under 12 is full. You can join the waiting list.');
    expect(screen.getByRole('link', { name: 'Join the waiting list' })).toHaveAttribute('href', '/competitions/1/enter/5?type=waitlist');
  });

  it('skips the pay step for a free age group', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    expect(stepLabels()).toHaveLength(2);
    await fill();
    expect(screen.queryByRole('button', { name: /^Next/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({ paymentMethod: null })));
  });

  it('sends a solo pair partner at half the fee and flags them as looking for a partner', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 12, status: 0, amountMinor: 500 } });
    mount('/competitions/1/enter/5?type=partner', [section({ format: 1, displayName: 'Pairs U14', priceMinor: 1000 })]);
    expect(screen.getByText('£5', { selector: '.ev-price' })).toBeInTheDocument();
    await fill('Solo Pair Rider');
    await userEvent.click(next());
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({ fullName: 'Solo Pair Rider', lookingForPair: true })));
  });

  it('hides the team fields in an individual age group', () => {
    mount('/competitions/1/enter/5', [section({ format: 3, displayName: 'Individuals Open' })]);
    expect(screen.queryByLabelText(/Team name/)).not.toBeInTheDocument();
    expect(screen.queryByText('Stables')).not.toBeInTheDocument();
  });
});

describe('whole teams and stables', () => {
  it('offers a whole-team entry to a team manager in a team age group only', () => {
    state.roles = ['Manager'];
    const view = mount('/competitions/1/enter/5');
    expect(screen.getByRole('checkbox', { name: 'Enter a whole team' })).toBeInTheDocument();
    view.unmount();
    mount('/competitions/1/enter/5', [section({ format: 1 })]);
    expect(screen.queryByRole('checkbox', { name: 'Enter a whole team' })).not.toBeInTheDocument();
  });

  it('does not offer a whole-team entry to a rider', () => {
    mount('/competitions/1/enter/5');
    expect(screen.queryByRole('checkbox', { name: 'Enter a whole team' })).not.toBeInTheDocument();
  });

  it('needs a team name for a whole team, and sends it', async () => {
    state.roles = ['Trainer'];
    mount('/competitions/1/enter/5');
    await fill('Pat Manager');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enter a whole team' }));
    expect(next()).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Team name'), 'Welsh Dragons');
    await userEvent.click(next());
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({
      fullName: 'Pat Manager', teamName: 'Welsh Dragons', wholeTeam: true,
    })));
  });

  it('multiplies the fee by the number of teams and sends the stables', async () => {
    state.roles = ['Manager'];
    mount('/competitions/1/enter/5');
    await userEvent.type(screen.getByLabelText('Your name'), 'Synthetic Manager');
    await userEvent.type(screen.getByLabelText('Club (optional)'), 'Synthetic Club');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enter a whole team' }));
    await userEvent.clear(screen.getByLabelText('Number of teams'));
    await userEvent.type(screen.getByLabelText('Number of teams'), '2');
    for (let i = 0; i < 3; i += 1) await userEvent.click(screen.getByRole('button', { name: 'One more stable' }));
    expect(screen.getByText('£20', { selector: '.ev-price' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));
    await userEvent.click(next());
    expect(screen.getByText('Stables')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({
      wholeTeam: true, teamsCount: 2, stablesCount: 3, paymentMethod: 'bacs', teamName: 'Synthetic Club',
    })));
  });

  it('keeps the stables stepper from going below none', async () => {
    mount('/competitions/1/enter/5');
    expect(screen.getByRole('button', { name: 'One fewer stable' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'One more stable' }));
    expect(screen.getByLabelText(/Stabling club or team/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'One fewer stable' }));
    expect(screen.queryByLabelText(/Stabling club or team/)).not.toBeInTheDocument();
  });
});

describe('demo events', () => {
  it('takes a paid entry on a demo event straight to the test payment page', async () => {
    mount('/competitions/1/enter/5', [section({ format: 0 as never, priceMinor: 1500 })], { isDemo: true });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 77, status: 0, amountMinor: 1500 } });
    await fill('Ann Rider');
    await userEvent.click(next());
    expect(screen.getByText(/This is a demo event/)).toBeInTheDocument();
    expect(screen.queryByText('Copy bank details')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Test payment page')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({ fullName: 'Ann Rider', paymentMethod: 'card' }));
  });

  it('does not send a free demo entry to the test page', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })], { isDemo: true });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 79, status: 1, amountMinor: 0 } });
    await fill('Ann Rider');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Your entry is confirmed/)).toBeInTheDocument();
    expect(screen.queryByText('Test payment page')).not.toBeInTheDocument();
  });
});

describe('the entry form', () => {
  it('leaves the email out when it is blank, and sends a request id', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body).toMatchObject({ fullName: 'Alice Rider', contactEmail: null, emailOptIn: false, emailOptInVersion: null });
    expect(typeof body.requestId).toBe('string');
  });

  it('sends the address, and the opt-in only when the box is ticked', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 9, status: 1, amountMinor: 0, confirmationEmailStatus: 1 } });
    await fill();
    await userEvent.type(screen.getByLabelText(/Your email/), 'parent@example.org');
    expect((screen.getByLabelText(/Email me when new competitions open/) as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByLabelText(/Email me when new competitions open/));
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ contactEmail: 'parent@example.org', emailOptIn: true, emailOptInVersion: 'alerts-2026-10-22' });
    expect(await screen.findByText(/We’ve emailed you a copy/)).toBeInTheDocument();
  });

  it('reuses the request id when the same attempt is retried after a failure', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { id: 9, status: 1, amountMinor: 0 } });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t submit your entry. Check your signal and try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const ids = vi.mocked(api.post).mock.calls.map((c) => (c[1] as { requestId: string }).requestId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('sends the entry again from Try again in the problem strip', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { id: 9, status: 1, amountMinor: 0 } });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Entry submitted')).toBeInTheDocument();
  });

  it('shows the server’s own message when it refuses an entry', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { message: 'Section is full.' } } });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Section is full.');
  });

  it('reloads the event after an admission conflict so the counts are not stale', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0, maxParticipants: 5, activeSignupsCount: 3 })]);
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 409, data: { message: 'Section is full.' } } });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Section is full.');
    expect(state.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for other failures', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('alert');
    expect(state.reload).not.toHaveBeenCalled();
  });

  describe('places left on step 1', () => {
    it('says how many are left, singular and plural, and nothing when full, uncapped or closed', () => {
      mount('/competitions/1/enter', [
        section({ maxParticipants: 10, activeSignupsCount: 4 }),
        section({ id: 6, displayName: 'Under 16', format: 1, maxParticipants: 4, activeSignupsCount: 3 }),
        section({ id: 7, displayName: 'Under 8', maxParticipants: 4, activeSignupsCount: 4 }),
        section({ id: 8, displayName: 'Open' }),
      ]);
      expect(within(screen.getByRole('region', { name: 'Under 12' })).getByText('6 team places left')).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Under 16' })).getByText('1 pair place left')).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Under 8' })).queryByText(/left/)).toBeNull();
      expect(within(screen.getByRole('region', { name: 'Open' })).queryByText(/left/)).toBeNull();
    });
  });

  it('does not send a malformed address', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    await fill();
    await userEvent.type(screen.getByLabelText(/Your email/), 'parent@');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(api.post).not.toHaveBeenCalled();
    expect((await screen.findAllByRole('alert'))[0].textContent).toMatch(/doesn’t look right/);
  });

  it('says plainly when the confirmation email could not be sent', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 9, status: 1, amountMinor: 0, confirmationEmailStatus: 2 } });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/couldn’t send the confirmation email, but your entry is saved/)).toBeInTheDocument();
  });

  it('needs the single consent tick, and sends it as AcceptTerms', async () => {
    mount('/competitions/1/enter/5', [section({ priceMinor: 0 })]);
    await userEvent.type(screen.getByLabelText('Your name'), 'Example Rider');
    const consent = screen.getByRole('checkbox', { name: 'I agree' });
    expect(screen.getAllByRole('checkbox', { name: 'I agree' })).toHaveLength(1);
    expect(consent).toHaveAccessibleDescription(/parental or guardian consent/);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await userEvent.click(consent);
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ acceptTerms: true, consentVersion: '2026-10-v2' });
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty('agreed');
  });

  it('copies the bank details from the pay step', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount('/competitions/1/enter/5');
    await fill();
    await userEvent.click(next());
    await userEvent.click(screen.getByRole('button', { name: 'Copy bank details' }));
    expect(writeText).toHaveBeenCalledWith('Pay to: Club 12-34-56\nReference: Alice Rider\nAmount: £10');
    expect(await screen.findByRole('status')).toHaveTextContent('Bank details copied');
  });

  it('says the organiser will send payment details when none were set', async () => {
    mount('/competitions/1/enter/5', [section()], { paymentDestination: null });
    await fill();
    await userEvent.click(next());
    expect(screen.getByText('The organiser will send you their payment details.')).toBeInTheDocument();
    expect(screen.queryByText('Pay to')).not.toBeInTheDocument();
  });
});
