import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { LoginPage } from './LoginPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

function mount(entry = '/forgot-password') {
  return render(<AuthProvider><MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
  </Routes></MemoryRouter></AuthProvider>);
}

const accepted = { data: { message: 'If there’s an account for that address, we’ve sent it a link.' } };

beforeEach(() => {
  vi.mocked(api.post).mockResolvedValue(accepted);
  // The sign-in page asks which social providers are on; none are here.
  vi.mocked(api.get).mockResolvedValue({ data: [] });
});

describe('ForgotPasswordPage', () => {
  it('is linked from the sign-in page', async () => {
    const user = userEvent.setup();
    mount('/login');
    await user.click(screen.getByRole('link', { name: 'Forgot your password?' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('asks for the address, sends it trimmed, and says the same thing whether or not there is an account', async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    mount();
    const send = screen.getByRole('button', { name: 'Send reset link' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Email'), '  sam@example.com ');
    await user.click(send);

    expect(api.post).toHaveBeenCalledWith('/auth/password-reset/request', { email: 'sam@example.com' });
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    finish(accepted);

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('If there’s an account for sam@example.com, we’ve sent it a link to choose a new password. The link works for 30 minutes.');
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');

    // "Try again" goes back to the form, keeping the address.
    await user.click(screen.getByRole('button', { name: 'try again' }));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value.trim()).toBe('sam@example.com');
  });

  it('explains a refusal, the limit and a dropped connection, and clears the message when the address changes', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Email'), 'sam@example');

    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { message: 'Enter the email address you sign in with.' } } });
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the email address you sign in with.');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText('Email'), '.com');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 403, data: {} } });
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the address and try again.');

    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 429 } });
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many tries. Wait a minute and try again.'));

    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t send the link. Check your signal and try again.'));
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();
  });

  it('does nothing until the address has an @', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Email'), 'sam{Enter}');
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
