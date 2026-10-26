import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { team } from '../../test/factories';
import type { CompetitionPickerItem } from '../../types';
import { NeedsYouContext, type NeedsYouValue } from '../profile/needsYou';
import type { ExtendedMySignup } from '../MySignupsPage';
import { NeedsYouPanel } from './NeedsYouPanel';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
const auth = vi.hoisted(() => ({ roles: [] as string[], owns: [] as number[], clubId: 7 as number | null }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', clubId: auth.clubId },
    hasRole: (role: string) => auth.roles.includes(role),
    canOrganise: (competition?: { id?: number }) => auth.roles.includes('Admin') || (auth.roles.includes('Trainer') && auth.owns.includes(competition?.id ?? -1)),
  }),
}));

const start = new Date();
const item = (id: number, extra: Partial<CompetitionPickerItem> = {}): CompetitionPickerItem => ({ id, name: `Event ${id}`, startDate: start.toISOString(), endDate: null, icon: 'flag', ...extra });

function needs(extra: Partial<NeedsYouValue> = {}): NeedsYouValue {
  return { requests: [], teams: null, decForms: [], count: 0, review: async () => true, ...extra };
}
function mountNeeds(value: NeedsYouValue, events: CompetitionPickerItem[] = [], dueEntries: ExtendedMySignup[] = []) {
  return render(<MemoryRouter><NeedsYouContext.Provider value={value}><NeedsYouPanel events={events} dueEntries={dueEntries} /></NeedsYouContext.Provider></MemoryRouter>);
}

beforeEach(() => {
  auth.roles = ['Admin'];
  auth.owns = [];
  auth.clubId = 7;
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/competitions/1/signups') return { data: [{ status: 0 }, { status: 1 }, { status: 0 }] } as never;
    if (url === '/competitions/1/dec-form-flags') return { data: [{ teamId: 3, teamName: 'Oak A', declarationFormId: 9, flags: ['Rider is over the weight limit'] }, { teamId: 4, teamName: 'Ash B', declarationFormId: 10, flags: ['Pony is too tall'] }] } as never;
    if (url === '/clubs/7/payouts/summary') return { data: { clubName: 'Stockport PC', maskedAccount: null, ready: false } } as never;
    throw new Error(`unexpected ${url}`);
  });
});

describe('Needs you', () => {
  const request = { userId: 'r1', fullName: 'Sam Lee', email: 's@example.com', clubName: null, requestedAt: '2026-10-20T09:00:00Z' };

  it('shows approvals with inline buttons, dec forms, unpaid entries and payouts that are not ready, each with a link', async () => {
    const review = vi.fn().mockResolvedValue(true);
    mountNeeds(needs({ requests: [request], decForms: [team(3, { competitionId: 4, displayName: 'Oak A' })], review }), [item(1)]);
    const region = within(screen.getByRole('region', { name: 'Needs you' }));
    expect(region.getByText('Sam Lee')).toBeInTheDocument();
    expect(await region.findByRole('link', { name: /Open: Entries not paid, Event 1/ })).toHaveAttribute('href', '/competitions/1/details');
    expect(region.getByText('Entries not paid')).toBeInTheDocument();
    expect(await region.findByRole('link', { name: /Open: Dec forms flagged, Event 1/ })).toHaveAttribute('href', '/competitions/1/declarations');
    expect(await region.findByRole('link', { name: /Set up: Payouts aren’t set up/ })).toHaveAttribute('href', '/me/payouts');
    expect(region.getByRole('link', { name: /Fill in: Dec form to send, Oak A/ })).toHaveAttribute('href', '/competitions/4/declarations?team=3');
    await userEvent.click(region.getByRole('button', { name: 'Approve Sam Lee' }));
    expect(review).toHaveBeenCalledWith(request, 'approve');
  });

  it('asks in a red dialog before declining, and declines only when confirmed', async () => {
    const review = vi.fn().mockResolvedValue(true);
    const asked = autoConfirm([false, true]);
    mountNeeds(needs({ requests: [request], review }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline Sam Lee' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Their account stays a member.'));
    expect(review).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Decline Sam Lee' }));
    await waitFor(() => expect(review).toHaveBeenCalledWith(request, 'decline'));
    expect(asked.titles).toEqual(['Decline Sam Lee’s request?', 'Decline Sam Lee’s request?']);
  });

  it('says so when the server refuses', async () => {
    mountNeeds(needs({ requests: [request], review: async () => false, reviewError: 'Nope.' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Sam Lee' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope.');
  });

  it('is hidden when nothing needs the person, and a trainer only sees events they own', async () => {
    auth.roles = ['Trainer'];
    auth.owns = [2];
    mountNeeds(needs(), [item(1), item(2)]);
    await waitFor(() => expect(api.get).not.toHaveBeenCalledWith('/competitions/1/signups'));
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull();
  });

  it('asks a rider to pay for their own unpaid entries, with How to pay and the price on the row', () => {
    const entry = { id: 1, competitionId: 11, competitionName: 'Spring Open', sectionName: 'Under 15 Pairs', amountMinor: 4000, status: 0 } as ExtendedMySignup;
    auth.roles = ['Member'];
    mountNeeds(needs(), [], [entry]);
    const region = within(screen.getByRole('region', { name: 'Needs you' }));
    expect(region.getByText('£40.00')).toBeInTheDocument();
    expect(region.getByText('Spring Open · Under 15 Pairs')).toBeInTheDocument();
    expect(region.getByRole('link', { name: /How to pay: Pay for your entry/ })).toHaveAttribute('href', '/competitions/11/details');
  });

  it('uses the singular for one unpaid entry and one flagged form', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/1/signups') return { data: [{ status: 0 }] } as never;
      if (url === '/competitions/1/dec-form-flags') return { data: [{}] } as never;
      return { data: {} } as never;
    });
    auth.clubId = null;
    mountNeeds(needs(), [item(1)]);
    expect(await screen.findByText('Entry not paid')).toBeInTheDocument();
    expect(await screen.findByText('Dec form flagged')).toBeInTheDocument();
  });
});
