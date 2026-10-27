import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { ChangePasswordSheet } from './ChangePasswordSheet';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const signedIn: StoredAuth = {
  token: 'old-token', expiresAt: '2099-01-01T00:00:00Z',
  user: { id: 'u1', email: 'sam@example.com', fullName: 'Sam Lee', clubId: null, clubName: null, roles: ['Member'] },
};

const onClose = vi.fn();
const onChanged = vi.fn();

beforeEach(() => {
  onClose.mockReset();
  onChanged.mockReset();
  vi.mocked(api.post).mockResolvedValue({ status: 204 });
  vi.mocked(api.get).mockResolvedValue({ data: signedIn.user });
  localStorage.setItem('mg.auth', JSON.stringify(signedIn));
});

const mount = () => {
  render(<AuthProvider><ChangePasswordSheet onClose={onClose} onChanged={onChanged} /></AuthProvider>);
  return within(screen.getByRole('dialog', { name: 'Change password' }));
};

describe('ChangePasswordSheet', () => {
  it('asks for the current and a new password, and starts with nothing to send', () => {
    const sheet = mount();
    expect(sheet.getByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(sheet.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(sheet.getByRole('button', { name: 'Change password' })).toBeDisabled();
  });

  it('shows the next password rule as the new one is typed, and holds the button until every rule is met', async () => {
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'abc');
    expect(sheet.getAllByText(/At least 8 characters/).length).toBeGreaterThan(0);
    expect(sheet.getByRole('button', { name: 'Change password' })).toBeDisabled();
    await user.type(sheet.getByLabelText('New password'), 'defgh1!');
    expect(sheet.getAllByText(/Password meets all requirements|All password requirements met/).length).toBeGreaterThan(0);
    expect(sheet.getByRole('button', { name: 'Change password' })).toBeEnabled();
  });

  it('needs the current password too', async () => {
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw');
    expect(sheet.getByRole('button', { name: 'Change password' })).toBeDisabled();
  });

  it('sends both passwords and tells the page it worked', async () => {
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-Passw0rd!', newPassword: 'Brand-new9pw' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // An answer with no new sign-in leaves this device's one alone.
    expect(JSON.parse(localStorage.getItem('mg.auth') ?? '{}').token).toBe('old-token');
  });

  it('keeps this device signed in with the fresh token the server sends back', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { ...signedIn, token: 'new-token' } });
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw{Enter}');
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem('mg.auth') ?? '{}').token).toBe('new-token');
  });

  it('shows the server’s reason, keeps what was typed, and lets the person try again', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { message: 'Your current password isn’t right.' } } });
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'wrong');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw');
    await user.click(sheet.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current password isn’t right.');
    expect(onChanged).not.toHaveBeenCalled();
    expect(sheet.getByLabelText('New password')).toHaveValue('Brand-new9pw');
    await waitFor(() => expect(sheet.getByRole('button', { name: 'Change password' })).toBeEnabled());
  });

  it('falls back to a plain message when there was no signal', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    const sheet = mount();
    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw');
    await user.click(sheet.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change your password. Check your signal and try again.');
  });

  it('ignores a submit before both passwords are in, or while one is already being sent', async () => {
    let finish: (value: unknown) => void = () => {};
    vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    const sheet = mount();
    const form = sheet.getByLabelText('New password').closest('form')!;
    fireEvent.submit(form);
    expect(api.post).not.toHaveBeenCalled();

    await user.type(sheet.getByLabelText('Current password'), 'old-Passw0rd!');
    await user.type(sheet.getByLabelText('New password'), 'Brand-new9pw');
    fireEvent.submit(form);
    await waitFor(() => expect(sheet.getByRole('button', { name: 'Changing…' })).toBeDisabled());
    fireEvent.submit(form);
    expect(api.post).toHaveBeenCalledTimes(1);
    finish({ status: 204 });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('closes from Cancel without sending anything', async () => {
    const user = userEvent.setup();
    const sheet = mount();
    await user.click(sheet.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.post).not.toHaveBeenCalled();
  });
});
