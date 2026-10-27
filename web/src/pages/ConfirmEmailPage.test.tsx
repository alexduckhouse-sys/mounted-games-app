import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { ConfirmEmailPage } from './ConfirmEmailPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { post: vi.fn() },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const refreshUser = vi.fn();
const logout = vi.fn();

/** Shows where the sign-in page would send the person back to. */
function SignInPage() {
  const from = (useLocation().state as { from?: string } | null)?.from;
  return <p>Sign in page, then back to {from}</p>;
}

function mount(search: string, signedInAs: string | null = 'u1') {
  vi.mocked(useAuth).mockReturnValue({ user: signedInAs ? { id: signedInAs } : null, refreshUser, logout } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={[`/confirm-email${search}`]}><Routes>
    <Route path="/confirm-email" element={<ConfirmEmailPage />} />
    <Route path="/login" element={<SignInPage />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  refreshUser.mockResolvedValue(undefined);
  vi.mocked(api.post).mockResolvedValue({ data: { confirmed: true } });
});

describe('ConfirmEmailPage', () => {
  it('confirms for the person signed in to the account the link is for', async () => {
    mount('?userId=u1&token=1.abc');
    expect(await screen.findByText(/your email address is confirmed/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/confirm-email', { userId: 'u1', token: '1.abc' });
    const profile = screen.getByRole('link', { name: 'Go to my profile' });
    expect(profile).toHaveAttribute('href', '/me');
    expect(profile).toHaveClass('sp-pill', 'sp-pill-fill');
    expect(refreshUser).toHaveBeenCalled();
  });

  it('asks a signed-out person to sign in first, and keeps the link for when they come back', async () => {
    const user = userEvent.setup();
    mount('?userId=u1&token=1.abc', null);
    expect(screen.getByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
    expect(screen.getByText(/Sign in to the account this email was sent to/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Sign in to confirm' }));
    expect(screen.getByText('Sign in page, then back to /confirm-email?userId=u1&token=1.abc')).toBeInTheDocument();
  });

  it('won’t confirm for a different account, and offers to sign out', async () => {
    const user = userEvent.setup();
    mount('?userId=u1&token=1.abc', 'someone-else');
    expect(screen.getByRole('alert')).toHaveTextContent('This link is for another account');
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });

  it('does not call the server when the link is incomplete', () => {
    mount('?userId=u1');
    expect(screen.getByRole('alert')).toHaveTextContent(/incomplete/);
    expect(screen.getByRole('link', { name: 'Back to the app' })).toHaveAttribute('href', '/');
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the server's message for a bad or expired link, and points to the resend button", async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { message: 'This confirmation link has expired or isn\'t valid.' } } });
    mount('?userId=u1&token=old');
    expect(await screen.findByRole('alert')).toHaveTextContent("expired or isn't valid");
    expect(screen.getByText(/Send it again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('sp-pill-fill');
    const back = screen.getByRole('link', { name: 'Back to the app' });
    expect(back).toHaveClass('sp-pill');
    expect(back).not.toHaveClass('sp-pill-fill');
  });

  it('offers a retry when the connection drops', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    mount('?userId=u1&token=1.abc');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Check your signal/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/confirmed/));
  });
});
