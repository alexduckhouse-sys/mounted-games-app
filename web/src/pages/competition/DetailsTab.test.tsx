import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { DetailsTab, SectionEntryPage } from './DetailsTab';
import { useCompetition } from './context';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./context', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context')>()), useCompetition: vi.fn() }));
vi.mock('../commerce/DemoEntryPayment', () => ({ DemoEntryPayment: () => null }));

const reload = vi.fn();
const longText = 'Two days of mounted games for every age group, with heats on Saturday and finals on Sunday afternoon. Stabling is available on site, so book through the branch secretary and bring your own lane equipment for the warm-up ring.';
const competition = {
  id: 5, name: 'Hartpury Area Festival', organiserName: 'Severn Vale Branch', description: longText, location: 'Hartpury', startDate: '2026-10-24', endDate: '2026-10-25',
  sections: [
    { id: 1, competitionId: 5, format: 3, ageGroup: 'Under 10', displayName: 'Under 10', priceMinor: 4500, maxParticipants: 16 },
    { id: 2, competitionId: 5, format: 3, ageGroup: 'Under 12', displayName: 'Under 12', priceMinor: 0, maxParticipants: null },
  ],
  teams: [], paymentDestination: '20-45-77 · 12345678', signupsLocked: false,
};

function viewer(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', roles: ['Member'] }, canEdit: () => false, canOrganise: () => false, canManage: () => false, hasRole: () => false, ...overrides,
  } as unknown as ReturnType<typeof useAuth>);
}

function HeaderProbe() {
  const { header } = useCompactPageBarState();
  return <output data-testid="header">{header ? `${header.title}|${header.subtitle}` : 'none'}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCompetition).mockReturnValue({ competition, reload } as unknown as ReturnType<typeof useCompetition>);
  vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
  viewer();
});

const renderTab = (initialPath = '/competitions/5/details') => render(
  <CompactPageBarProvider>
    <MemoryRouter initialEntries={[initialPath]}>
      <HeaderProbe />
      <Routes>
        <Route path="/competitions/:id/details" element={<DetailsTab />} />
        <Route path="/competitions/:id/enter/:sectionId" element={<SectionEntryPage />} />
      </Routes>
    </MemoryRouter>
  </CompactPageBarProvider>,
);

describe('DetailsTab', () => {
  it('puts the page title and refresh in the app header', async () => {
    renderTab();
    expect(screen.getByTestId('header')).toHaveTextContent('Details|Hartpury Area Festival');
    expect(screen.getByRole('heading', { name: 'Details & entries', level: 1 })).toBeInTheDocument();
  });

  it('shortens a long description until More is tapped', async () => {
    renderTab();
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows prices and the place limit to entrants without claiming how many are left', () => {
    renderTab();
    expect(screen.getByText('Up to 16 places')).toBeInTheDocument();
    expect(screen.getByText('No limit')).toBeInTheDocument();
    expect(screen.getByText('£45.00')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText(/Pay to/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Join/ })).toHaveLength(2);
  });

  it('shows places left and a Full tile to organisers, who receive the signup list', async () => {
    viewer({ canOrganise: () => true, canManage: () => true });
    const signups = Array.from({ length: 16 }, (_, index) => ({ id: index + 1, competitionSectionId: 1, status: 1, fullName: `Rider ${index}`, amountMinor: 4500 }));
    vi.mocked(api.get).mockImplementation(async (url) => (String(url).endsWith('/signups') ? { data: signups } : { data: [] }) as never);
    renderTab();
    expect((await screen.findAllByText('Full')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Join/ })).toHaveLength(1);
  });

  it('opens the entry form on its own page and returns on Cancel', async () => {
    renderTab();
    await userEvent.click(screen.getAllByRole('button', { name: /Join/ })[0]);
    expect(screen.getByRole('heading', { name: 'Enter Under 10' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your full name')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByPlaceholderText('Your full name')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Details & entries', level: 1 })).toBeInTheDocument();
  });

  it('shows Section not found when the sectionId in the URL does not exist', () => {
    renderTab('/competitions/5/enter/999');
    expect(screen.getByRole('alert')).toHaveTextContent('Section not found.');
    expect(screen.queryByPlaceholderText('Your full name')).not.toBeInTheDocument();
  });
});
