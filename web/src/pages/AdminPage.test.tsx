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
  api: { get: vi.fn(), post: vi.fn() },
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
    const section = screen.getByRole('region', { name: 'Trainer requests' });
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
    expect(screen.queryByRole('region', { name: 'Trainer requests' })).not.toBeInTheDocument();
  });
});
