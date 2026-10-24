import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import type { TrainerRequest } from '../../types';
import { NeedsYouProvider } from '../profile/NeedsYouProvider';
import { NeedsYouPanel } from './NeedsYouPanel';
import { SiteAdmin } from './SiteAdmin';

import { autoConfirm } from '../../test/confirm';
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const path = '/admin/trainer-requests';
const request: TrainerRequest = {
  userId: 'test-applicant', fullName: 'Test Applicant', email: 'applicant@example.com',
  clubName: 'Test Pony Club', requestedAt: '2026-10-01T09:00:00Z',
};
let requests: TrainerRequest[];
let failLoad: boolean;

function mount(roles = ['Admin']) {
  localStorage.setItem('mg.auth', JSON.stringify({
    token: 'test-token', expiresAt: '2099-01-01T00:00:00Z',
    user: { id: 'test-admin', fullName: 'Test Admin', email: 'admin@example.com', roles },
  }));
  return render(<AuthProvider><MemoryRouter><SiteAdmin /></MemoryRouter></AuthProvider>);
}

beforeEach(() => {
  requests = [request];
  failLoad = false;
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === path) {
      if (failLoad) throw new Error('offline');
      return { data: requests };
    }
    if (url === '/auth/me') return { data: { roles: ['Admin'] } };
    if (url === '/ip-blocks/mine') return { data: { ip: null } };
    return { data: [] };
  });
  vi.mocked(api.post).mockImplementation(async () => { requests = []; return { data: null }; });
});

describe('admin trainer requests', () => {
  it('lists name, email, club and request time', async () => {
    mount();
    const section = screen.getByRole('region', { name: 'Waiting for you' });
    expect(await within(section).findByText(request.fullName)).toBeInTheDocument();
    expect(within(section).getByText(request.email!)).toBeInTheDocument();
    expect(within(section).getByText(request.clubName!)).toBeInTheDocument();
    const date = within(section).getByText(new Date(request.requestedAt).toLocaleString('en-GB'));
    expect(date).toHaveAttribute('datetime', request.requestedAt);
  });

  it('shows the empty state', async () => {
    requests = [];
    mount();
    expect(await screen.findByText('No trainer requests.')).toBeInTheDocument();
  });

  it('handles a missing club', async () => {
    requests = [{ ...request, clubName: null }];
    mount();
    expect(await screen.findByText('No club given')).toBeInTheDocument();
  });

  it('approves and refreshes the list', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(api.post).toHaveBeenCalledWith(`${path}/${request.userId}/approve`);
    expect(await screen.findByText('No trainer requests.')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === path)).toHaveLength(2);
  });

  it('confirms decline before submitting and refreshing', async () => {
    const confirm = autoConfirm(true);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(confirm).toHaveBeenCalledWith(`Decline the request from ${request.fullName}? Their account will stay a member.`);
    expect(api.post).toHaveBeenCalledWith(`${path}/${request.userId}/decline`);
    expect(await screen.findByText('No trainer requests.')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === path)).toHaveLength(2);
  });

  it('does nothing if decline is cancelled', async () => {
    autoConfirm(false);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText(request.fullName)).toBeInTheDocument();
  });

  it('shows load errors inline and lets the admin retry', async () => {
    failLoad = true;
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load trainer requests. Try again.');
    expect(screen.queryByText('No trainer requests.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load trainer requests.');
    failLoad = false;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    expect(await screen.findByText(request.fullName)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['Approve', 'Decline'])('shows %s errors inline without removing the request', async (action) => {
    autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue(new Error('conflict'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: action }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update trainer requests. Refresh the list and try again.');
    expect(screen.getByText(request.fullName)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('requires a refresh if reloading after a successful action fails', async () => {
    vi.mocked(api.post).mockImplementation(async () => { failLoad = true; requests = []; return { data: null }; });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh the list');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    failLoad = false;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    expect(await screen.findByText('No trainer requests.')).toBeInTheDocument();
  });

  it('disables both actions while a decision is saving', async () => {
    let finish!: () => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => {
      finish = () => { requests = []; resolve({ data: null }); };
    }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    finish();
    expect(await screen.findByText('No trainer requests.')).toBeInTheDocument();
  });

  it('lets an admin approve a request straight away, team manager requests included', async () => {
    requests = [{ ...request, requestedRole: 'Manager' }];
    mount(['Admin']);
    expect(await screen.findByText(request.fullName)).toBeInTheDocument();
    expect(screen.getByText(/Team manager/)).toBeInTheDocument();
    expect(screen.queryByText(/Switch to edit mode to approve/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(api.post).toHaveBeenCalledWith(`${path}/${encodeURIComponent(request.userId)}/approve`);
  });

  it("shows the server's message when approving fails", async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 404, data: { message: 'That request has already been dealt with.' } } });
    mount(['Admin']);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That request has already been dealt with.');
  });

  it('does not fetch or show trainer requests for a non-admin', async () => {
    mount(['Trainer']);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'));
    expect(api.get).not.toHaveBeenCalledWith(path);
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).not.toBeInTheDocument();
  });

  it('clears a resolved request from both NeedsYouPanel and TrainerRequestsSection when either side acts', async () => {
    localStorage.setItem('mg.auth', JSON.stringify({
      token: 'test-token', expiresAt: '2099-01-01T00:00:00Z',
      user: { id: 'test-admin', fullName: 'Test Admin', email: 'admin@example.com', roles: ['Admin'] },
    }));
    render(
      <AuthProvider>
        <NeedsYouProvider>
          <MemoryRouter>
            <NeedsYouPanel />
            <SiteAdmin />
          </MemoryRouter>
        </NeedsYouProvider>
      </AuthProvider>,
    );
    expect(await screen.findAllByText(request.fullName)).toHaveLength(2);
    const waitingRegion = screen.getByRole('region', { name: 'Waiting for you' });
    await userEvent.click(within(waitingRegion).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryAllByText(request.fullName)).toHaveLength(0));
  });

  it('removes a request from TrainerRequestsSection when NeedsYouProvider dispatches mg:trainer-requests-changed', async () => {
    mount();
    expect(await screen.findByText(request.fullName)).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('mg:trainer-requests-changed', { detail: { userId: request.userId } }));
    });
    expect(await screen.findByText('No trainer requests.')).toBeInTheDocument();
  });
});

