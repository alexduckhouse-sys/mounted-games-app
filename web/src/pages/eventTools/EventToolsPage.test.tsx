import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { Role } from '../../types';
import { OperationsPage } from '../operations/OperationsPage';
import EventToolsPage from './EventToolsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const compState = vi.hoisted(() => ({
  competition: {
    id: 12,
    name: 'Spring event',
    startDate: '2031-05-04T09:00:00Z',
    endDate: null as string | null,
    createdByUserId: 'owner',
    sections: [{ id: 8, displayName: 'Under 12' }],
  },
  reload: vi.fn(),
}));
vi.mock('../competition/context', () => ({
  useCompetition: () => compState,
}));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const readiness = {
  competitionId: 12,
  isReady: true,
  equipmentFingerprint: 'equipment-v1',
  missingDeclarations: [],
  unpaidSignups: [],
  incompleteTeams: [],
  sessionOverlaps: [],
  equipmentChecklist: [],
  equipmentIssues: [],
};

function renderPage(initialEntry = '/event-tools/12') {
  const router = createMemoryRouter([
    { path: '/event-tools/:competitionId', element: <EventToolsPage /> },
    { path: '/competitions/:id/operations', element: <OperationsPage /> },
  ], { initialEntries: [initialEntry] });
  return { ...render(<RouterProvider router={router} />), router };
}

beforeEach(() => {
  compState.competition = {
    id: 12,
    name: 'Spring event',
    startDate: '2031-05-04T09:00:00Z',
    endDate: null,
    createdByUserId: 'owner',
    sections: [{ id: 8, displayName: 'Under 12' }],
  };
  compState.reload.mockReset();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'owner' },
    canOrganise: () => true,
    hasRole: (role: Role) => role === 'Trainer',
    canEdit: () => false,
  } as unknown as ReturnType<typeof useAuth>);
  get.mockResolvedValue({ data: readiness });
  post.mockReset();
});

describe('EventToolsPage merged into OperationsPage', () => {
  it('redirects /event-tools/:id straight to /competitions/:id/operations', async () => {
    const { router } = renderPage('/event-tools/12');
    await waitFor(() => expect(router.state.location.pathname).toBe('/competitions/12/operations'));
    expect(await screen.findByRole('tab', { name: 'Import teams' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tack check' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Passport check' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Print sheets' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Results book' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Duplicate event' })).toBeInTheDocument();
  });

  it('turns away someone who does not run this competition', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'visitor' }, canOrganise: () => false, hasRole: (role: Role) => role === 'Member', canEdit: () => false,
    } as unknown as ReturnType<typeof useAuth>);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('You don’t have access to competition operations.');
  });

  it('gives a competition admin with a Member account import and print, but not duplicating', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'helper' }, canOrganise: () => true, hasRole: (role: Role) => role === 'Member', canEdit: () => false,
    } as unknown as ReturnType<typeof useAuth>);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Import teams' }));
    expect(await screen.findByLabelText('CSV text')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Print sheets' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Duplicate event' })).not.toBeInTheDocument();
  });

  it('previews CSV rows before applying the same fingerprint', async () => {
    post.mockImplementation(async (url) => {
      if (String(url).endsWith('/preview')) return { data: { previewVersion: 1, fingerprint: 'ABC', totalRows: 1, validRows: 1, rows: [{ rowNumber: 2, clubId: 4, club: 'North Club', suffix: 'A', competitionSectionId: 8, section: 'Under 12', teamName: 'North Club A', errors: [] }] } };
      return { data: { createdCount: 1, teamIds: [44] } };
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Import teams' }));
    const input = await screen.findByLabelText('CSV text');
    await user.clear(input);
    await user.type(input, 'club,suffix,section\nNorth Club,A,Under 12');
    await user.click(screen.getByRole('button', { name: 'Preview teams' }));
    expect(await screen.findByText('North Club')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add 1 team' }));

    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/event-tools/competitions/12/team-import/apply', {
      csv: 'club,suffix,section\nNorth Club,A,Under 12', fingerprint: 'ABC', previewVersion: 1,
    }));
    expect(await screen.findByText('1 team added.')).toBeInTheDocument();
    expect(compState.reload).toHaveBeenCalled();
  });

  it('keeps duplicate-event form values when the API rejects them', async () => {
    post.mockRejectedValue({ response: { data: { detail: 'Those dates overlap another event.' } } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Duplicate event' }));
    const name = await screen.findByLabelText('New competition name');
    await user.clear(name);
    await user.type(name, 'Autumn championship');
    await user.click(screen.getByRole('button', { name: 'Duplicate setup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Those dates overlap another event.');
    expect(name).toHaveValue('Autumn championship');
  });

  it('lists the print sheets as links from the Print sheets tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Print sheets' }));
    expect(screen.getByRole('tab', { name: 'Print sheets' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'Back to event' })).toHaveAttribute('href', '/competitions/12');
    expect(screen.getByRole('link', { name: /Draw and lanes/ })).toHaveAttribute('href', '/event-tools/12/print/draw');
    expect(screen.getByRole('link', { name: /Score sheets/ })).toHaveAttribute('href', '/event-tools/12/print/score-sheets');
    expect(screen.getByRole('link', { name: /Results/ })).toHaveAttribute('href', '/event-tools/12/print/results');
    expect(screen.getByRole('link', { name: /Venue poster/ })).toHaveAttribute('href', '/event-tools/12/print/poster');
  });

  it('marks failing import rows with a word as well as colour and blocks adding them', async () => {
    post.mockResolvedValue({ data: {
      previewVersion: 1, fingerprint: 'ABC', totalRows: 2, validRows: 1,
      rows: [
        { rowNumber: 2, clubId: 4, club: 'North Club', suffix: 'A', competitionSectionId: 8, section: 'Under 12', teamName: 'North Club A', errors: [] },
        { rowNumber: 3, clubId: null, club: 'Nowhere', suffix: 'B', competitionSectionId: 8, section: 'Under 12', teamName: 'Nowhere B', errors: ['Club not found.'] },
      ],
    } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Import teams' }));
    await user.click(await screen.findByRole('button', { name: 'Preview teams' }));

    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Fix')).toBeInTheDocument();
    expect(screen.getByText('Club not found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add 1 team' })).toBeDisabled();
  });

  it('shows the copied counts and a link to the new event after duplicating', async () => {
    post.mockResolvedValue({ data: { competitionId: 99, name: 'Spring event copy', sections: 2, teams: 8, sessions: 3, heats: 6, races: 12 } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Duplicate event' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate setup' }));

    expect(await screen.findByText('2 sections, 8 teams and 6 heats copied.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Spring event copy/ })).toHaveAttribute('href', '/admin/competitions/99');
    expect(screen.getByRole('status')).toHaveTextContent('Spring event copy is ready to edit.');
  });
});
