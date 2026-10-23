import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { competition } from '../../test/factories';
import type { CompetitionSection } from '../../types';
import { CompetitionContext, type CompetitionCtx } from './context';
import { DetailsTab } from './DetailsTab';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../commerce/DemoEntryPayment', () => ({ DemoEntryPayment: () => null }));

const section: CompetitionSection = { id: 5, competitionId: 1, format: 1, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 1500 };

function LoginProbe() {
  const { state } = useLocation();
  return <p>Login, back to {(state as { from?: string } | null)?.from}</p>;
}

function mount(roles: string[] | null) {
  if (roles) {
    localStorage.setItem('mg.auth', JSON.stringify({
      token: 'test-token', expiresAt: '2099-01-01T00:00:00Z',
      user: { id: 'u1', fullName: 'Test Person', email: 'test@example.com', roles },
    }));
  }
  const ctx = { competition: competition({ id: 25, sections: [section], createdByUserId: 'owner' }), reload: vi.fn() } as unknown as CompetitionCtx;
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/details']}>
        <CompetitionContext.Provider value={ctx}>
          <Routes>
            <Route path="/details" element={<DetailsTab />} />
            <Route path="/login" element={<LoginProbe />} />
          </Routes>
        </CompetitionContext.Provider>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url) => (url === '/auth/me' ? { data: { roles: ['Admin'] } } : { data: [] }));
});

describe('entering from the Details tab', () => {
  it('lets a signed-out visitor see the section and sign in, then come back to this competition\'s entry page', async () => {
    mount(null);
    await userEvent.click(await screen.findByRole('link', { name: 'Sign in to enter' }));
    expect(await screen.findByText('Login, back to /competitions/25/enter')).toBeInTheDocument();
  });

  it('lets an admin join a section instead of showing an entrants-only note', async () => {
    mount(['Admin']);
    expect(await screen.findByRole('button', { name: /Join/ })).toBeInTheDocument();
    expect(screen.queryByText(/Admin view/)).not.toBeInTheDocument();
  });
});
