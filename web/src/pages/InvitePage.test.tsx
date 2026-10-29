import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { InvitePage } from './InvitePage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const profile = { id: 'u1', email: 'new@example.com', fullName: 'Nina New', clubId: null, clubName: null, roles: ['Trainer'] };

function mount(hash = '#t=abc123') {
  window.history.replaceState(null, '', `/invite${hash}`);
  return render(<AuthProvider><MemoryRouter initialEntries={['/invite']}><Routes>
    <Route path="/invite" element={<InvitePage />} />
    <Route path="/" element={<p>Home page</p>} />
  </Routes></MemoryRouter></AuthProvider>);
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: profile });
  vi.mocked(api.post).mockImplementation(async (url: string) => {
    if (url === '/auth/invites/lookup') return { data: { email: 'new@example.com', access: 0, expiresAt: '2099-01-01T00:00:00Z' } };
    return { data: { token: 'jwt', expiresAt: '2099-01-01T00:00:00Z', user: profile } };
  });
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('InvitePage', () => {
  it('reads the token from the fragment, removes it from the address, and asks only for a name and password', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Join Mounted Games' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/invites/lookup', { token: 'abc123' });
    expect(window.location.hash).toBe('');
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.com');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    // The box looks locked: the readonly input sits in a field the stylesheet greys out.
    expect(screen.getByLabelText('Email').closest('.mg-field')!.querySelector('input[readonly]')).not.toBeNull();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  it('creates the account and signs the person in', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText('Your name'), '  Nina New ');
    await user.type(screen.getByLabelText('Password'), 'Passw0rd!x');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/invites/accept', { token: 'abc123', fullName: 'Nina New', password: 'Passw0rd!x' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('mg.auth') ?? '{}').token).toBe('jwt');
  });

  it('shows what is wrong with the password, or why the account could not be made', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText('Your name'), 'Nina');
    await user.type(screen.getByLabelText('Password'), 'Passw0rd!x');
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { errors: ['Passwords must have at least one digit'], errorCodes: ['PasswordRequiresDigit'] } } });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/number|digit/i, { selector: '[role="alert"]' })).toBeInTheDocument();
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 409, data: { detail: 'This invitation has already been used.' } } });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This invitation has already been used.')).toBeInTheDocument();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Couldn’t set up your account. Try again.')).toBeInTheDocument();
  });

  it('shows the API’s answer for a used, cancelled or expired link', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 404, data: { message: 'This invitation has expired or isn’t valid. Ask for a new one.' } } });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('has expired or isn’t valid');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it('uses its own wording when a 404 carries no message, and asks to check the connection when offline', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 404, data: {} } });
    const view = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask for a new one');
    view.unmount();
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection');
  });

  it('does not call the server when the link has no token', async () => {
    mount('');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask for a new one');
    expect(api.post).not.toHaveBeenCalled();
  });
});
