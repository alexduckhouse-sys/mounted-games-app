import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

function mount(search: string, signedIn = false) {
  vi.mocked(useAuth).mockReturnValue({ user: signedIn ? { id: 'u1' } : null, refreshUser } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={[`/confirm-email${search}`]}><ConfirmEmailPage /></MemoryRouter>);
}

beforeEach(() => {
  refreshUser.mockResolvedValue(undefined);
  vi.mocked(api.post).mockResolvedValue({ data: { confirmed: true } });
});

describe('ConfirmEmailPage', () => {
  it('confirms straight from the link, without a sign-in, and offers to sign in', async () => {
    mount('?userId=u1&token=1.abc');
    expect(await screen.findByText(/your email address is confirmed/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/confirm-email', { userId: 'u1', token: '1.abc' });
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(refreshUser).toHaveBeenCalled();
  });

  it('sends a signed-in person to their profile', async () => {
    mount('?userId=u1&token=1.abc', true);
    const profile = await screen.findByRole('link', { name: 'Go to my profile' });
    expect(profile).toHaveAttribute('href', '/me');
    expect(profile).toHaveClass('sp-pill', 'sp-pill-fill');
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
