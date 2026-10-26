import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { TrainerAccountNotice } from './TrainerAccountNotice';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const auth: StoredAuth = {
  token: 'pending-token', expiresAt: '2099-01-01T00:00:00Z',
  user: { id: 'test-user', fullName: 'Test Applicant', email: 'test@example.com', clubId: null, clubName: null, roles: ['Member', 'TrainerRequest'] },
};

function Signup() {
  const { signupTrainer } = useAuth();
  return <button onClick={() => signupTrainer('test-user', 'password')}>Request account</button>;
}

function mount() {
  return render(<AuthProvider><MemoryRouter><Routes>
    <Route path="/" element={<><TrainerAccountNotice /><Signup /></>} />
    <Route path="/login" element={<p>Login page</p>} />
  </Routes></MemoryRouter></AuthProvider>);
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: auth.user });
  vi.mocked(api.post).mockResolvedValue({ data: auth });
});

it('hides the notice when there is no trainer account update', () => {
  mount();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('shows the requested message after signup using the roles returned by the server', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Request account' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Your trainer request is waiting for approval. You can use the app as a member until then.');
  expect(screen.queryByText('TrainerRequest')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
});

it('offers a fresh sign-in after approval and clears the old session before opening login', async () => {
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  vi.mocked(api.get).mockResolvedValue({ data: { ...auth.user, roles: ['Trainer'] } });
  mount();
  expect(await screen.findByRole('status')).toHaveTextContent('You’re approved as a trainer. Sign in again to start organising.');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  expect(screen.getByText('Login page')).toBeInTheDocument();
  expect(localStorage.getItem('mg.auth')).toBeNull();
});

it('does not show approval when the server check fails', async () => {
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  vi.mocked(api.get).mockRejectedValue(new Error('offline'));
  mount();
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(localStorage.getItem('mg.auth')).not.toBeNull();
});