describe('admin competitions', () => {
  const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString();
  const summary = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, location: 'Hartpury College', startDate: day(10), endDate: null, isActive: false, isArchived: false,
    sectionCount: 2, teamCount: 17, sessionCount: 0, ...extra,
  });
  let comps: unknown[];
  let blocks: unknown[];
  let myIp: string | null;

  beforeEach(() => {
    comps = [
      summary(1, 'Hartpury Area Festival', { startDate: day(0), sessionCount: 5, teamCount: 42 }),
      summary(2, 'Northern Winter League R1'),
      summary(3, 'Christmas Cracker Teams', { sectionCount: 0, teamCount: 0 }),
      summary(4, 'Kelsall Hill Pairs', { startDate: day(-30), sessionCount: 3 }),
    ];
    blocks = [{ id: 9, ipAddress: '81.2.69.160', reason: 'Spam in live feed', createdAt: '2026-10-01T00:00:00Z' }];
    myIp = '10.0.0.1';
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions') return { data: comps };
      if (url === '/ip-blocks') return { data: blocks };
      if (url === '/ip-blocks/mine') return { data: { ip: myIp } };
      if (url === '/clubs') return { data: [{ id: 1, name: 'Wirral PC', region: 'North', bibColour: null }] };
      if (url === path) return { data: [] };
      if (url === '/auth/me') return { data: { roles: ['Admin'] } };
      return { data: [] };
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it('shows each competition with its stage, entries and one action for the next job', async () => {
    mount();
    const section = await screen.findByRole('region', { name: 'Competitions' });
    await within(section).findByText('Hartpury Area Festival');
    const item = (name: string) => within(section).getByText(name).closest('li')!;
    expect(item('Hartpury Area Festival')).toHaveTextContent('Live');
    expect(item('Hartpury Area Festival')).toHaveTextContent('42');
    expect(within(item('Hartpury Area Festival')).getByRole('link', { name: /Run day/ })).toHaveAttribute('href', '/competitions/1');
    expect(item('Northern Winter League R1')).toHaveTextContent('Build timetable');
    expect(within(item('Northern Winter League R1')).getByRole('link', { name: /On the day/ })).toHaveAttribute('href', '/admin/competitions/2/format');
    expect(item('Christmas Cracker Teams')).toHaveTextContent('Draft');
    expect(within(item('Christmas Cracker Teams')).getByRole('link', { name: /Edit/ })).toHaveAttribute('href', '/admin/competitions/3');
    expect(item('Kelsall Hill Pairs')).toHaveTextContent('Finished');
    expect(section).toHaveTextContent('3 upcoming · 1 past');
  });

  it('locks signups from the more menu and says so', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'More for Northern Winter League R1' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Lock signups' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/2/signups-locked', { locked: true });
    expect(await screen.findByRole('status')).toHaveTextContent('Signups locked for Northern Winter League R1.');
    await userEvent.click(screen.getByRole('button', { name: 'More for Northern Winter League R1' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open signups again' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/2/signups-locked', { locked: false });
    expect(await screen.findByText('Signups opened again for Northern Winter League R1.')).toBeInTheDocument();
  });

  it('says so when locking fails, and closes the menu on Escape', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'More for Northern Winter League R1' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More for Northern Winter League R1' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Lock signups' }));
    expect(await screen.findByText(/Couldn’t lock signups for Northern Winter League R1/)).toBeInTheDocument();
  });

  it('deletes only after the name is typed in full, in a red confirmation', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'More for Christmas Cracker Teams' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete competition' }));
    const dialog = await screen.findByRole('alertdialog', { name: /Delete “Christmas Cracker Teams” forever\?/ });
    expect(dialog).toHaveClass('mg-confirm-danger');
    const confirm = within(dialog).getByRole('button', { name: 'Delete competition' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'wrong');
    expect(confirm).toBeDisabled();
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.clear(within(dialog).getByRole('textbox'));
    await userEvent.type(within(dialog).getByRole('textbox'), 'Christmas Cracker Teams');
    await userEvent.click(confirm);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/3'));
  });

  it('deletes nothing when the confirmation is cancelled', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'More for Christmas Cracker Teams' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete competition' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('shows the whole menu to an admin with no edit mode to switch on', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'More for Christmas Cracker Teams' }));
    expect(screen.getByRole('menuitem', { name: 'Open competition' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit details' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'On the day & format' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Operations & tools' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Scorer QR codes' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Go live & stream' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Dec forms' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Manage event shop' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete competition' })).toBeInTheDocument();
  });

  it('blocks an address, shows your own address and lifts a block', async () => {
    mount();
    expect(await screen.findByText('81.2.69.160')).toBeInTheDocument();
    expect(screen.getByText(/NOT blocked/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use my address' }));
    expect(screen.getByLabelText('IP address')).toHaveValue('10.0.0.1');
    await userEvent.type(screen.getByLabelText(/Reason/), 'Testing');
    await userEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(api.post).toHaveBeenCalledWith('/ip-blocks', { ipAddress: '10.0.0.1', reason: 'Testing' });
    await userEvent.click(screen.getByRole('button', { name: 'Unblock 81.2.69.160' }));
    expect(api.delete).toHaveBeenCalledWith('/ip-blocks/9');
  });

  it('warns when your own address is blocked and lets you unblock it', async () => {
    myIp = '81.2.69.160';
    mount();
    expect(await screen.findByText(/BLOCKED/)).toBeInTheDocument();
    expect(screen.getByText('(YOU)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unblock me' }));
    expect(api.delete).toHaveBeenCalledWith('/ip-blocks/9');
  });

  it('says so when there are no competitions or blocked addresses, and lists clubs by region', async () => {
    comps = [];
    blocks = [];
    mount();
    expect(await screen.findByText('No competitions yet.')).toBeInTheDocument();
    expect(screen.getByText(/No addresses blocked/)).toBeInTheDocument();
    expect(await screen.findByText('Wirral PC')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
  });

  it('shows at most 4 competitions initially and expands or collapses the rest on click', async () => {
    comps = [
      summary(1, 'Hartpury Area Festival'),
      summary(2, 'Northern Winter League R1'),
      summary(3, 'Christmas Cracker'),
      summary(4, 'Kelsall Hill Pairs'),
      summary(5, 'Summer Championships'),
      summary(6, 'Autumn Friendly'),
    ];
    mount();
    const section = await screen.findByRole('region', { name: 'Competitions' });
    expect(await within(section).findByText('Hartpury Area Festival')).toBeInTheDocument();
    expect(within(section).getByText('Kelsall Hill Pairs')).toBeInTheDocument();
    expect(within(section).queryByText('Summer Championships')).not.toBeInTheDocument();
    expect(within(section).queryByText('Autumn Friendly')).not.toBeInTheDocument();

    const toggle = within(section).getByRole('button', { name: 'Show 2 more competitions' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);

    expect(within(section).getByText('Summer Championships')).toBeInTheDocument();
    expect(within(section).getByText('Autumn Friendly')).toBeInTheDocument();
    const collapseBtn = within(section).getByRole('button', { name: 'Show fewer competitions' });
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(collapseBtn);
    expect(within(section).queryByText('Summer Championships')).not.toBeInTheDocument();
  });
});
