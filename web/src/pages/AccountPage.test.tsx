import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { AccountPage } from './AccountPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

function mount(user: Partial<StoredAuth['user']> = {}) {
  const auth: StoredAuth = {
    token: 't', expiresAt: '2099-01-01T00:00:00Z',
    user: { id: 'u1', fullName: 'Jamie Carter', email: 'jamie@example.com', clubId: 7, clubName: 'Warwickshire Hunt', roles: ['Trainer'], ...user },
  };
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  return render(
    <MemoryRouter initialEntries={['/me/account']}>
      <AuthProvider>
        <Routes>
          <Route path="/me/account" element={<AccountPage />} />
          <Route path="/privacy" element={<p>Privacy page</p>} />
          <Route path="/" element={<p>Home page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async () => ({ data: { id: 'u1', fullName: 'Jamie C. Carter', email: 'jamie@example.com', clubId: 7, clubName: 'Warwickshire Hunt', roles: ['Trainer'] } }));
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(api.post).mockResolvedValue({ status: 204 });
});

describe('AccountPage', () => {
  it('lists name, email, club and role as settings rows, then Password', () => {
    mount();
    expect(screen.getByRole('button', { name: /^Name: Jamie Carter/ })).toBeInTheDocument();
    expect(screen.getByText('jamie@example.com')).toBeInTheDocument();
    expect(screen.getByText('Warwickshire Hunt')).toBeInTheDocument();
    expect(screen.getByText('Trainer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Password/ })).toHaveTextContent('Change');
    expect(screen.getByRole('link', { name: 'privacy page' })).toHaveAttribute('href', '/privacy');
  });

  it('leaves the club out when there is none, and says Not set for a missing name', () => {
    mount({ clubId: null, clubName: null, fullName: '', roles: ['Member'] });
    expect(screen.queryByText('Club')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Name: Not set/ })).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
  });

  it('shows a pending trainer request as such', () => {
    mount({ roles: ['TrainerRequest'] });
    expect(screen.getByText('Trainer request')).toBeInTheDocument();
  });

  it('edits the name in place and saves it with Done', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /^Name:/ }));
    const input = screen.getByLabelText('Name');
    expect(input).toHaveValue('Jamie Carter');
    await user.clear(input);
    await user.type(input, '  Jamie C. Carter ');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/auth/me', { fullName: 'Jamie C. Carter' }));
    expect(await screen.findByRole('button', { name: /^Name: Jamie C. Carter/ })).toBeInTheDocument();
    expect(await screen.findByText('Name saved')).toBeInTheDocument();
  });

  it('does not call the API when the name has not changed, and will not save a blank one', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /^Name:/ }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(api.put).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Name:/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Name:/ }));
    await user.clear(screen.getByLabelText('Name'));
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('shows the reason when the name can’t be saved, and keeps the box open', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { status: 409, data: { message: 'This shared account takes its name from how you sign in, so it can’t be changed here.' } } });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /^Name:/ }));
    await user.type(screen.getByLabelText('Name'), ' Jr');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('takes its name from how you sign in');
    expect(screen.getByLabelText('Name')).toHaveValue('Jamie Carter Jr');
  });

  it('falls back to a plain message when there is no signal', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /^Name:/ }));
    await user.type(screen.getByLabelText('Name'), '!');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save your name. Check your signal and try again.');
  });

  it('opens the change password sheet and says so when it is done', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /^Password/ }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Change password' }));
    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw');
    await user.click(sheet.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-Passw0rd!', newPassword: 'Brand-new9pw' }));
    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the sheet without changing anything when the person cancels', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /^Password/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Change password' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('has Delete my account as red text, which asks for the password in a sheet', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole('button', { name: 'Delete my account' });
    expect(trigger).toHaveClass('sp-red');
    await user.click(trigger);
    const sheet = within(await screen.findByRole('dialog', { name: 'Delete your account?' }));
    expect(sheet.getByRole('button', { name: 'Keep my account' })).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
    vi.mocked(api.delete).mockResolvedValue({ status: 204 });
    await user.type(sheet.getByLabelText('Your password'), 'secret');
    await user.click(sheet.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(api.delete).toHaveBeenCalledWith('/auth/me', { data: { password: 'secret' } });
  });

  it('shows nothing for a visitor', () => {
    localStorage.clear();
    render(<MemoryRouter><AuthProvider><AccountPage /></AuthProvider></MemoryRouter>);
    expect(screen.queryByText('Name')).not.toBeInTheDocument();
  });
});
