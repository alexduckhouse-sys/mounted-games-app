import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { DetailsTab } from './DetailsTab';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./CompetitionTeamCard', () => ({ CompetitionTeamCard: () => null }));
vi.mock('../commerce/DemoEntryPayment', () => ({ DemoEntryPayment: () => null }));

const auth = vi.hoisted(() => ({ organise: false }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    canEdit: () => false,
    canManage: () => false,
    canManageEntries: () => false,
    canOrganise: () => auth.organise,
    hasRole: () => false,
  }),
}));
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  useCompetition: () => ({
    reload: vi.fn(),
    competition: {
      id: 12, name: 'Spring Games', startDate: '2031-05-04T09:00:00Z', endDate: null, isActive: true, isArchived: false,
      sections: [], teams: [], sessions: [], createdByUserId: 'owner',
    },
  }),
}));

beforeEach(() => {
  auth.organise = false;
  vi.mocked(api.get).mockResolvedValue({ data: [] });
});

function renderTab() {
  return render(<MemoryRouter><DetailsTab /></MemoryRouter>);
}

describe('Details tab sharing links', () => {
  it('gives everyone an add-to-calendar download that carries this site’s address', () => {
    renderTab();
    const link = screen.getByRole('link', { name: 'Add to calendar' });
    expect(link).toHaveAttribute('href', `/api/competitions/12/calendar.ics?site=${encodeURIComponent(window.location.origin)}`);
  });

  it('shows the venue poster link to organisers only', () => {
    renderTab();
    expect(screen.queryByRole('link', { name: 'Print venue poster' })).not.toBeInTheDocument();
  });

  it('links organisers and helpers to the venue poster', () => {
    auth.organise = true;
    renderTab();
    expect(screen.getByRole('link', { name: 'Print venue poster' })).toHaveAttribute('href', '/event-tools/12/print/poster');
  });
});
