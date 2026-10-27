import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { AppleAuthApi, AppleSignInResponse, FacebookApi, GoogleCredentialResponse, GoogleIdApi } from '../auth/socialSdk';
import { loadApple, loadFacebook, loadGoogle, makeNonce, randomState } from '../auth/socialSdk';
import { en } from '../i18n/en';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/translate';
import { SocialLoginButtons, clearSocialProvidersCache } from './SocialLoginButtons';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../auth/socialSdk', () => ({
  FACEBOOK_GRAPH_VERSION: 'v23.0',
  loadGoogle: vi.fn(),
  loadApple: vi.fn(),
  loadFacebook: vi.fn(),
  makeNonce: vi.fn(),
  randomState: vi.fn(),
}));

const get = vi.mocked(api.get);
const google = { initialize: vi.fn(), renderButton: vi.fn() } satisfies GoogleIdApi;
const apple = { init: vi.fn(), signIn: vi.fn() } satisfies AppleAuthApi;
const both = [
  { id: 'google', name: 'Google', clientId: 'web-client.apps.googleusercontent.com' },
  { id: 'apple', name: 'Apple', clientId: 'uk.example.web' },
];

function setUp(providers: unknown = both) {
  get.mockResolvedValue({ data: providers });
  vi.mocked(loadGoogle).mockResolvedValue(google);
  vi.mocked(loadApple).mockResolvedValue(apple);
  vi.mocked(makeNonce).mockResolvedValue({ raw: 'raw-nonce', hashed: 'hashed-nonce' });
  vi.mocked(randomState).mockReturnValue('state-1');
}

function mount(props: Partial<Parameters<typeof SocialLoginButtons>[0]> = {}) {
  const onCredential = vi.fn();
  const onError = vi.fn();
  const view = render(<SocialLoginButtons onCredential={onCredential} onError={onError} {...props} />);
  return { ...view, onCredential, onError };
}

/** The callback Google would call after its pop-up. */
const googleCallback = () => google.initialize.mock.calls.at(-1)![0].callback as (r: GoogleCredentialResponse) => void;

beforeEach(() => {
  clearSocialProvidersCache();
  setUp();
});

afterEach(() => clearSocialProvidersCache());

