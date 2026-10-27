import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { loadApple, loadGoogle, makeNonce, randomState, type AppleAuthApi, type GoogleCredentialResponse, type GoogleIdApi } from '../auth/socialSdk';
import { clearSocialProvidersCache } from '../components/SocialLoginButtons';
import type { ExternalProvider } from '../types';
import { LoginPage } from './LoginPage';
import { SignUpPage } from './SignUpPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../auth/socialSdk', () => ({
  loadGoogle: vi.fn(),
  loadApple: vi.fn(),
  makeNonce: vi.fn(),
  randomState: vi.fn(),
}));

const providers: ExternalProvider[] = [
  { id: 'google', name: 'Google', clientId: 'web-client.apps.googleusercontent.com' },
  { id: 'apple', name: 'Apple', clientId: 'uk.example.web' },
];
const clubs = [
  { id: 1, name: 'Stockport Pony Club' },
  { id: 2, name: 'Warwickshire Hunt' },
];
const profile = {
  id: 'u1',
  email: 'alex@gmail.com',
  fullName: 'Alex Rider',
  clubId: 1,
  clubName: 'Stockport Pony Club',
  roles: ['Member'],
  emailConfirmed: true,
};
const signedIn = (token: string) => ({ data: { needsSignup: false, auth: { token, expiresAt: '2099-01-01T00:00:00Z', user: profile } } });
/** The reply to `POST /auth/external/signup`: a plain session. */
const created = (token: string, emailConfirmed = true) => ({ data: { token, expiresAt: '2099-01-01T00:00:00Z', user: { ...profile, emailConfirmed } } });
const needsSignup = (email: string, suggestedName: string, provider: string) =>
  ({ data: { needsSignup: true, auth: null, email, suggestedName, provider, signupTicket: `ticket-${provider}` } });

const google = { initialize: vi.fn(), renderButton: vi.fn() } satisfies GoogleIdApi;
const apple = { init: vi.fn(), signIn: vi.fn() } satisfies AppleAuthApi;
const post = vi.mocked(api.post);

function mount(entry: string | { pathname: string; state?: unknown } = '/login') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/teams" element={<p>Teams page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** Plays Google: waits for its button, then calls the callback as its pop-up would. */
async function googleReturns(credential: string) {
  await waitFor(() => expect(google.initialize).toHaveBeenCalled());
  const callback = google.initialize.mock.calls.at(-1)![0].callback as (r: GoogleCredentialResponse) => void;
  await act(async () => { callback({ credential, select_by: 'btn' }); });
}

beforeEach(() => {
  clearSocialProvidersCache();
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/auth/providers') return { data: providers };
    if (url === '/clubs') return { data: clubs };
    return { data: profile };
  });
  vi.mocked(loadGoogle).mockResolvedValue(google);
  vi.mocked(loadApple).mockResolvedValue(apple);
  vi.mocked(makeNonce).mockResolvedValue({ raw: 'raw-nonce', hashed: 'hashed-nonce' });
  vi.mocked(randomState).mockReturnValue('state-1');
});

afterEach(() => clearSocialProvidersCache());

