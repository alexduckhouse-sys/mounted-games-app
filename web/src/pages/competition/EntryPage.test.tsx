import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { competition, heat, session, team } from '../../test/factories';
import type { CompetitionDetail, CompetitionSection } from '../../types';
import { CompetitionContext, type CompetitionCtx } from './context';
import { AfterDrawOnly, CompetitionHome } from './CompetitionHome';
import { EntryPage } from './EntryPage';
import { entryFeeText } from '../../lib/competitionPhase';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('./TimetableBoard', () => ({ TimetableBoard: () => <p>Timetable board</p> }));
vi.mock('../commerce/DemoEntryPayment', () => ({ DemoEntryPayment: () => null }));

const sections: CompetitionSection[] = [
  { id: 5, competitionId: 1, format: 1, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 1500 },
  { id: 6, competitionId: 1, format: 1, ageGroup: 'U16', displayName: 'Under 16', priceMinor: 2500 },
];

function mount(roles: string[] | null, extra: Partial<CompetitionDetail> = {}, path = '/competitions/1') {
  if (roles) {
    localStorage.setItem('mg.auth', JSON.stringify({
      token: 'test-token', expiresAt: '2099-01-01T00:00:00Z',
      user: { id: 'u1', fullName: 'Test Person', email: 'test@example.com', roles },
    }));
  }
  const ctx = {
    competition: competition({ sections, createdByUserId: 'owner', name: 'TEST COMP1', location: 'Hartpury', ...extra }),
    reload: vi.fn(),
  } as unknown as CompetitionCtx;
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <CompetitionContext.Provider value={ctx}>
          <Routes>
            <Route path="/competitions/:id" element={<CompetitionHome />} />
            <Route path="/competitions/:id/enter/*" element={<EntryPage />} />
            <Route path="/competitions/:id/toplists" element={<AfterDrawOnly><p>Toplists</p></AfterDrawOnly>} />
          </Routes>
        </CompetitionContext.Provider>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function asRole(role: string) {
  vi.mocked(api.get).mockImplementation(async (url) => (url === '/auth/me' ? { data: { roles: [role] } } : { data: [] }));
}

beforeEach(() => asRole('Member'));

describe('the entry page', () => {
  it('opens a new competition on the first step of entering, with the stepper', async () => {
    mount(null);
    expect(await screen.findByRole('heading', { name: 'What are you entering?' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Entry steps' })).toBeInTheDocument();
    expect(screen.getByText(/open once the teams are drawn/)).toBeInTheDocument();
    expect(screen.queryByText('Timetable board')).not.toBeInTheDocument();
    // Signed out, every choice goes to sign in first.
    for (const link of screen.getAllByRole('link', { name: /^Pair/ })) expect(link).toHaveAttribute('href', '/login');
  });

  it('lets a signed-in member pick an age group and go on to their details', async () => {
    mount(['Member']);
    const pairs = await screen.findAllByRole('link', { name: /^Pair/ });
    expect(pairs).toHaveLength(2);
    await userEvent.click(pairs[0]);
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
  });

  it('says entries are closed instead of offering them', async () => {
    mount(['Member'], { signupsLocked: true });
    expect(await screen.findByRole('status')).toHaveTextContent('Entries are closed for this competition.');
    expect(screen.queryByRole('link', { name: /^Pair/ })).not.toBeInTheDocument();
  });

  it('lets the public open toplists before the draw (BUG-32)', async () => {
    mount(null, {}, '/competitions/1/toplists');
    expect(await screen.findByText('Toplists', undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it('gives an admin the normal pages, as they organise everything', async () => {
    asRole('Admin');
    mount(['Admin'], {}, '/competitions/1/toplists');
    expect(await screen.findByText('Toplists')).toBeInTheDocument();
  });

  it('gives an admin the timetable at home', async () => {
    asRole('Admin');
    mount(['Admin']);
    expect(await screen.findByText('Timetable board')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What are you entering?' })).not.toBeInTheDocument();
  });

  it('keeps the entry page as home while teams are formed but no heats exist (BUG-32)', async () => {
    mount(null, { teams: [team(1)] });
    expect(await screen.findByRole('heading', { name: 'What are you entering?' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText('Timetable board')).not.toBeInTheDocument();
  });

  it('returns to the timetable once a generated timetable has heats', async () => {
    mount(null, { sessions: [session(1, { heats: [heat(1)] })] });
    expect(await screen.findByText('Timetable board')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'What are you entering?' })).not.toBeInTheDocument());
  });
});

describe('entryFeeText', () => {
  const at = (...prices: number[]) => prices.map((priceMinor, i) => ({ id: i, priceMinor }) as CompetitionSection);
  it.each([
    [[], null],
    [[0, 0], 'Free'],
    [[1500, 1500], '£15.00'],
    [[0, 1500], 'From free to £15.00'],
    [[1000, 2000], 'From £10.00 to £20.00'],
  ])('reads %j as %s', (prices, text) => {
    expect(entryFeeText(at(...(prices as number[])))).toBe(text);
  });
});

it('shows a passed server closing date on the entry page', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/auth/me' ? { roles: ['Member'] } : url.endsWith('/entry-settings') ? { competitionId: 1, entriesCloseAt: '2020-01-01T00:00:00Z', entriesClosed: true } : [] }));
  mount(['Member']);
  expect(await screen.findByText('Entries are closed for this competition.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /^Pair/ })).not.toBeInTheDocument();
});
