import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { deletionErrorMessage } from '../lib/accountDeletion';
import { DeleteAccountPanel } from './DeleteAccountPanel';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const auth: StoredAuth = {
  token: 'test-token', expiresAt: '2099-01-01T00:00:00Z',
  user: { id: 'test-user', fullName: 'Test Person', email: 'test@example.com', clubId: null, clubName: null, roles: ['Member'] },
};

function mount() {
  return render(<AuthProvider><MemoryRouter initialEntries={['/me/account']}><Routes>
    <Route path="/me/account" element={<DeleteAccountPanel />} />
    <Route path="/" element={<p>Home page</p>} />
  </Routes></MemoryRouter></AuthProvider>);
}

beforeEach(() => {
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  vi.mocked(api.get).mockResolvedValue({ data: auth.user });
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
});
