import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import type { CompetitionDetail, CompetitionSection, Role } from '../../types';
import { EntryPage } from './EntryPage';

const state = vi.hoisted(() => ({ roles: ['Member'] as string[], detail: null as unknown, settings: null as unknown }));

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  useCompetition: () => ({ competition: state.detail, reload: vi.fn() }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1' }, canEdit: () => false, canManage: () => false, canOrganise: () => false,
    hasRole: (role: Role) => state.roles.includes(role),
  }),
}));

const section = (extra: Partial<CompetitionSection> = {}): CompetitionSection => ({
  id: 5, competitionId: 1, format: 3, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 0, ...extra,
});

function mount(path: string, sections: CompetitionSection[], extra: Partial<CompetitionDetail> = {}) {
  state.detail = competition({ id: 1, name: 'Spring Games', startDate: '2031-05-10T09:00:00Z', paymentDestination: 'Club 12-34-56', sections, ...extra });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/competitions/:id/enter/*" element={<EntryPage />} /></Routes>
    </MemoryRouter>,
  );
}

const agree = () => userEvent.click(screen.getByRole('checkbox', { name: 'I agree' }));

beforeEach(() => {
  vi.clearAllMocks();
  state.roles = ['Member'];
  state.settings = [];
  vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.endsWith('/entry-settings') ? state.settings : [] }));
  vi.mocked(api.post).mockResolvedValue({ data: { id: 9, status: 1, amountMinor: 0 } });
});

describe('rider, parent and emergency contact', () => {
  it('keeps the rider apart from the parent and sends the details as flat fields', async () => {
    mount('/competitions/1/enter/5', [section()]);
    expect(screen.getByRole('group', { name: 'Rider' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Parent or guardian and emergency contact' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your name'), 'Pat Parent');
    await userEvent.type(screen.getByLabelText('Rider’s name'), 'Remy Rider');
    await userEvent.type(screen.getByLabelText('Rider’s date of birth'), '2021-04-05');
    await userEvent.type(screen.getByLabelText('Pony’s name'), 'Biscuit');
    await userEvent.type(screen.getByLabelText('Parent or guardian’s name'), 'Pat Parent');
    await userEvent.type(screen.getByLabelText('Parent or guardian’s mobile'), '07700 900123');
    await userEvent.type(screen.getByLabelText('Emergency contact’s name'), 'Sam Aunt');
    await userEvent.type(screen.getByLabelText('Emergency contact’s mobile'), '07700 900456');
    await agree();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/sections/5/signups', expect.objectContaining({
      fullName: 'Pat Parent', riderName: 'Remy Rider', riderDateOfBirth: '2021-04-05', ponyName: 'Biscuit',
      guardianName: 'Pat Parent', guardianPhone: '07700 900123', emergencyContactName: 'Sam Aunt', emergencyContactPhone: '07700 900456',
    })));
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty('guest');
  });

  it('warns about the age group without blocking the entry', async () => {
    mount('/competitions/1/enter/5', [section()]);
    await userEvent.type(screen.getByLabelText('Your name'), 'Pat Parent');
    await userEvent.type(screen.getByLabelText('Rider’s date of birth'), '2012-04-05');
    expect(screen.getByText(/older than Under 12 allows/)).toBeInTheDocument();
    await agree();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('stops a name without its phone number and says why', async () => {
    mount('/competitions/1/enter/5', [section()]);
    await userEvent.type(screen.getByLabelText('Your name'), 'Pat Parent');
    await userEvent.type(screen.getByLabelText('Parent or guardian’s name'), 'Pat Parent');
    await agree();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give both the parent or guardian’s name and phone number, or neither.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends nothing extra when the section is left blank', async () => {
    mount('/competitions/1/enter/5', [section()]);
    await userEvent.type(screen.getByLabelText('Your name'), 'Alice Adult');
    await agree();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty('riderName');
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty('guardianPhone');
  });

  it('is not asked of a whole-team entry', async () => {
    state.roles = ['Manager'];
    mount('/competitions/1/enter/5', [section({ format: 2 })]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enter a whole team' }));
    expect(screen.queryByRole('group', { name: 'Rider' })).not.toBeInTheDocument();
  });

  it('is asked of a guest rider', () => {
    mount('/competitions/1/enter/5?type=guest', [section({ format: 2 })]);
    expect(screen.getByRole('group', { name: 'Rider' })).toBeInTheDocument();
  });
});

describe('payment link and stables left', () => {
  it('offers the online payment link beside the bank details once the entry is in', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 9, status: 0, amountMinor: 1000 } });
    mount('/competitions/1/enter/5', [section({ priceMinor: 1000 })], { paymentLinkUrl: 'https://buy.stripe.com/abc' });
    await userEvent.type(screen.getByLabelText('Your name'), 'Alice Adult');
    await agree();
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const link = await screen.findByRole('link', { name: /^Pay online/ });
    expect(link).toHaveAttribute('href', 'https://buy.stripe.com/abc');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('region', { name: 'Bank transfer details' })).toBeInTheDocument();
  });

  it('ignores a payment link that is not https', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 9, status: 0, amountMinor: 1000 } });
    mount('/competitions/1/enter/5', [section({ priceMinor: 1000 })], { paymentLinkUrl: 'http://example.com/pay' });
    await userEvent.type(screen.getByLabelText('Your name'), 'Alice Adult');
    await agree();
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('heading', { name: 'Entry submitted' });
    expect(screen.queryByRole('link', { name: /^Pay online/ })).not.toBeInTheDocument();
  });

  it('shows stables left and stops the stepper at the last one', async () => {
    state.settings = { competitionId: 1, entriesClosed: false, entriesCloseAt: null, stablesRemaining: 1, hookupsRemaining: 0 };
    mount('/competitions/1/enter/5', [section({ format: 2 })]);
    expect(await screen.findByText('1 stable left')).toBeInTheDocument();
    expect(screen.getByText('No hook-ups left')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'One more stable' }));
    expect(screen.getByRole('button', { name: 'One more stable' })).toBeDisabled();
  });

  it('says none are left and disables the stepper at zero', async () => {
    state.settings = { competitionId: 1, entriesClosed: false, entriesCloseAt: null, stablesRemaining: 0, hookupsRemaining: null };
    mount('/competitions/1/enter/5', [section({ format: 2 })]);
    expect(await screen.findByText('None left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'One more stable' })).toBeDisabled();
  });
});
