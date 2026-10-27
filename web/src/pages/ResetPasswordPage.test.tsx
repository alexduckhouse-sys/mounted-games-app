import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { ResetPasswordPage } from './ResetPasswordPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const STRONG = 'N3w-passw0rd!';

function mount(hash = '#t=mgr_abc123') {
  window.history.replaceState(null, '', `/reset-password${hash}`);
  return render(<AuthProvider><MemoryRouter initialEntries={['/reset-password']}><Routes>
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/login" element={<p>Sign in page</p>} />
    <Route path="/forgot-password" element={<p>Forgot page</p>} />
  </Routes></MemoryRouter></AuthProvider>);
}

/** Answers the link check with `state`, and the confirm with `confirm`. */
function answer(state: number | undefined, confirm: () => Promise<unknown> = async () => ({ data: { message: 'Changed' } })) {
  vi.mocked(api.post).mockImplementation(async (url: string) => {
    if (url === '/auth/password-reset/check') return { data: state === undefined ? undefined : { state, expiresAt: null } };
    return confirm();
  });
}

beforeEach(() => answer(0));
afterEach(() => window.history.replaceState(null, '', '/'));

describe('ResetPasswordPage', () => {
  it('reads the token from the fragment, takes it out of the address, and checks it', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/password-reset/check', { token: 'mgr_abc123' });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/reset-password');
    expect(screen.getByRole('button', { name: 'Save new password' })).toBeDisabled();
  });

  it('sets the new password once it meets the rules, then sends the person to sign in', async () => {
    const user = userEvent.setup();
    mount();
    const field = await screen.findByLabelText('New password');
    await user.type(field, 'short');
    expect(screen.getByRole('button', { name: 'Save new password' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, STRONG);
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(api.post).toHaveBeenCalledWith('/auth/password-reset/confirm', { token: 'mgr_abc123', newPassword: STRONG });
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('signed out on every device');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('signs this device out too when someone was signed in here', async () => {
    const user = userEvent.setup();
    const stored: StoredAuth = {
      token: 'old-jwt', expiresAt: '2099-01-01T00:00:00Z',
      user: { id: 'u1', fullName: 'Sam Lee', email: 'sam@example.com', clubId: null, clubName: null, roles: ['Member'] },
    };
    localStorage.setItem('mg.auth', JSON.stringify(stored));
    vi.mocked(api.get).mockResolvedValue({ data: stored.user });
    mount();
    await user.type(await screen.findByLabelText('New password'), STRONG);
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(localStorage.getItem('mg.auth')).toBeNull();
  });

  it('says plainly when the link has expired, was used or isn’t valid', async () => {
    answer(1);
    const { unmount } = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired.');
    expect(screen.getByRole('link', { name: 'Send a new link' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    unmount();

    answer(2);
    const used = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has already been used.');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    used.unmount();

    answer(3);
    const invalid = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('This link isn’t valid.');
    invalid.unmount();

    // A reply in a shape it doesn't know is treated as not valid.
    answer(undefined);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('This link isn’t valid.');
  });

  it('treats a missing token as not valid without asking the server', () => {
    mount('');
    expect(screen.getByRole('alert')).toHaveTextContent('This link isn’t valid.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('offers another try when the link can’t be checked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t check this link.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  });

  it('shows the broken rule, or why the link stopped working, when saving is refused', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn<() => Promise<unknown>>();
    answer(0, confirm);
    mount();
    await user.type(await screen.findByLabelText('New password'), STRONG);
    const save = () => user.click(screen.getByRole('button', { name: 'Save new password' }));

    confirm.mockRejectedValueOnce({ response: { status: 400, data: { code: 'password_rules', message: 'Rules', errors: ['Passwords must have at least one digit'], errorCodes: ['PasswordRequiresDigit'] } } });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Your password needs a number.');

    confirm.mockRejectedValueOnce({ response: { status: 400, data: { code: 'password_required', message: 'Enter a new password.' } } });
    await save();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Enter a new password.'));

    confirm.mockRejectedValueOnce({ response: { status: 400, data: {} } });
    await save();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Choose a password that meets the rules below.'));

    confirm.mockRejectedValueOnce({ response: { status: 429 } });
    await save();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many tries.'));

    confirm.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Password resets from this network are blocked.' } } });
    await save();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Password resets from this network are blocked.'));

    confirm.mockRejectedValueOnce(new Error('offline'));
    await save();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t change your password.'));

    // Typing clears the message.
    await user.type(screen.getByLabelText('New password'), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    confirm.mockRejectedValueOnce({ response: { status: 410, data: { code: 'used', message: 'Used' } } });
    await save();
    expect(await screen.findByText(/This link has already been used\./)).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('moves to the expired or invalid page when the link stops working while the form is open', async () => {
    const user = userEvent.setup();
    answer(0, async () => { throw { response: { status: 410, data: { code: 'expired', message: 'Expired' } } }; });
    const { unmount } = mount();
    await user.type(await screen.findByLabelText('New password'), STRONG);
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/This link has expired\./)).toBeInTheDocument();
    unmount();

    answer(0, async () => { throw { response: { status: 404, data: { code: 'invalid', message: 'Invalid' } } }; });
    mount();
    await user.type(await screen.findByLabelText('New password'), STRONG);
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/This link isn’t valid\./)).toBeInTheDocument();
  });
});
