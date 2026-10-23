import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { EmailConfirmBanner } from './EmailConfirmBanner';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { post: vi.fn() },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const refreshUser = vi.fn();
const person = (emailConfirmed?: boolean) => ({ id: 'u1', email: 'sam@example.com', fullName: 'Sam', clubId: null, clubName: null, roles: ['Member'], emailConfirmed });
const signedInAs = (emailConfirmed?: boolean) => vi.mocked(useAuth).mockReturnValue({ user: person(emailConfirmed), refreshUser } as unknown as ReturnType<typeof useAuth>);

beforeEach(() => {
  refreshUser.mockResolvedValue(undefined);
  vi.mocked(api.post).mockResolvedValue({ data: { status: 'Sent' } });
});

describe('EmailConfirmBanner', () => {
  it('shows nothing for a confirmed person, an older account, or nobody', () => {
    signedInAs(true);
    const { container, rerender } = render(<EmailConfirmBanner />);
    expect(container).toBeEmptyDOMElement();
    signedInAs(undefined);
    rerender(<EmailConfirmBanner />);
    expect(container).toBeEmptyDOMElement();
    vi.mocked(useAuth).mockReturnValue({ user: null, refreshUser } as unknown as ReturnType<typeof useAuth>);
    rerender(<EmailConfirmBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks gently, and resends on request', async () => {
    signedInAs(false);
    render(<EmailConfirmBanner />);
    expect(screen.getByText(/Please confirm your email address/)).toHaveTextContent('sam@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    expect(api.post).toHaveBeenCalledWith('/auth/resend-confirmation');
    expect(await screen.findByRole('status')).toHaveTextContent("We've sent a new link to sam@example.com");
  });

  it('says plainly when the email could not be sent because sending is off', async () => {
    signedInAs(false);
    vi.mocked(api.post).mockResolvedValue({ data: { status: 'NotSent' } });
    render(<EmailConfirmBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    expect(await screen.findByRole('status')).toHaveTextContent("couldn't send the email just now, because email isn't switched on");
  });

  it('says when the provider failed, and when asked too often', async () => {
    signedInAs(false);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { status: 'Failed' } }).mockRejectedValueOnce({ response: { status: 429 } }).mockRejectedValueOnce(new Error('offline'));
    render(<EmailConfirmBanner />);
    const button = screen.getByRole('button', { name: 'Resend email' });
    await userEvent.click(button);
    expect(await screen.findByText(/in a few minutes/)).toBeInTheDocument();
    await userEvent.click(button);
    expect(await screen.findByText(/Wait a minute/)).toBeInTheDocument();
    await userEvent.click(button);
    expect(await screen.findByText(/in a few minutes/)).toBeInTheDocument();
  });

  it('refreshes the profile when the server says it is already confirmed', async () => {
    signedInAs(false);
    vi.mocked(api.post).mockResolvedValue({ data: { status: 'AlreadyConfirmed' } });
    render(<EmailConfirmBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    await vi.waitFor(() => expect(refreshUser).toHaveBeenCalled());
  });

  it('tolerates an odd response', async () => {
    signedInAs(false);
    vi.mocked(api.post).mockResolvedValue({ data: undefined });
    render(<EmailConfirmBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    expect(await screen.findByText(/in a few minutes/)).toBeInTheDocument();
  });
});
