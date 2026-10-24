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
import { SectionEntryPage } from './DetailsTab';
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
            <Route path="/competitions/:id/enter/:sectionId" element={<SectionEntryPage />} />
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
  it('shows a signed-out visitor the event and a Sign in to enter button on every section', async () => {
    mount(null);
    expect(await screen.findByRole('heading', { name: 'TEST COMP1' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Hartpury')).toBeInTheDocument();
    expect(screen.getByText('From £15.00 to £25.00')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Sign in to enter' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/login');
    expect(screen.getByText(/open once the teams are drawn/)).toBeInTheDocument();
    expect(screen.queryByText('Timetable board')).not.toBeInTheDocument();
  });

  it('lets a signed-in member join a section on its own entry page', async () => {
    mount(['Member']);
    const joins = await screen.findAllByRole('button', { name: /Join/ });
    expect(joins).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Sign in to enter' })).not.toBeInTheDocument();
    await userEvent.click(joins[0]);
    expect(await screen.findByPlaceholderText('Your full name')).toBeInTheDocument();
  });

  it('shows Entries closed instead of a button', async () => {
    mount(['Member'], { signupsLocked: true });
    expect(await screen.findAllByText('Entries closed.')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Entries for this event are closed.');
    expect(screen.queryByRole('button', { name: /Join/ })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('heading', { name: 'TEST COMP1' })).not.toBeInTheDocument();
  });

  it('keeps the entry page as home while teams are formed but no heats exist (BUG-32)', async () => {
    mount(null, { teams: [team(1)] });
    expect(await screen.findByRole('heading', { name: 'TEST COMP1' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText('Timetable board')).not.toBeInTheDocument();
  });

  it('returns to the timetable once a generated timetable has heats', async () => {
    mount(null, { sessions: [session(1, { heats: [heat(1)] })] });
    expect(await screen.findByText('Timetable board')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'TEST COMP1' })).not.toBeInTheDocument());
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

it('shows a passed server closing date on the entry page and section cards', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/auth/me' ? { roles: ['Member'] } : url.endsWith('/entry-settings') ? { competitionId: 1, entriesCloseAt: '2020-01-01T00:00:00Z', entriesClosed: true } : [] }));
  mount(['Member']);
  expect(await screen.findByText('Entries for this event are closed.')).toBeInTheDocument();
  expect(await screen.findAllByText('Entries closed.')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Join/ })).not.toBeInTheDocument();
});
