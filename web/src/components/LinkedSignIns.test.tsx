import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { loadApple, loadGoogle, makeNonce, randomState, type AppleAuthApi, type GoogleCredentialResponse, type GoogleIdApi } from '../auth/socialSdk';
import type { LinkedSignInsState } from '../hooks/useLinkedSignIns';
import { autoConfirm } from '../test/confirm';
import type { LinkedSignIns as Info } from '../types';
import { LINKED_SIGN_INS_COPY, LinkedSignIns } from './LinkedSignIns';
import { clearSocialProvidersCache } from './SocialLoginButtons';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../auth/socialSdk', () => ({ loadGoogle: vi.fn(), loadApple: vi.fn(), makeNonce: vi.fn(), randomState: vi.fn() }));

const google = { initialize: vi.fn(), renderButton: vi.fn() } satisfies GoogleIdApi;
const apple = { init: vi.fn(), signIn: vi.fn() } satisfies AppleAuthApi;
const providers = [
  { id: 'google', name: 'Google', clientId: 'web-client.apps.googleusercontent.com' },
  { id: 'apple', name: 'Apple', clientId: 'uk.example.web' },
];

function mount(info: Info | null, overrides: Partial<LinkedSignInsState> = {}) {
  const props = { info, connect: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), onChanged: vi.fn(), ...overrides };
  return { ...render(<LinkedSignIns {...props} />), ...props };
}

beforeEach(() => {
  clearSocialProvidersCache();
  vi.mocked(api.get).mockResolvedValue({ data: providers });
  vi.mocked(loadGoogle).mockResolvedValue(google);
  vi.mocked(loadApple).mockResolvedValue(apple);
  vi.mocked(makeNonce).mockResolvedValue({ raw: 'raw-nonce', hashed: 'hashed-nonce' });
  vi.mocked(randomState).mockReturnValue('state-1');
});

describe('LinkedSignIns', () => {
  it('shows nothing while loading, or when nothing is linked and nothing can be added', async () => {
    expect(mount(null).container).toBeEmptyDOMElement();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    clearSocialProvidersCache();
    const { container } = mount({ hasPassword: true, logins: [] });
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
  });

  it('lists linked sign-ins with Remove, and offers the others with the providers’ own buttons', async () => {
    mount({ hasPassword: true, logins: [{ provider: 'google', name: 'Google' }] });
    expect(screen.getByRole('heading', { name: LINKED_SIGN_INS_COPY.heading })).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Google sign-in' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();
    expect(screen.queryByTestId('google-signin')).not.toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });

  it('never offers to remove the only way into an account with no password', () => {
    mount({ hasPassword: false, logins: [{ provider: 'google', name: 'Google' }] });
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText(LINKED_SIGN_INS_COPY.onlyWayIn)).toBeInTheDocument();
    expect(screen.getByText(LINKED_SIGN_INS_COPY.onlyWayInNote)).toBeInTheDocument();
  });

  it('adds a provider and says so, or shows why not', async () => {
    const connect = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce({ response: { status: 409, data: { message: 'That Google account is already linked to a different Mounted Games account.' } } });
    const { onChanged } = mount({ hasPassword: true, logins: [] }, { connect });
    await waitFor(() => expect(google.initialize).toHaveBeenCalled());
    const callback = google.initialize.mock.calls.at(-1)![0].callback as (r: GoogleCredentialResponse) => void;

    await act(async () => { callback({ credential: 'google-token' }); });
    expect(connect).toHaveBeenCalledWith({ provider: 'google', idToken: 'google-token', nonce: 'raw-nonce' });
    expect(onChanged).toHaveBeenCalledWith('Google added');

    await act(async () => { callback({ credential: 'someone-elses' }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('already linked to a different');

    // The provider's own failure shows too.
    await act(async () => { callback({}); });
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in didn’t work');
  });

  it('asks before removing, then removes and says so, or shows why not', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const { onChanged } = mount({ hasPassword: true, logins: [{ provider: 'google', name: 'Google' }, { provider: 'apple', name: 'Apple' }] }, { remove });

    const asked = autoConfirm(false);
    await user.click(screen.getByRole('button', { name: 'Remove Google sign-in' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith(LINKED_SIGN_INS_COPY.removeMessage('Google')));
    expect(remove).not.toHaveBeenCalled();

    autoConfirm(true);
    await user.click(screen.getByRole('button', { name: 'Remove Google sign-in' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('google'));
    expect(onChanged).toHaveBeenCalledWith('Google removed');

    await user.click(screen.getByRole('button', { name: 'Remove Apple sign-in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(LINKED_SIGN_INS_COPY.failed);
  });

  it('names a provider from the list it was linked under when it is no longer switched on', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [providers[0]] });
    const user = userEvent.setup();
    const { onChanged } = mount({ hasPassword: true, logins: [{ provider: 'apple', name: 'Apple' }] });
    autoConfirm(true);
    await user.click(screen.getByRole('button', { name: 'Remove Apple sign-in' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Apple removed'));
  });
});
