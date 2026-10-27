import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import {
  OAUTH_STATE_KEY,
  clearSocialProvidersCache,
  setSocialRedirectHandler,
} from '../components/SocialLoginButtons';
import type { ExternalProvider } from '../types';
import { LoginPage } from './LoginPage';
import { SignUpPage } from './SignUpPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const providers: ExternalProvider[] = [
  {
    id: 'google',
    name: 'Google',
    clientId: 'google-client-123',
    authorizeEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
  },
  {
    id: 'apple',
    name: 'Apple',
    clientId: 'apple.client.id',
    authorizeEndpoint: 'https://appleid.apple.com/auth/authorize',
    scope: 'openid email name',
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    clientId: 'ms-client-456',
    authorizeEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    scope: 'openid email profile',
  },
  {
    id: 'oidc',
    name: 'Pony Club SSO',
    clientId: 'oidc-client-789',
    authorizeEndpoint: 'https://sso.example.org/authorize',
    scope: 'openid email profile',
    responseMode: 'fragment',
  },
];

const clubs = [
  { id: 1, name: 'Stockport Pony Club' },
  { id: 2, name: 'Warwickshire Hunt' },
];

const profile = {
  id: 'u1',
  email: 'alex@example.com',
  fullName: 'Alex Rider',
  clubId: 1,
  clubName: 'Stockport Pony Club',
  roles: ['Member'],
  emailConfirmed: true,
};

function mount(entry: string | { pathname: string; hash?: string; state?: unknown } = '/login') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/teams" element={<p>Teams page</p>} />
          <Route path="/events" element={<p>Events page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  clearSocialProvidersCache();
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/auth/providers') return { data: providers };
    if (url === '/clubs') return { data: clubs };
    return { data: profile };
  });
});

afterEach(() => {
  clearSocialProvidersCache();
});

