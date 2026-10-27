import { render, screen } from '@testing-library/react';
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

  it('shows the card with directions when the event has a separate horsebox gate', () => {
    show({ lorryWhat3Words: 'filled.count.soap', lorryDirectionsNote: 'Second gate on the left' });
    expect(screen.getByRole('heading', { name: 'Horsebox entrance' })).toBeInTheDocument();
    expect(screen.getByText('Second gate on the left')).toBeInTheDocument();
  });

  it('shows nothing about it when there is no separate gate', () => {
    show({});
    expect(screen.queryByRole('heading', { name: 'Horsebox entrance' })).not.toBeInTheDocument();
  });
});