describe('Sign in with Google or Apple', () => {
  it('shows both buttons on sign in and sign up, but not for the organiser key', async () => {
    const user = userEvent.setup();
    const view = mount('/login');
    expect(await screen.findByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
    expect(screen.getByTestId('google-signin')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Organiser with a shared key' }));
    expect(screen.queryByRole('button', { name: 'Sign in with Apple' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-signin')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
    view.unmount();

    mount('/signup');
    expect(await screen.findByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
  });

  it('signs in an existing account with the token and raw nonce, then goes where they were heading', async () => {
    post.mockResolvedValueOnce(signedIn('jwt-google'));
    mount({ pathname: '/login', state: { from: '/teams' } });

    await googleReturns('google-id-token');

    expect(await screen.findByText('Teams page')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/auth/external', { provider: 'google', idToken: 'google-id-token', nonce: 'raw-nonce' });
  });

  it('asks a new person for their club and role, then makes the account with the sign-up ticket', async () => {
    const user = userEvent.setup();
    post
      .mockResolvedValueOnce(needsSignup('alex@gmail.com', 'Alex Rider', 'google'))
      .mockResolvedValueOnce(created('jwt-created'));
    mount('/login');

    await googleReturns('new-google-token');
    expect(await screen.findByRole('heading', { name: 'Finish creating your account' })).toBeInTheDocument();
    expect(screen.getByText('alex@gmail.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveValue('Alex Rider');

    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Club / team name'), 'Stoc');
    await user.click(within(await screen.findByRole('group', { name: 'Club suggestions' })).getByRole('button', { name: 'Stockport Pony Club' }));
    await user.click(screen.getByRole('radio', { name: 'Trainer' }));
    expect(screen.getByText("Approved by Stockport Pony Club's team manager.")).toBeInTheDocument();
    await user.click(submit);

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    // The token was spent on the first call; the ticket finishes the account.
    expect(post).toHaveBeenLastCalledWith('/auth/external/signup', {
      ticket: 'ticket-google',
      fullName: 'Alex Rider',
      clubName: 'Stockport Pony Club',
      role: 'Trainer',
    });
  });

  it('carries Apple’s first-sign-in name into the form on sign up, and says an email went out when one did', async () => {
    const user = userEvent.setup();
    apple.signIn.mockResolvedValueOnce({
      authorization: { id_token: 'apple-id-token', state: 'state-1' },
      user: { email: 'x7@privaterelay.appleid.com', name: { firstName: 'Sam', lastName: 'Taylor' } },
    });
    post
      .mockResolvedValueOnce(needsSignup('x7@privaterelay.appleid.com', 'Sam Taylor', 'apple'))
      .mockResolvedValueOnce(created('jwt-apple', false));
    mount('/signup');

    const button = await screen.findByRole('button', { name: 'Sign in with Apple' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(post).toHaveBeenCalledWith('/auth/external', { provider: 'apple', idToken: 'apple-id-token', nonce: 'raw-nonce', providerName: 'Sam Taylor' });

    expect(await screen.findByLabelText('Your name')).toHaveValue('Sam Taylor');
    await user.type(screen.getByLabelText('Club / team name'), 'New Valley MG');
    await user.click(screen.getByRole('button', { name: 'Add "New Valley MG"' }));
    await user.click(screen.getByRole('radio', { name: 'Team manager' }));
    expect(screen.getByText('Approved by Mounted Games admins.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Request sent to New Valley MG' })).toBeInTheDocument();
    // A hidden Apple address starts unconfirmed, so the confirmation email went out.
    expect(screen.getByText(/emailed you a link/)).toBeInTheDocument();
    expect(post).toHaveBeenLastCalledWith('/auth/external/signup', {
      ticket: 'ticket-apple',
      fullName: 'Sam Taylor',
      clubName: 'New Valley MG',
      role: 'Manager',
    });
  });

  it('asks for an email address when the provider gave none, then makes the account with it', async () => {
    const user = userEvent.setup();
    post.mockResolvedValueOnce(needsSignup('', 'Sam Rider', 'facebook')).mockResolvedValueOnce(created('jwt-fb', false));
    mount('/login');

    await googleReturns('provider-token');
    await screen.findByRole('heading', { name: 'Finish creating your account' });
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Club / team name'), 'Warwickshire Hunt');
    await user.click(await screen.findByRole('button', { name: 'Warwickshire Hunt' }));
    await user.click(screen.getByRole('radio', { name: 'Rider or parent' }));
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Email'), 'sam@example.org');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(post).toHaveBeenLastCalledWith('/auth/external/signup', {
      ticket: 'ticket-facebook', fullName: 'Sam Rider', clubName: 'Warwickshire Hunt', role: 'Member', email: 'sam@example.org',
    });
  });

  it('shows the API’s reason when a sign-in is refused, and a signal message when there is no reply', async () => {
    post.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Admins need to sign in with their email and password, not Google or Apple.', code: 'admin_password_only' } } });
    const first = mount('/login');
    await googleReturns('admin-token');
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins need to sign in with their email and password');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    first.unmount();

    google.initialize.mockClear();
    post.mockRejectedValueOnce(new Error('Network Error'));
    mount('/signup');
    await googleReturns('any-token');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t sign in. Check your signal and try again.');
  });

  it('shows a provider’s own failure, and lets a new person back out of finishing the account', async () => {
    const user = userEvent.setup();
    post
      .mockResolvedValueOnce(needsSignup('sam@gmail.com', 'Sam', 'google'))
      .mockRejectedValueOnce({ response: { status: 429, data: {} } });
    mount('/login');

    await waitFor(() => expect(google.initialize).toHaveBeenCalled());
    const callback = google.initialize.mock.calls.at(-1)![0].callback as (r: GoogleCredentialResponse) => void;
    act(() => callback({}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in didn’t work');

    await googleReturns('google-token');
    await screen.findByRole('heading', { name: 'Finish creating your account' });
    await user.type(screen.getByLabelText('Club / team name'), 'Warwickshire Hunt');
    await user.click(await screen.findByRole('button', { name: 'Warwickshire Hunt' }));
    await user.click(screen.getByRole('radio', { name: 'Rider or parent' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Wait a minute and try again.');

    await user.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lets a new person on sign up back out to the sign-up form, and signs an existing one straight in', async () => {
    const user = userEvent.setup();
    post
      .mockResolvedValueOnce(needsSignup('sam@gmail.com', 'Sam', 'google'))
      .mockResolvedValueOnce(signedIn('jwt-existing'));
    mount({ pathname: '/signup', state: { from: '/teams' } });

    await googleReturns('google-token');
    await screen.findByRole('heading', { name: 'Finish creating your account' });
    await user.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();

    await googleReturns('existing-token');
    expect(await screen.findByText('Teams page')).toBeInTheDocument();
  });
});
