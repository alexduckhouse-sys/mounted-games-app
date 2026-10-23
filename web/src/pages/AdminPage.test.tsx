import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import type { TrainerRequest } from '../types';
import { AdminPage } from './AdminPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const path = '/admin/trainer-requests';
const request: TrainerRequest = {
  userId: 'test-applicant', fullName: 'Test Applicant', email: 'applicant@example.com',
  clubName: 'Test Pony Club', requestedAt: '2026-10-01T09:00:00Z',
};
let requests: TrainerRequest[];
let failLoad: boolean;

function mount(roles = ['Admin'], editMode = true) {
  localStorage.setItem('mg.auth', JSON.stringify({
    token: 'test-token', expiresAt: '2099-01-01T00:00:00Z',
    user: { id: 'test-admin', fullName: 'Test Admin', email: 'admin@example.com', roles },
  }));
  if (editMode) localStorage.setItem('mg.adminEditorMode', '1');
  return render(<AuthProvider><MemoryRouter><AdminPage /></MemoryRouter></AuthProvider>);
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
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(confirm).toHaveBeenCalledWith(`Decline the request from ${request.fullName}? Their account will stay a member.`);
    expect(api.post).toHaveBeenCalledWith(`${path}/${request.userId}/decline`);
    expect(await screen.findByText('No trainer requests.')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === path)).toHaveLength(2);
  });

  it('does nothing if decline is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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

  it('lists requests in view mode with instructions to enable edit mode', async () => {
    mount(['Admin'], false);
    expect(await screen.findByText(request.fullName)).toBeInTheDocument();
    expect(screen.getByText('Switch to edit mode to approve or decline requests.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('does not fetch or show trainer requests for a non-admin', async () => {
    mount(['Trainer']);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'));
    expect(api.get).not.toHaveBeenCalledWith(path);
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).not.toBeInTheDocument();
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

  it('deletes only after the name is typed in full, and only in edit mode', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('wrong').mockReturnValueOnce('Christmas Cracker Teams');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'More for Christmas Cracker Teams' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete competition' }));
    expect(alertSpy).toHaveBeenCalledWith('Name did not match — nothing deleted.');
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'More for Christmas Cracker Teams' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete competition' }));
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(api.delete).toHaveBeenCalledWith('/competitions/3');
  });

  it('keeps Delete out of the menu in view mode', async () => {
    mount(['Admin'], false);
    await userEvent.click(await screen.findByRole('button', { name: 'More for Christmas Cracker Teams' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete competition' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit details' })).toBeInTheDocument();
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
});
