import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { LoginPage } from './LoginPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const profile = { id: 'u1', email: 'sam@example.com', fullName: 'Sam Lee', clubId: null, clubName: null, roles: ['Member'] };
const signedIn = { data: { token: 'test-token', expiresAt: '2099-01-01T00:00:00Z', user: profile } };

function mount(entry: string | { pathname: string; state: unknown } = '/login') {
  return render(<AuthProvider><MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<p>Sign up page</p>} />
    <Route path="/" element={<p>Home page</p>} />
    <Route path="/teams" element={<p>Teams page</p>} />
  </Routes></MemoryRouter></AuthProvider>);
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: profile });
  vi.mocked(api.post).mockResolvedValue(signedIn);
});

describe('LoginPage', () => {
  it('asks only for an email and password, with no tabs, demo credentials or intro', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument();
    expect(screen.queryByText(/demo credentials|PBKDF2|trainers, organisers and stewards/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MGADMIN/)).not.toBeInTheDocument();
  });

  it('keeps Sign in disabled until both fields are filled', async () => {
    mount();
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.com');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    expect(submit).toBeEnabled();
  });

  it('signs in and goes home', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Email'), ' sam@example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'sam@example.com', password: 'secret' });
  });

  it('returns to the page that asked for a sign in', async () => {
    mount({ pathname: '/login', state: { from: '/teams' } });
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret{Enter}');
    expect(await screen.findByText('Teams page')).toBeInTheDocument();
  });

  it('marks the password field and explains under it when the credentials are wrong, with no banner', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 401, data: { message: 'Invalid email or password.' } } });
    mount();
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const password = screen.getByLabelText('Password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is wrong.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAccessibleDescription('Email or password is wrong.');
    expect(password.parentElement).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByLabelText('Email').parentElement).not.toHaveAttribute('data-invalid', 'true');
    // Typing again clears it.
    await userEvent.type(password, 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so, without blaming the password, when the server cannot be reached', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Network Error'));
    mount();
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign in. Try again.');
  });

  it('links to sign up and closes back to the public view', async () => {
    mount();
    expect(screen.getByText(/New here\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', '/');
    await userEvent.click(screen.getByRole('link', { name: 'Create an account' }));
    expect(screen.getByText('Sign up page')).toBeInTheDocument();
  });

  it('toggles showing and hiding the password', async () => {
    mount();
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  describe('organiser with a shared key', () => {
    it('swaps to title, email and key fields and back, and toggles showing the key', async () => {
      mount();
      await userEvent.click(screen.getByRole('button', { name: 'Organiser with a shared key' }));
      expect(screen.getByRole('heading', { name: 'Organiser sign in' })).toBeInTheDocument();
      expect(screen.getByLabelText('Title or role')).toHaveAttribute('type', 'text');
      expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
      const keyInput = screen.getByLabelText('Organiser key');
      expect(keyInput).toHaveAttribute('type', 'password');
      await userEvent.click(screen.getByRole('button', { name: 'Show organiser key' }));
      expect(keyInput).toHaveAttribute('type', 'text');
      await userEvent.click(screen.getByRole('button', { name: 'Hide organiser key' }));
      expect(keyInput).toHaveAttribute('type', 'password');
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
      expect(screen.queryByText(/New here/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.queryByLabelText('Title or role')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Organiser key')).not.toBeInTheDocument();
    });

    it('signs in with the title, email and key', async () => {
      mount();
      await userEvent.click(screen.getByRole('button', { name: 'Organiser with a shared key' }));
      const submit = screen.getByRole('button', { name: 'Sign in' });
      expect(submit).toBeDisabled();
      await userEvent.type(screen.getByLabelText('Title or role'), ' Chief Steward ');
      expect(submit).toBeDisabled();
      await userEvent.type(screen.getByLabelText('Email'), 'steward@example.com');
      expect(submit).toBeDisabled();
      await userEvent.type(screen.getByLabelText('Organiser key'), 'the-key');
      expect(submit).toBeEnabled();
      await userEvent.click(submit);
      expect(await screen.findByText('Home page')).toBeInTheDocument();
      expect(api.post).toHaveBeenCalledWith('/auth/admin-key', {
        key: 'the-key',
        title: 'Chief Steward',
        email: 'steward@example.com',
      });
    });

    it('explains under the field when the key is refused or the request is invalid', async () => {
      vi.mocked(api.post).mockRejectedValue({ response: { status: 401, data: { message: 'Invalid admin key.' } } });
      mount();
      await userEvent.click(screen.getByRole('button', { name: 'Organiser with a shared key' }));
      await userEvent.type(screen.getByLabelText('Title or role'), 'Chief Steward');
      await userEvent.type(screen.getByLabelText('Email'), 'steward@example.com');
      await userEvent.type(screen.getByLabelText('Organiser key'), 'wrong{Enter}');
      expect(await screen.findByRole('alert')).toHaveTextContent('That key did not work.');
      expect(screen.getByLabelText('Organiser key')).toHaveAttribute('aria-invalid', 'true');
      // A 400 validation error shows the server message.
      vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { message: 'Enter a valid email address.' } } });
      await userEvent.type(screen.getByLabelText('Organiser key'), 'x{Enter}');
      expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
      // Going back clears the message.
      await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
