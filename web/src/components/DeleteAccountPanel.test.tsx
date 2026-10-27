import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { loadApple, loadGoogle, makeNonce, randomState, type GoogleCredentialResponse, type GoogleIdApi } from '../auth/socialSdk';
import { deletionErrorMessage } from '../lib/accountDeletion';
import { en } from '../i18n/en';
import { DeleteAccountPanel } from './DeleteAccountPanel';
import { clearSocialProvidersCache } from './SocialLoginButtons';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../auth/socialSdk', () => ({ loadGoogle: vi.fn(), loadApple: vi.fn(), makeNonce: vi.fn(), randomState: vi.fn() }));

const google = { initialize: vi.fn(), renderButton: vi.fn() } satisfies GoogleIdApi;

const auth: StoredAuth = {
  token: 'test-token', expiresAt: '2099-01-01T00:00:00Z',
  user: { id: 'test-user', fullName: 'Test Person', email: 'test@example.com', clubId: null, clubName: null, roles: ['Member'] },
};

function mount(props: Parameters<typeof DeleteAccountPanel>[0] = {}) {
  return render(<AuthProvider><MemoryRouter initialEntries={['/me/account']}><Routes>
    <Route path="/me/account" element={<DeleteAccountPanel {...props} />} />
    <Route path="/" element={<p>Home page</p>} />
  </Routes></MemoryRouter></AuthProvider>);
}

beforeEach(() => {
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  clearSocialProvidersCache();
  vi.mocked(api.get).mockImplementation(async (url) => (url === '/auth/providers'
    ? { data: [{ id: 'google', name: 'Google', clientId: 'web-client' }, { id: 'apple', name: 'Apple', clientId: 'uk.example.web' }] }
    : { data: auth.user }));
  vi.mocked(loadGoogle).mockResolvedValue(google);
  vi.mocked(loadApple).mockReturnValue(new Promise(() => {}));
  vi.mocked(makeNonce).mockResolvedValue({ raw: 'raw-nonce', hashed: 'hashed-nonce' });
  vi.mocked(randomState).mockReturnValue('state-1');
});

describe('deletionErrorMessage', () => {
  it('uses the server message, else a fallback', () => {
    expect(deletionErrorMessage({ response: { data: { message: "That password isn't right." } } })).toBe("That password isn't right.");
    expect(deletionErrorMessage({ response: { data: { message: '  ' } } })).toContain("couldn't delete");
    expect(deletionErrorMessage(new Error('offline'))).toContain("couldn't delete");
    expect(deletionErrorMessage(null)).toContain("couldn't delete");
  });
});

const openSheet = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  return within(screen.getByRole('dialog', { name: 'Delete your account?' }));
};

describe('DeleteAccountPanel', () => {
  it('shows only the first button until asked, and keeping the account closes the sheet', async () => {
    mount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const sheet = await openSheet();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/Your sign-in, notes, saved riders and notifications go\./);
    await userEvent.type(sheet.getByLabelText('Your password'), 'secret');
    await userEvent.click(sheet.getByRole('button', { name: 'Keep my account' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const again = await openSheet();
    expect(again.getByLabelText('Your password')).toHaveValue('');
  });

  it('is a delete-type sheet: Keep my account, then a filled red button', async () => {
    mount();
    const sheet = await openSheet();
    expect(sheet.getByRole('button', { name: 'Keep my account' }).parentElement).toHaveClass('kit-acts-del');
    expect(sheet.getByRole('button', { name: 'Delete my account' })).toHaveClass('kit-pill-del');
  });

  it('will not submit without a password', async () => {
    mount();
    const sheet = await openSheet();
    expect(sheet.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('deletes with the password, signs out and goes home', async () => {
    vi.mocked(api.delete).mockResolvedValue({ status: 204 });
    mount();
    const sheet = await openSheet();
    await userEvent.type(sheet.getByLabelText('Your password'), 'secret');
    await userEvent.click(sheet.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(api.delete).toHaveBeenCalledWith('/auth/me', { data: { password: 'secret' } });
    expect(localStorage.getItem('mg.auth')).toBeNull();
  });

  it('keeps the person signed in and shows the reason when the API refuses', async () => {
    vi.mocked(api.delete).mockRejectedValue({ response: { data: { message: "That password isn't right." } } });
    mount();
    const sheet = await openSheet();
    await userEvent.type(sheet.getByLabelText('Your password'), 'wrong');
    await userEvent.click(sheet.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That password isn't right.");
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
    expect(localStorage.getItem('mg.auth')).not.toBeNull();
    await waitFor(() => expect(sheet.getByRole('button', { name: 'Delete my account' })).toBeEnabled());
  });

  it('asks an account with no password to sign in again with its own provider, then deletes', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce({ response: { data: { message: 'That isn’t the Google account linked to this one.' } } }).mockResolvedValueOnce({ status: 204 });
    mount({ hasPassword: false, linkedProviders: ['google', 'unknown'] });
    const sheet = await openSheet();
    expect(sheet.getByText(en['account.delete.confirmWithProvider'])).toBeInTheDocument();
    expect(sheet.queryByLabelText('Your password')).not.toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: /Apple/ })).not.toBeInTheDocument();
    await waitFor(() => expect(google.initialize).toHaveBeenCalled());
    const callback = google.initialize.mock.calls.at(-1)![0].callback as (r: GoogleCredentialResponse) => void;

    await act(async () => { callback({ credential: 'someone-elses' }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('That isn’t the Google account linked to this one.');
    expect(localStorage.getItem('mg.auth')).not.toBeNull();

    await act(async () => { callback({ credential: 'google-token' }); });
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(api.delete).toHaveBeenLastCalledWith('/auth/me', { data: { provider: 'google', idToken: 'google-token', nonce: 'raw-nonce' } });
    expect(localStorage.getItem('mg.auth')).toBeNull();
  });

  it('shows a provider failure, and says plainly when there is nothing to confirm with', async () => {
    const first = mount({ hasPassword: false, linkedProviders: ['google'] });
    await openSheet();
    await waitFor(() => expect(google.initialize).toHaveBeenCalled());
    const callback = google.initialize.mock.calls.at(-1)![0].callback as (r: GoogleCredentialResponse) => void;
    act(() => callback({}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in didn’t work');
    first.unmount();

    mount({ hasPassword: false });
    const sheet = await openSheet();
    expect(sheet.getByText(en['account.delete.noWayToConfirm'])).toBeInTheDocument();
    await userEvent.click(sheet.getByRole('button', { name: 'Keep my account' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
