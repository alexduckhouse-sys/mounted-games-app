import { render, screen, waitFor } from '@testing-library/react';
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

describe('DeleteAccountPanel', () => {
  it('shows only the first button until asked, and cancel puts it back', async () => {
    mount();
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await userEvent.type(screen.getByLabelText('Enter your password to confirm'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Keep my account' }));
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByLabelText('Enter your password to confirm')).toHaveValue('');
  });

  it('will not submit without a password', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByRole('button', { name: 'Permanently delete my account' })).toBeDisabled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('deletes with the password, signs out and goes home', async () => {
    vi.mocked(api.delete).mockResolvedValue({ status: 204 });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await userEvent.type(screen.getByLabelText('Enter your password to confirm'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(api.delete).toHaveBeenCalledWith('/auth/me', { data: { password: 'secret' } });
    expect(localStorage.getItem('mg.auth')).toBeNull();
  });

  it('keeps the person signed in and shows the reason when the API refuses', async () => {
    vi.mocked(api.delete).mockRejectedValue({ response: { data: { message: "That password isn't right." } } });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await userEvent.type(screen.getByLabelText('Enter your password to confirm'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That password isn't right.");
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
    expect(localStorage.getItem('mg.auth')).not.toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Permanently delete my account' })).toBeEnabled());
  });
});
