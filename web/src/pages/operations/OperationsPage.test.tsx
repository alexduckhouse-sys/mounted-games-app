import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { OperationsPage } from './OperationsPage';

const reload = vi.fn();
const auth = vi.hoisted(() => ({ mayOrganise: true, editorMode: true }));
vi.mock('../competition/context', () => ({
  useCompetition: () => ({
    competition: { id: 7, sections: [{ id: 11, displayName: 'Open teams' }] },
    reload,
  }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1' },
    canOrganise: () => auth.mayOrganise,
    hasRole: (role: string) => role === 'Admin',
    canEdit: () => auth.editorMode,
  }),
}));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const readiness = {
  competitionId: 7,
  isReady: false,
  equipmentFingerprint: 'equipment-v1',
  missingDeclarations: [{ teamId: 4, teamName: 'Oak A', sectionId: 11, sectionName: 'Open teams' }],
  unpaidSignups: [],
  incompleteTeams: [],
  sessionOverlaps: [],
  equipmentChecklist: [{ key: 'Lane|Pole|4', kind: 'Pole', bucket: 'Lane', count: 4, acknowledged: false, acknowledgedAt: null }],
  equipmentIssues: [],
};

describe('OperationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mayOrganise = true;
    auth.editorMode = true;
    vi.mocked(api.get).mockResolvedValue({ data: readiness });
    vi.mocked(api.put).mockResolvedValue({ data: { ...readiness, equipmentChecklist: [{ ...readiness.equipmentChecklist[0], acknowledged: true }] } });
    vi.mocked(api.post).mockResolvedValue({ data: {
      sectionId: 11,
      seed: 1,
      fingerprint: 'fingerprint',
      fairness: { teamCount: 1, sessionCount: 1, heatSizeSpread: 0, maximumOpponentMeetings: 0, repeatedOpponentPairs: 0, maximumLaneUseSpread: 0, everyTeamAppearsOncePerSession: true, warnings: [] },
      sessions: [{ sessionId: 20, name: 'Morning', heats: [{ heatId: 30, label: 'Heat 1', orderIndex: 1, teams: [{ teamId: 4, teamName: 'Oak A', laneIndex: 1 }] }] }],
    } });
  });

  it('does not load organiser data when the current user lacks access', () => {
    auth.mayOrganise = false;

    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    expect(screen.getByRole('alert')).toHaveTextContent('You don’t have access');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('keeps write controls disabled for an admin in view-only mode', async () => {
    auth.editorMode = false;
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    expect(await screen.findByText(/Switch on Edit mode/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Equipment' }));
    expect(await screen.findByRole('checkbox', { name: /4 × Pole/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save checklist' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    expect(await screen.findByRole('button', { name: 'Apply draw' })).toBeDisabled();
  });

  it('shows readiness issues and saves the equipment checklist', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    expect(await screen.findByText('Oak A needs a declaration')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Equipment' }));
    await user.click(screen.getByRole('checkbox', { name: /4 × Pole/i }));
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/competitions/7/operations/equipment-acknowledgements',
      { acknowledgedKeys: ['Lane|Pole|4'], expectedFingerprint: 'equipment-v1' },
    ));
  });

  it('keeps checklist changes visible when another device saved first', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { status: 409 } });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Equipment' }));
    const checkbox = await screen.findByRole('checkbox', { name: /4 × Pole/i });
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The checklist changed on another device');
    expect(checkbox).toBeChecked();
  });

  it('previews and applies a deterministic draw', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Event checks');

    await user.click(screen.getByRole('button', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    expect(await screen.findByText('Morning')).toBeInTheDocument();
    expect(screen.getByText('Oak A')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply draw' }));

    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith(
      '/competitions/7/sections/11/draw/apply',
      { seed: 1, fingerprint: 'fingerprint' },
    ));
    expect(reload).toHaveBeenCalled();
  });
});
