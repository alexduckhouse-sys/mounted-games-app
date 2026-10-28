import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('keeps the title card to the name, date and venue and description, with the details folded away under See details', async () => {
    vi.mocked(useCompetition).mockReturnValue({
      competition: { ...competition, what3Words: 'gravel.pony.flag', latitude: 51.9, longitude: -2.3 }, reload,
    } as unknown as ReturnType<typeof useCompetition>);
    renderTab();
    const card = screen.getByRole('region', { name: 'About this event' });
    expect(within(card).getByRole('heading', { name: 'Hartpury Area Festival' })).toBeInTheDocument();
    const toggle = within(card).getByRole('button', { name: /See details/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The muted line names what is inside, built from what is set.
    expect(toggle).toHaveTextContent('Venue, what3words and organiser');
    expect(screen.queryByRole('link', { name: /gravel/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Event facts')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    const open = within(card).getByRole('button', { name: 'Hide details' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open).not.toHaveTextContent('what3words');
    expect(within(card).getByRole('link', { name: /Venue\s*Hartpury/ })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=51.9,-2.3');
    expect(within(card).getByRole('link', { name: /what3words\s*\/\/\/gravel\.pony\.flag/ })).toHaveAttribute('href', 'https://what3words.com/gravel.pony.flag');
    expect(within(card).getByText('Severn Vale Branch')).toBeInTheDocument();
    // Only what is set: no postcode, email, competition number or lorry park rows.
    for (const label of ['Postcode', 'Email', 'Competition no.', 'Lorry park']) expect(within(card).queryByText(label)).not.toBeInTheDocument();

    await userEvent.click(open);
    await waitFor(() => expect(within(card).queryByText('Severn Vale Branch')).not.toBeInTheDocument());
    expect(within(card).getByRole('button', { name: /See details/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the postcode, lorry park, email and competition number rows when the organiser has set them, with the organiser’s own map link', async () => {
    vi.mocked(useCompetition).mockReturnValue({
      competition: {
        ...competition, appleMapsUrl: 'https://maps.apple.com/?q=Hartpury', postcode: 'GL19 3BE', competitionNumber: '2026-041', contactEmail: 'entries@example.org',
        lorryWhat3Words: 'bags.cool.lamp', lorryDirectionsNote: 'Enter by the north gate',
      }, reload,
    } as unknown as ReturnType<typeof useCompetition>);
    renderTab();
    const card = screen.getByRole('region', { name: 'About this event' });
    expect(card).toHaveTextContent('Venue, postcode, lorry park, organiser, email and competition number');
    await userEvent.click(within(card).getByRole('button', { name: /See details/ }));
    expect(within(card).getByRole('link', { name: /Venue\s*Hartpury/ })).toHaveAttribute('href', 'https://maps.apple.com/?q=Hartpury');
    expect(within(card).getByRole('link', { name: /Postcode\s*GL19 3BE/ })).toHaveAttribute('href', expect.stringContaining('GL19%203BE'));
    expect(within(card).getByRole('link', { name: /Lorry park/ })).toHaveTextContent('///bags.cool.lamp · Enter by the north gate');
    expect(within(card).getByRole('link', { name: /Lorry park/ })).toHaveAttribute('href', 'https://what3words.com/bags.cool.lamp');
    expect(within(card).getByRole('link', { name: /Email\s*entries@example.org/ })).toHaveAttribute('href', 'mailto:entries@example.org');
    expect(within(card).getByText('Competition no.')).toBeInTheDocument();
    expect(within(card).getByText('2026-041')).toBeInTheDocument();
  });

  it('has no See details row when the organiser has set none of the details', () => {
    vi.mocked(useCompetition).mockReturnValue({
      competition: { ...competition, location: '', organiserName: null }, reload,
    } as unknown as ReturnType<typeof useCompetition>);
    renderTab();
    expect(screen.queryByRole('button', { name: /See details/ })).not.toBeInTheDocument();
  });

  it('uses the cards look: a grey page with each list in its own white card under its heading', () => {
    const { container } = renderTab();
    expect(container.querySelector('.ev-white')).toBeNull();
    for (const name of ['At the event', 'Share and print', 'Age groups and fees']) {
      const list = screen.getByRole('list', { name });
      expect(list).toHaveClass('sp-card');
      expect(list).not.toHaveClass('ev-flat');
    }
  });

  it('shows Dec forms only to signed-in trainers and organisers', () => {
    const { unmount } = renderTab();
    expect(screen.queryByRole('link', { name: 'Dec forms' })).not.toBeInTheDocument();
    unmount();
    viewer({ user: null });
    const signedOut = renderTab();
    expect(screen.queryByRole('link', { name: 'Dec forms' })).not.toBeInTheDocument();
    signedOut.unmount();
    viewer({ hasRole: (role: string) => role === 'Trainer' });
    const trainer = renderTab();
    expect(screen.getByRole('link', { name: 'Dec forms' })).toHaveAttribute('href', expect.stringContaining('declarations'));
    trainer.unmount();
    viewer({ canOrganise: () => true });
    renderTab();
    expect(screen.getByRole('link', { name: 'Dec forms' })).toBeInTheDocument();
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