describe('External social login & onboarding', () => {
  it('renders configured provider buttons on /login, caches them, and hides them in organiser-key mode', async () => {
    const user = userEvent.setup();
    mount('/login');

    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Microsoft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Pony Club SSO' })).toBeInTheDocument();

    // Swapping to organiser key hides social login buttons
    await user.click(screen.getByRole('button', { name: 'Organiser with a shared key' }));
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();

    // Swapping back uses cached providers immediately
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('stores state and nonce in sessionStorage and redirects to the provider authorizeEndpoint', async () => {
    const user = userEvent.setup();
    let redirectedTo = '';
    setSocialRedirectHandler((url) => { redirectedTo = url; });

    mount('/login');
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    expect(redirectedTo).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
    const parsed = new URL(redirectedTo);
    expect(parsed.searchParams.get('client_id')).toBe('google-client-123');
    expect(parsed.searchParams.get('response_type')).toBe('id_token');
    expect(parsed.searchParams.get('response_mode')).toBe('fragment');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');

    const stored = JSON.parse(sessionStorage.getItem(OAUTH_STATE_KEY) ?? '{}');
    expect(stored.provider).toBe('google');
    expect(stored.state).toBe(parsed.searchParams.get('state'));
    expect(stored.nonce).toBe(parsed.searchParams.get('nonce'));
  });

  it('signs in an existing external user from the #id_token callback and navigates to the destination', async () => {
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ provider: 'google', state: 'st-ok', nonce: 'n-ok' }));
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        needsSignup: false,
        auth: { token: 'jwt-ext', expiresAt: '2099-01-01T00:00:00Z', user: profile },
      },
    });

    mount({ pathname: '/login', hash: '#id_token=google-jwt&state=st-ok', state: { from: '/teams' } });

    expect(await screen.findByText('Teams page')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/external', {
      provider: 'google',
      idToken: 'google-jwt',
      nonce: 'n-ok',
    });
  });

  it('prompts a new external user for their club and role on /login, then finishes creating the account', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ provider: 'google', state: 'st-new', nonce: 'n-new' }));
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: {
          needsSignup: true,
          auth: null,
          email: 'alex@example.com',
          suggestedName: 'Alex Rider',
          provider: 'google',
        },
      })
      .mockResolvedValueOnce({
        data: {
          needsSignup: false,
          auth: { token: 'jwt-created', expiresAt: '2099-01-01T00:00:00Z', user: profile },
        },
      });

    mount({ pathname: '/login', hash: '#id_token=new-google-jwt&state=st-new' });

    expect(await screen.findByRole('heading', { name: 'Finish creating your account' })).toBeInTheDocument();
    expect(screen.getByText('alex@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveValue('Alex Rider');

    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();

    // Pick a club from suggestions and choose role
    await user.type(screen.getByLabelText('Club / team name'), 'Stoc');
    const suggestions = within(await screen.findByRole('group', { name: 'Club suggestions' }));
    await user.click(suggestions.getByRole('button', { name: 'Stockport Pony Club' }));
    await user.click(screen.getByRole('radio', { name: 'Trainer' }));
    expect(screen.getByText("Approved by Stockport Pony Club's team manager.")).toBeInTheDocument();
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/auth/external', {
      provider: 'google',
      idToken: 'new-google-jwt',
      nonce: 'n-new',
      fullName: 'Alex Rider',
      clubName: 'Stockport Pony Club',
      role: 'Trainer',
    });
  });

  it('allows adding a custom club, shows errors on onboarding failure, and lets the user cancel back to sign in', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ provider: 'apple', state: 'st-a', nonce: 'n-a' }));
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: {
          needsSignup: true,
          auth: null,
          email: 'sam@example.com',
          suggestedName: 'Sam',
          provider: 'apple',
        },
      })
      .mockRejectedValueOnce({
        response: { status: 429, data: { message: 'Maximum registered accounts reached.' } },
      });

    mount({ pathname: '/login', hash: '#id_token=apple-jwt&state=st-a' });
    expect(await screen.findByRole('heading', { name: 'Finish creating your account' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Your name'));
    await user.type(screen.getByLabelText('Your name'), 'Sam Taylor');
    await user.type(screen.getByLabelText('Club / team name'), 'New Valley MG');
    await user.click(screen.getByRole('button', { name: 'Add "New Valley MG"' }));
    await user.click(screen.getByRole('radio', { name: 'Team manager' }));
    expect(screen.getByText('Approved by Mounted Games admins.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Maximum registered accounts reached.');

    // Cancel returns to the normal sign-in form
    await user.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('completes external onboarding on /signup and shows the approval request confirmation', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ provider: 'microsoft', state: 'st-ms', nonce: 'n-ms' }));
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: {
          needsSignup: true,
          auth: null,
          email: 'coach@example.com',
          suggestedName: 'Jamie Coach',
          provider: 'microsoft',
        },
      })
      .mockResolvedValueOnce({
        data: {
          needsSignup: false,
          auth: { token: 'jwt-ms', expiresAt: '2099-01-01T00:00:00Z', user: profile },
        },
      });

    mount({ pathname: '/signup', hash: '#id_token=ms-jwt&state=st-ms' });
    expect(await screen.findByRole('heading', { name: 'Finish creating your account' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Club / team name'), 'Warwickshire Hunt');
    await user.click(await screen.findByRole('button', { name: 'Warwickshire Hunt' }));
    await user.click(screen.getByRole('radio', { name: 'Rider or parent' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Request sent to Warwickshire Hunt' })).toBeInTheDocument();
  });

  it('reports provider cancellation, state mismatch, and token verification errors cleanly', async () => {
    // 1. Provider returned #error=access_denied
    const first = mount({ pathname: '/login', hash: '#error=access_denied' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in was cancelled or refused by the provider.');
    first.unmount();

    // 2. State mismatch
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ provider: 'google', state: 'expected-st', nonce: 'n' }));
    const second = mount({ pathname: '/login', hash: '#id_token=tok&state=wrong-st' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not verify that sign-in. Try again.');
    second.unmount();

    // 3. Backend rejects token on /signup
    sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ provider: 'google', state: 'ok-st', nonce: 'n' }));
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { status: 401, data: { message: 'Confirm your email address with your sign-in provider first.' } },
    });
    const third = mount({ pathname: '/signup', hash: '#id_token=unverified-tok&state=ok-st' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirm your email address with your sign-in provider first.');
    third.unmount();

    // 4. Unrelated hash and failed /auth/providers fetch are ignored gracefully
    clearSocialProvidersCache();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    mount({ pathname: '/login', hash: '#unrelated=1' });
    expect(screen.queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument();
  });
});