describe('which buttons show', () => {
  it('shows nothing when no provider is switched on, the list is odd, or it can’t be fetched', async () => {
    for (const reply of [[], { not: 'a list' }, [{ id: 'microsoft', name: 'Microsoft', clientId: 'x' }, { id: 'google', name: 'Google', clientId: '' }]]) {
      clearSocialProvidersCache();
      get.mockResolvedValueOnce({ data: reply });
      const { container, unmount } = mount();
      await waitFor(() => expect(get).toHaveBeenCalled());
      await act(async () => { await Promise.resolve(); });
      expect(container).toBeEmptyDOMElement();
      unmount();
      get.mockClear();
    }
    clearSocialProvidersCache();
    get.mockRejectedValueOnce(new Error('offline'));
    const { container } = mount();
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
    expect(loadGoogle).not.toHaveBeenCalled();
  });

  it('shows Google’s and Apple’s buttons, then “or”, and remembers the list', async () => {
    const first = mount();
    expect(await screen.findByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
    expect(screen.getByTestId('google-signin')).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
    first.unmount();

    mount();
    expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('asks for the list once even when two buttons sets mount together', async () => {
    mount();
    mount();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Sign in with Apple' })).toHaveLength(2));
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('choosing which buttons, the wording and the “or”', () => {
  it('shows only the providers asked for, and nothing when none of them is on', async () => {
    const appleOnly = mount({ only: ['apple'] });
    expect(await screen.findByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
    expect(screen.queryByTestId('google-signin')).not.toBeInTheDocument();
    appleOnly.unmount();

    get.mockResolvedValue({ data: [both[0]] });
    clearSocialProvidersCache();
    const { container } = mount({ only: ['apple'] });
    await waitFor(() => expect(get).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
  });

  it('says “Continue with …” for adding a provider, and can leave out the “or”', async () => {
    mount({ label: 'continue', divider: false });
    expect(await screen.findByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();
    await waitFor(() => expect(google.renderButton).toHaveBeenCalled());
    expect(google.renderButton.mock.calls[0][1]).toEqual(expect.objectContaining({ text: 'continue_with' }));
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });
});

describe('Sign in with Google', () => {
  beforeEach(() => get.mockResolvedValue({ data: [both[0]] }));

  it('sets up Google’s own button with the hashed nonce and hands back the token with the raw one', async () => {
    const { onCredential, onError } = mount();
    await waitFor(() => expect(google.renderButton).toHaveBeenCalled());

    expect(google.initialize).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'web-client.apps.googleusercontent.com',
      nonce: 'hashed-nonce',
      ux_mode: 'popup',
      auto_select: false,
      context: 'signin',
    }));
    const [slot, options] = google.renderButton.mock.calls[0];
    expect(slot).toBe(screen.getByTestId('google-signin'));
    // jsdom has no layout, so the default width is used.
    expect(options).toEqual(expect.objectContaining({ text: 'signin_with', theme: 'outline', size: 'large', width: 320, locale: 'en-GB' }));

    act(() => googleCallback()({ credential: 'google-id-token', select_by: 'btn' }));
    expect(onCredential).toHaveBeenCalledWith({ provider: 'google', idToken: 'google-id-token', nonce: 'raw-nonce' });

    act(() => googleCallback()({}));
    expect(onError).toHaveBeenCalledWith(en['auth.social.googleFailed']);
  });

  it('keeps the button between 200 and 400 pixels wide', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    rect.mockReturnValue({ width: 900 } as DOMRect);
    const wide = mount();
    await waitFor(() => expect(google.renderButton).toHaveBeenCalledTimes(1));
    expect(google.renderButton.mock.calls[0][1].width).toBe(400);
    wide.unmount();

    rect.mockReturnValue({ width: 120 } as DOMRect);
    mount();
    await waitFor(() => expect(google.renderButton).toHaveBeenCalledTimes(2));
    expect(google.renderButton.mock.calls[1][1].width).toBe(200);
  });

  it('covers the button while a sign-in is under way', async () => {
    const { rerender, onCredential, onError } = mount({ disabled: true });
    await waitFor(() => expect(google.renderButton).toHaveBeenCalled());
    expect(screen.getByTestId('google-signin-cover')).toBeInTheDocument();
    rerender(<SocialLoginButtons onCredential={onCredential} onError={onError} />);
    expect(screen.queryByTestId('google-signin-cover')).not.toBeInTheDocument();
  });

  it('says so when Google’s script can’t load', async () => {
    vi.mocked(loadGoogle).mockRejectedValue(new Error('blocked'));
    mount();
    expect(await screen.findByRole('status')).toHaveTextContent(en['auth.social.googleUnavailable']);
  });

  it('does nothing if the page has gone before Google is ready, or after', async () => {
    let finishLoading!: (api: GoogleIdApi) => void;
    vi.mocked(loadGoogle).mockReturnValue(new Promise((resolve) => { finishLoading = resolve; }));
    const early = mount();
    await waitFor(() => expect(loadGoogle).toHaveBeenCalled());
    early.unmount();
    await act(async () => { finishLoading(google); await Promise.resolve(); });
    expect(google.initialize).not.toHaveBeenCalled();

    vi.mocked(loadGoogle).mockResolvedValue(google);
    const late = mount();
    await waitFor(() => expect(google.initialize).toHaveBeenCalled());
    late.unmount();
    googleCallback()({ credential: 'too-late' });
    expect(late.onCredential).not.toHaveBeenCalled();

    let failLoading!: (reason: Error) => void;
    vi.mocked(loadGoogle).mockReturnValue(new Promise((_, reject) => { failLoading = reject; }));
    const failedLate = mount();
    await waitFor(() => expect(loadGoogle).toHaveBeenCalledTimes(3));
    failedLate.unmount();
    await act(async () => { failLoading(new Error('blocked')); await Promise.resolve(); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Continue with Facebook', () => {
  const facebook = { init: vi.fn(), login: vi.fn() } satisfies FacebookApi;
  const facebookProvider = { id: 'facebook', name: 'Facebook', clientId: '1234567890123456' };

  beforeEach(() => {
    get.mockResolvedValue({ data: [facebookProvider] });
    vi.mocked(loadFacebook).mockResolvedValue(facebook);
  });

  async function ready() {
    const view = mount();
    const button = await screen.findByRole('button', { name: 'Continue with Facebook' });
    await waitFor(() => expect(button).toBeEnabled());
    return { ...view, button };
  }

  it('sets up Facebook’s SDK for the pop-up alone, then hands back the access token from a tap', async () => {
    const user = userEvent.setup();
    const { button, onCredential, onError } = await ready();
    expect(facebook.init).toHaveBeenCalledWith({
      appId: '1234567890123456', version: 'v23.0', cookie: false, xfbml: false, status: false, localStorage: false, fedCM: false,
    });

    facebook.login.mockImplementationOnce((callback) => callback({ status: 'connected', authResponse: { accessToken: 'EAAT-token', userID: '1' } }));
    await user.click(button);
    expect(facebook.login).toHaveBeenCalledWith(expect.any(Function), { scope: 'public_profile,email' });
    expect(onCredential).toHaveBeenCalledWith({ provider: 'facebook', idToken: 'EAAT-token' });

    // Closing Facebook's window, or saying no, is a change of mind.
    facebook.login.mockImplementationOnce((callback) => callback({ status: 'unknown', authResponse: null }));
    await user.click(button);
    expect(onCredential).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('is disabled while loading or while a sign-in is under way', async () => {
    let finishLoading!: (api: FacebookApi) => void;
    vi.mocked(loadFacebook).mockReturnValue(new Promise((resolve) => { finishLoading = resolve; }));
    const { rerender, onCredential, onError } = mount();
    const button = await screen.findByRole('button', { name: 'Continue with Facebook' });
    expect(button).toBeDisabled();
    await act(async () => { finishLoading(facebook); });
    expect(button).toBeEnabled();
    rerender(<SocialLoginButtons onCredential={onCredential} onError={onError} disabled />);
    expect(button).toBeDisabled();
  });

  it('says so when Facebook’s SDK can’t load, and does nothing if the page has gone first', async () => {
    vi.mocked(loadFacebook).mockRejectedValue(new Error('blocked'));
    const failed = mount();
    expect(await screen.findByRole('status')).toHaveTextContent(en['auth.social.facebookUnavailable']);
    failed.unmount();

    let finishLoading!: (api: FacebookApi) => void;
    vi.mocked(loadFacebook).mockReturnValue(new Promise((resolve) => { finishLoading = resolve; }));
    const early = mount();
    await screen.findByRole('button', { name: 'Continue with Facebook' });
    early.unmount();
    await act(async () => { finishLoading(facebook); });
    expect(facebook.init).not.toHaveBeenCalled();

    let failLoading!: (reason: Error) => void;
    vi.mocked(loadFacebook).mockReturnValue(new Promise((_, reject) => { failLoading = reject; }));
    const failedLate = mount();
    await screen.findByRole('button', { name: 'Continue with Facebook' });
    failedLate.unmount();
    await act(async () => { failLoading(new Error('blocked')); await Promise.resolve(); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Sign in with Apple', () => {
  beforeEach(() => get.mockResolvedValue({ data: [both[1]] }));

  const reply = (overrides: Partial<AppleSignInResponse> = {}): AppleSignInResponse => ({
    authorization: { id_token: 'apple-id-token', code: 'code', state: 'state-1' },
    ...overrides,
  });

  async function ready() {
    const view = mount();
    const button = await screen.findByRole('button', { name: 'Sign in with Apple' });
    await waitFor(() => expect(button).toBeEnabled());
    return { ...view, button };
  }

  it('sets up Apple’s pop-up with the hashed nonce, a state and the sign-in page as the return address', async () => {
    await ready();
    expect(apple.init).toHaveBeenCalledWith({
      clientId: 'uk.example.web',
      scope: 'name email',
      redirectURI: `${window.location.origin}/login`,
      state: 'state-1',
      nonce: 'hashed-nonce',
      usePopup: true,
    });
  });

  it('hands back the token, the raw nonce and, the first time, the name', async () => {
    const user = userEvent.setup();
    const { button, onCredential } = await ready();

    apple.signIn.mockResolvedValueOnce(reply({ user: { email: 'x@privaterelay.appleid.com', name: { firstName: ' Sam ', lastName: 'Taylor' } } }));
    await user.click(button);
    expect(onCredential).toHaveBeenLastCalledWith({ provider: 'apple', idToken: 'apple-id-token', nonce: 'raw-nonce', providerName: 'Sam Taylor' });

    apple.signIn.mockResolvedValueOnce(reply());
    await user.click(button);
    expect(onCredential).toHaveBeenLastCalledWith({ provider: 'apple', idToken: 'apple-id-token', nonce: 'raw-nonce' });
  });

  it('ignores a reply from another attempt or without a token', async () => {
    const user = userEvent.setup();
    const { button, onCredential, onError } = await ready();

    apple.signIn.mockResolvedValueOnce(reply({ authorization: { id_token: 'apple-id-token', state: 'someone-else' } }));
    await user.click(button);
    apple.signIn.mockResolvedValueOnce(reply({ authorization: { state: 'state-1' } }));
    await user.click(button);

    expect(onCredential).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(en['auth.social.notChecked']);
  });

  it('stays quiet when the person closes Apple’s window, and says so when Apple fails', async () => {
    const user = userEvent.setup();
    const { button, onError } = await ready();

    for (const error of ['popup_closed_by_user', 'user_cancelled_authorize']) {
      apple.signIn.mockRejectedValueOnce({ error });
      await user.click(button);
    }
    expect(onError).not.toHaveBeenCalled();

    apple.signIn.mockRejectedValueOnce({ error: 'popup_blocked_by_browser' });
    await user.click(button);
    apple.signIn.mockRejectedValueOnce(undefined);
    await user.click(button);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(en['auth.social.appleFailed']);
  });

  it('is disabled while loading or while a sign-in is under way', async () => {
    let finishLoading!: (api: AppleAuthApi) => void;
    vi.mocked(loadApple).mockReturnValue(new Promise((resolve) => { finishLoading = resolve; }));
    const { rerender, onCredential, onError } = mount();
    const button = await screen.findByRole('button', { name: 'Sign in with Apple' });
    expect(button).toBeDisabled();
    await act(async () => { finishLoading(apple); });
    expect(button).toBeEnabled();
    rerender(<SocialLoginButtons onCredential={onCredential} onError={onError} disabled />);
    expect(button).toBeDisabled();
  });

  it('says so when Apple’s script can’t load, and does nothing if the page has gone first', async () => {
    vi.mocked(loadApple).mockRejectedValue(new Error('blocked'));
    const failed = mount();
    expect(await screen.findByRole('status')).toHaveTextContent(en['auth.social.appleUnavailable']);
    failed.unmount();

    let finishLoading!: (api: AppleAuthApi) => void;
    vi.mocked(loadApple).mockReturnValue(new Promise((resolve) => { finishLoading = resolve; }));
    const early = mount();
    await screen.findByRole('button', { name: 'Sign in with Apple' });
    early.unmount();
    await act(async () => { finishLoading(apple); });
    expect(apple.init).not.toHaveBeenCalled();

    let failLoading!: (reason: Error) => void;
    vi.mocked(loadApple).mockReturnValue(new Promise((_, reject) => { failLoading = reject; }));
    const failedLate = mount();
    await screen.findByRole('button', { name: 'Sign in with Apple' });
    failedLate.unmount();
    await act(async () => { failLoading(new Error('blocked')); await Promise.resolve(); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('in Welsh and French', () => {
  const facebookProvider = { id: 'facebook', name: 'Facebook', clientId: '1234567890123456' };

  function mountIn(lang: Lang, props: Partial<Parameters<typeof SocialLoginButtons>[0]> = {}) {
    return render(
      <LanguageProvider initial={lang}>
        <SocialLoginButtons onCredential={vi.fn()} onError={vi.fn()} {...props} />
      </LanguageProvider>,
    );
  }

  beforeEach(() => {
    get.mockResolvedValue({ data: [...both, facebookProvider] });
    vi.mocked(loadFacebook).mockResolvedValue({ init: vi.fn(), login: vi.fn() });
  });

  it('asks Google to word its button in the chosen language', async () => {
    for (const [lang, locale] of [['cy', 'cy'], ['fr', 'fr']] as const) {
      google.renderButton.mockClear();
      const { unmount } = mountIn(lang);
      await waitFor(() => expect(google.renderButton).toHaveBeenCalled());
      expect(google.renderButton.mock.calls[0][1]).toEqual(expect.objectContaining({ locale }));
      unmount();
    }
  });

  it('uses Apple’s and Facebook’s French wording, and the “or” line in French', async () => {
    mountIn('fr');
    expect(await screen.findByRole('button', { name: 'Se connecter avec Apple' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuer avec Facebook' })).toBeInTheDocument();
    expect(screen.getByText('ou')).toBeInTheDocument();
  });

  it('keeps Apple’s and Facebook’s English wording in Welsh, where they have none of their own', async () => {
    mountIn('cy', { label: 'continue' });
    expect(await screen.findByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Facebook' })).toBeInTheDocument();
    expect(screen.getByText('neu')).toBeInTheDocument();
  });
});
