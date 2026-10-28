import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { loadApple, loadGoogle, makeNonce, randomState, type AppleAuthApi, type GoogleCredentialResponse, type GoogleIdApi } from '../auth/socialSdk';
import type { LinkedSignInsState } from '../hooks/useLinkedSignIns';
import type { LinkedSignIns as Info } from '../types';
import { en } from '../i18n/en';
import { LinkedSignIns } from './LinkedSignIns';
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
    expect(screen.getByRole('heading', { name: en['account.signIns.heading'] })).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Google sign-in' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();
    expect(screen.queryByTestId('google-signin')).not.toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });

  it('never offers to remove the only way into an account with no password', () => {
    mount({ hasPassword: false, logins: [{ provider: 'google', name: 'Google' }] });
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText(en['account.signIns.onlyWayIn'])).toBeInTheDocument();
    expect(screen.getByText(en['account.signIns.onlyWayInNote'])).toBeInTheDocument();
  });

  const lastGoogleCallback = () => google.initialize.mock.calls.at(-1)![0].callback as (r: GoogleCredentialResponse) => void;
  const sheet = (name: string) => within(screen.getByRole('dialog', { name }));

  it('adds a provider once the password confirms it’s the owner, and says so, or shows why not', async () => {
    const user = userEvent.setup();
    const connect = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ response: { status: 409, data: { message: 'That Google account is already linked to a different Mounted Games account.' } } });
    const { onChanged } = mount({ hasPassword: true, logins: [] }, { connect });
    await waitFor(() => expect(google.initialize).toHaveBeenCalled());

    // Google's sign-in alone adds nothing: it opens the sheet, which wants the password.
    await act(async () => { lastGoogleCallback()({ credential: 'google-token' }); });
    const add = sheet('Add Google sign-in?');
    expect(add.getByText(en['account.signIns.addMessage'].replace('{name}', 'Google'))).toBeInTheDocument();
    expect(connect).not.toHaveBeenCalled();
    expect(add.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.type(add.getByLabelText('Your password'), 'Passw0rd!x');
    await user.click(add.getByRole('button', { name: 'Add' }));
    expect(connect).toHaveBeenCalledWith({ provider: 'google', idToken: 'google-token', nonce: 'raw-nonce' }, { password: 'Passw0rd!x' });
    expect(onChanged).toHaveBeenCalledWith('Google added');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // A refusal shows in the sheet, which stays open; Cancel closes it.
    await waitFor(() => expect(google.initialize).toHaveBeenCalledTimes(2));
    await act(async () => { lastGoogleCallback()({ credential: 'someone-elses' }); });
    const again = sheet('Add Google sign-in?');
    await user.type(again.getByLabelText('Your password'), 'Passw0rd!x');
    await user.click(again.getByRole('button', { name: 'Add' }));
    expect(await again.findByRole('alert')).toHaveTextContent('already linked to a different');
    await user.click(again.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // The provider's own failure shows too.
    await waitFor(() => expect(google.initialize).toHaveBeenCalledTimes(3));
    await act(async () => { lastGoogleCallback()({}); });
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in didn’t work');
  });

  it('removes once the password confirms it’s the owner, and says so, or shows why not', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const { onChanged } = mount({ hasPassword: true, logins: [{ provider: 'google', name: 'Google' }, { provider: 'apple', name: 'Apple' }] }, { remove });

    await user.click(screen.getByRole('button', { name: 'Remove Google sign-in' }));
    let asked = sheet('Remove Google sign-in?');
    expect(asked.getByText(en['account.signIns.removeMessage'].replace('{name}', 'Google'))).toBeInTheDocument();
    await user.click(asked.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove Google sign-in' }));
    asked = sheet('Remove Google sign-in?');
    // Enter with no password does nothing.
    await user.type(asked.getByLabelText('Your password'), '{Enter}');
    expect(remove).not.toHaveBeenCalled();
    await user.type(asked.getByLabelText('Your password'), 'Passw0rd!x');
    await user.click(asked.getByRole('button', { name: 'Remove' }));
    expect(remove).toHaveBeenCalledWith('google', { password: 'Passw0rd!x' });
    expect(onChanged).toHaveBeenCalledWith('Google removed');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Remove Apple sign-in' }));
    asked = sheet('Remove Apple sign-in?');
    await user.type(asked.getByLabelText('Your password'), 'Passw0rd!x');
    await user.click(asked.getByRole('button', { name: 'Remove' }));
    expect(await asked.findByRole('alert')).toHaveTextContent(en['account.signIns.failed']);
  });

  it('asks an account with no password to confirm with a fresh sign-in from a provider it already has', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { onChanged } = mount({ hasPassword: false, logins: [{ provider: 'google', name: 'Google' }, { provider: 'apple', name: 'Apple' }] }, { remove });
    await userEvent.click(screen.getByRole('button', { name: 'Remove Apple sign-in' }));
    const asked = sheet('Remove Apple sign-in?');
    expect(asked.getByText(en['account.signIns.confirmWithProvider'])).toBeInTheDocument();
    expect(asked.queryByLabelText('Your password')).not.toBeInTheDocument();
    await waitFor(() => expect(google.initialize).toHaveBeenCalled());

    await act(async () => { lastGoogleCallback()({ credential: 'confirm-token' }); });
    expect(remove).toHaveBeenCalledWith('apple', { provider: 'google', idToken: 'confirm-token', nonce: 'raw-nonce' });
    expect(onChanged).toHaveBeenCalledWith('Apple removed');
  });

  it('shows a refused confirmation in the sheet, ignores a second sign-in while one is under way, and Cancel closes it', async () => {
    let finish!: () => void;
    const remove = vi.fn()
      .mockRejectedValueOnce({ response: { status: 400, data: { message: 'That isn’t the Google account linked to this one.' } } })
      .mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    mount({ hasPassword: false, logins: [{ provider: 'google', name: 'Google' }, { provider: 'apple', name: 'Apple' }, { provider: 'legacy', name: 'Legacy' }] }, { remove });
    await userEvent.click(screen.getByRole('button', { name: 'Remove Apple sign-in' }));
    const asked = sheet('Remove Apple sign-in?');
    await waitFor(() => expect(google.initialize).toHaveBeenCalled());

    await act(async () => { lastGoogleCallback()({ credential: 'someone-elses' }); });
    expect(await asked.findByRole('alert')).toHaveTextContent('That isn’t the Google account linked to this one.');

    await act(async () => { lastGoogleCallback()({ credential: 'confirm-1' }); });
    await act(async () => { lastGoogleCallback()({ credential: 'confirm-2' }); });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(asked.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Remove Google sign-in' }));
    await userEvent.click(sheet('Remove Google sign-in?').getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('names a provider from the list it was linked under when it is no longer switched on', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [providers[0]] });
    const user = userEvent.setup();
    const { onChanged } = mount({ hasPassword: true, logins: [{ provider: 'apple', name: 'Apple' }] });
    await user.click(screen.getByRole('button', { name: 'Remove Apple sign-in' }));
    const asked = sheet('Remove Apple sign-in?');
    await user.type(asked.getByLabelText('Your password'), 'Passw0rd!x');
    await user.click(asked.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Apple removed'));
  });
});
