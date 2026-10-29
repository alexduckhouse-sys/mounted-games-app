import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { CompactPageBarProvider } from '../../components/CompactPageBarContext';
import { DetailsTab } from './DetailsTab';
import { useCompetition } from './context';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./context', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context')>()), useCompetition: vi.fn() }));
vi.mock('../commerce/DemoEntryPayment', () => ({ DemoEntryPayment: () => null }));

const base = { id: 5, name: 'Hartpury Area Festival', location: 'Hartpury', startDate: '2026-10-24', endDate: '2026-10-25', sections: [], teams: [] };

function show(extra: Record<string, unknown>) {
  vi.mocked(useCompetition).mockReturnValue({ competition: { ...base, ...extra }, reload: vi.fn() } as unknown as ReturnType<typeof useCompetition>);
  return render(
    <CompactPageBarProvider><MemoryRouter initialEntries={['/competitions/5/details']}><Routes><Route path="/competitions/:id/details" element={<DetailsTab />} /></Routes></MemoryRouter></CompactPageBarProvider>,
  );
}

describe('DetailsTab horsebox entrance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
    vi.mocked(useAuth).mockReturnValue({ user: null, canEdit: () => false, canOrganise: () => false, canManage: () => false, hasRole: () => false } as unknown as ReturnType<typeof useAuth>);
  });

  it('keeps the card with directions inside Show full details, closed by default', async () => {
    show({ lorryWhat3Words: 'filled.count.soap', lorryDirectionsNote: 'Second gate on the left' });
    const toggle = screen.getByRole('button', { name: /Show full details/ });
    expect(toggle).toHaveTextContent('horsebox entrance');
    expect(screen.queryByRole('heading', { name: 'Horsebox entrance' })).not.toBeInTheDocument();
    expect(screen.queryByText('Second gate on the left')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByRole('heading', { name: 'Horsebox entrance' })).toBeInTheDocument();
    expect(screen.getByText('Second gate on the left')).toBeInTheDocument();
  });

  it('gives the gate’s directions once, inside Show full details after the venue rows, with every map link', async () => {
    show({ lorryWhat3Words: 'filled.count.soap', lorryLatitude: 52.1, lorryLongitude: -1.5, lorryDirectionsNote: 'Second gate on the left' });
    expect(screen.queryByRole('region', { name: 'Getting there' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Show full details/ });
    await userEvent.click(toggle);
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    const gate = within(panel).getByRole('region', { name: 'Horsebox entrance' });
    expect(within(gate).getByRole('heading', { name: 'Horsebox entrance', level: 3 })).toBeInTheDocument();
    expect(screen.getAllByText(/Second gate on the left/)).toHaveLength(1);
    expect(screen.getAllByText(/filled\.count\.soap/)).toHaveLength(1);
    const links = within(gate).getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(expect.arrayContaining(['Google Maps', 'Apple Maps', 'Waze', expect.stringMatching(/^what3words/)]));
    expect(within(gate).getByRole('link', { name: 'Waze' })).toHaveAttribute('href', 'https://waze.com/ul?ll=52.1,-1.5&navigate=yes');
    // The venue row comes first, the gate closes the panel.
    expect(panel.lastElementChild).toBe(gate);
  });

  it('shows nothing about it when there is no separate gate', () => {
    show({});
    expect(screen.queryByRole('heading', { name: 'Horsebox entrance' })).not.toBeInTheDocument();
  });
});
