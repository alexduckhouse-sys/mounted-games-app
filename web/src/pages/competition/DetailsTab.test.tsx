import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { DetailsTab } from './DetailsTab';
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
        <Route path="/competitions/:id/enter/*" element={<p>Entry page</p>} />
        <Route path="/login" element={<p>Login page</p>} />
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

  it('lists each age group with its fees and one Enter bar, with no counts or progress bars', () => {
    renderTab();
    expect(screen.getByRole('list', { name: 'Age groups and fees' })).toHaveTextContent('Under 10Individual £45');
    expect(screen.getByRole('list', { name: 'Age groups and fees' })).toHaveTextContent('Under 12Individual Free');
    expect(screen.queryByText(/places left|Up to 16 places|No limit|entered/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pay the organiser by bank transfer|Pay to/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter' })).toHaveAttribute('href', '/competitions/5/enter');
    expect(screen.getByRole('link', { name: /Arena setup and race diagrams/ })).toBeInTheDocument();
  });

  it('puts At the event, Share and print and Enter in that order', () => {
    renderTab();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('At the event')).toBeLessThan(headings.indexOf('Share and print'));
    expect(headings.indexOf('Share and print')).toBeLessThan(headings.indexOf('Enter'));
    expect(screen.getByRole('link', { name: 'Weather' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Message the organisers' })).toBeInTheDocument();
  });

  it('shows the venue, a maps link and the what3words, and leaves out facts it does not have', () => {
    vi.mocked(useCompetition).mockReturnValue({
      competition: { ...competition, what3Words: 'gravel.pony.flag', latitude: 51.9, longitude: -2.3 }, reload,
    } as unknown as ReturnType<typeof useCompetition>);
    renderTab();
    expect(screen.getByLabelText('Event facts')).toHaveTextContent('VenueHartpury');
    expect(screen.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=51.9,-2.3');
    expect(screen.getByRole('link', { name: '///gravel.pony.flag' })).toHaveAttribute('href', 'https://what3words.com/gravel.pony.flag');
    expect(screen.queryByText('Postcode')).not.toBeInTheDocument();
    expect(screen.queryByText('Comp no.')).not.toBeInTheDocument();
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
  });

  it('uses the organiser’s own map link, and shows the postcode, competition number and email when the API sends them', () => {
    vi.mocked(useCompetition).mockReturnValue({
      competition: { ...competition, appleMapsUrl: 'https://maps.apple.com/?q=Hartpury', postcode: 'GL19 3BE', competitionNumber: '2026-041', contactEmail: 'entries@example.org' }, reload,
    } as unknown as ReturnType<typeof useCompetition>);
    renderTab();
    expect(screen.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', 'https://maps.apple.com/?q=Hartpury');
    expect(screen.getByText('GL19 3BE')).toBeInTheDocument();
    expect(screen.getByText('2026-041')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'entries@example.org' })).toHaveAttribute('href', 'mailto:entries@example.org');
  });

  it('shows Sign in to enter to a signed-out visitor, and it comes back to the entry page', () => {
    viewer({ user: null });
    renderTab();
    const bar = screen.getByRole('link', { name: 'Sign in to enter' });
    expect(bar).toHaveAttribute('href', '/login');
  });

  it('says Enter a team when the event has team age groups', () => {
    vi.mocked(useCompetition).mockReturnValue({
      competition: { ...competition, sections: [{ id: 3, competitionId: 5, format: 2, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 1000 }] }, reload,
    } as unknown as ReturnType<typeof useCompetition>);
    renderTab();
    expect(screen.getByRole('link', { name: 'Enter a team' })).toBeInTheDocument();
  });

  it('says full age groups are full, and leaves the Enter bar out once entries are closed', () => {
    vi.mocked(useCompetition).mockReturnValue({
      competition: {
        ...competition, signupsLocked: true,
        sections: [{ id: 3, competitionId: 5, format: 2, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 1000, maxParticipants: 2, activeSignupsCount: 2 }],
      }, reload,
    } as unknown as ReturnType<typeof useCompetition>);
    renderTab();
    expect(screen.getByRole('list', { name: 'Age groups and fees' })).toHaveTextContent('Full · Waiting list · Guest rider Free');
    expect(screen.getByText('Entries are closed for this competition.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Enter a team' })).not.toBeInTheDocument();
  });

  it('leaves out the Enter section when there are no age groups', () => {
    vi.mocked(useCompetition).mockReturnValue({ competition: { ...competition, sections: [] }, reload } as unknown as ReturnType<typeof useCompetition>);
    renderTab();
    expect(screen.queryByRole('heading', { name: 'Enter' })).not.toBeInTheDocument();
  });

  it('gives organisers their own pages and tools', async () => {
    viewer({ canOrganise: () => true, canManage: () => true });
    vi.mocked(api.get).mockImplementation(async (url) => (String(url).endsWith('/signups') ? { data: [] } : { data: [] }) as never);
    renderTab();
    expect(await screen.findByRole('link', { name: 'Manage entries and equipment' })).toHaveAttribute('href', '/competitions/5/operations');
    expect(screen.getByRole('link', { name: /Scorer QR codes/ })).toHaveAttribute('href', '#scorer-links');
    expect(screen.getByRole('link', { name: /Go live & stream/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Print venue poster' })).toBeInTheDocument();
  });

  it('shows the equipment list to signed-in people and opens it on demand', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => (String(url).endsWith('/equipment')
      ? { data: { sessions: 2, racesCounted: 3, lines: [{ bucket: 'Lane', kind: 'Pole', count: 5 }] } } : { data: [] }) as never);
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Equipment required' }));
    expect(await screen.findByText('Pole')).toBeInTheDocument();
    expect(screen.getByText('×5')).toBeInTheDocument();
  });

  it('says so when the equipment list cannot be loaded', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => { if (String(url).endsWith('/equipment')) throw new Error('offline'); return { data: [] } as never; });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Equipment required' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the equipment. Check your signal and try again.');
  });

  it('retries the equipment list from the problem strip', async () => {
    let attempts = 0;
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (!String(url).endsWith('/equipment')) return { data: [] } as never;
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return { data: { sessions: 1, racesCounted: 1, lines: [{ bucket: 'Lane', kind: 'Pole', count: 5 }] } } as never;
    });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Equipment required' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Pole')).toBeInTheDocument();
  });

  it('says there is nothing to count when no races are set up', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => (String(url).endsWith('/equipment') ? { data: { sessions: 0, racesCounted: 0, lines: [] } } : { data: [] }) as never);
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Equipment required' }));
    expect(await screen.findByText(/No races set up yet/)).toBeInTheDocument();
  });
});
