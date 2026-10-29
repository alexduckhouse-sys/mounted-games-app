import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import type { Role } from '../types';
import { ProtectedRoute } from './ProtectedRoute';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));

function LoginPage() {
  const state = useLocation().state as { from?: string } | null;
  return <p>Login page, came from {state?.from ?? 'nowhere'}</p>;
}

function signIn(roles: string[]) {
  const auth: StoredAuth = {
    token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: 'u1', email: 'a@b.c', fullName: 'Ann', clubId: null, clubName: null, roles },
  };
  localStorage.setItem('mg.auth', JSON.stringify(auth));
}

function renderAt(path: string, roles?: Role[]) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin/secret" element={<ProtectedRoute roles={roles}><p>Secret page</p></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: {} }); });

function SignOutButton() {
  const { logout } = useAuth();
  return <button onClick={logout}>Sign out</button>;
}

describe('ProtectedRoute', () => {
  it('lands on the timetable, not the login page, when someone signs out on a protected page', async () => {
    signIn(['Member']);
    document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 9, name: 'Nine' }))}; Path=/`;
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/secret']}>
          <Routes>
            <Route path="/" element={<p>Home page</p>} />
            <Route path="/competitions/9" element={<p>Timetable 9</p>} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin/secret" element={<ProtectedRoute><SignOutButton /></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    fireEvent.click(screen.getByText('Sign out'));
    expect(screen.getByText('Timetable 9')).toBeInTheDocument();
    expect(screen.queryByText(/Login page/)).not.toBeInTheDocument();
    document.cookie = 'mg.competition=; Max-Age=0; Path=/';
  });


  it('sends a signed-out visitor to the login page, remembering where they were going', () => {
    renderAt('/admin/secret');
    expect(screen.getByText('Login page, came from /admin/secret')).toBeInTheDocument();
    expect(screen.queryByText('Secret page')).not.toBeInTheDocument();
  });

  it('keeps the query string, so a scanned team QR code still carries its join key through sign-in', () => {
    renderAt('/admin/secret?join=ABCD2345');
    expect(screen.getByText('Login page, came from /admin/secret?join=ABCD2345')).toBeInTheDocument();
  });

  it('shows the page to any signed-in user when no roles are required', () => {
    signIn(['Member']);
    renderAt('/admin/secret');
    expect(screen.getByText('Secret page')).toBeInTheDocument();
  });

  it('shows the page when the user has one of the required roles', () => {
    signIn(['Trainer']);
    renderAt('/admin/secret', ['Admin', 'Trainer']);
    expect(screen.getByText('Secret page')).toBeInTheDocument();
  });

  it('sends a signed-in user without the role home', () => {
    signIn(['Member']);
    renderAt('/admin/secret', ['Admin']);
    expect(screen.getByText('Home page')).toBeInTheDocument();
    expect(screen.queryByText('Secret page')).not.toBeInTheDocument();
  });

  it('sends a signed-in user home when an empty role list is required', () => {
    signIn(['Admin']);
    renderAt('/admin/secret', []);
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });
});


function PrivateEditor() {
  const [draft, setDraft] = useState('');
  return <input aria-label="Private draft" value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

it.each(['account', 'roles'])('discards in-memory protected drafts when %s changes in another tab', (change) => {
  signIn(['Admin']);
  render(<AuthProvider><MemoryRouter><ProtectedRoute roles={['Admin']}><PrivateEditor /></ProtectedRoute></MemoryRouter></AuthProvider>);
  fireEvent.change(screen.getByLabelText('Private draft'), { target: { value: 'Fake account A private draft' } });
  const next = JSON.parse(localStorage.getItem('mg.auth')!) as StoredAuth;
  if (change === 'account') next.user.id = 'fake-account-b';
  else next.user.roles = ['Admin', 'MasterAdmin'];
  act(() => {
    localStorage.setItem('mg.auth', JSON.stringify(next));
    window.dispatchEvent(new StorageEvent('storage', { key: 'mg.auth' }));
  });
  expect(screen.getByLabelText('Private draft')).toHaveValue('');
});
