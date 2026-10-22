import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { OperationsPage } from './OperationsPage';

const reload = vi.fn();
const auth = vi.hoisted(() => ({ mayOrganise: true, editorMode: true }));
vi.mock('../competition/context', () => ({
  useCompetition: () => ({
    competition: { id: 7, name: 'Sample Games', sections: [{ id: 11, displayName: 'Open teams' }, { id: 12, displayName: 'Under 14' }] },
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

const wideDraw = {
  sectionId: 11,
  seed: 1,
  fingerprint: 'fingerprint',
  fairness: { teamCount: 4, sessionCount: 2, heatSizeSpread: 0, maximumOpponentMeetings: 3, repeatedOpponentPairs: 1, maximumLaneUseSpread: 1, everyTeamAppearsOncePerSession: true, warnings: ['Two teams share a lane twice.'] },
  sessions: [
    { sessionId: 20, name: 'Morning', heats: [{ heatId: 30, label: 'Heat 1', orderIndex: 1, teams: [{ teamId: 4, teamName: 'Oak A', laneIndex: 1 }, { teamId: 5, teamName: 'Elm B', laneIndex: 2 }] }] },
    { sessionId: 21, name: 'Afternoon', heats: [{ heatId: 31, label: 'Heat 2', orderIndex: 1, teams: [{ teamId: 5, teamName: 'Elm B', laneIndex: 1 }, { teamId: 4, teamName: 'Oak A', laneIndex: 2 }] }] },
  ],
};

function mockWideScreen(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

describe('OperationsPage', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

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
    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    expect(await screen.findByRole('checkbox', { name: /4 × Pole/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save checklist' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    expect(await screen.findByRole('button', { name: 'Apply draw' })).toBeDisabled();
  });

  it('shows readiness issues and saves the equipment checklist', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    expect(await screen.findByText('Oak A needs a declaration')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
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

    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    const checkbox = await screen.findByRole('checkbox', { name: /4 × Pole/i });
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The checklist changed on another device');
    expect(checkbox).toBeChecked();
  });

  it('clears an old save error when the checks are reloaded', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { status: 409 } });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    await user.click(await screen.findByRole('checkbox', { name: /4 × Pole/i }));
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The checklist changed on another device');

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: /Recheck/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('shows a failed refresh on the equipment view too, not only when nothing has loaded', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    await screen.findByRole('checkbox', { name: /4 × Pole/i });
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: /Recheck/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh the readiness checks');
  });

  it('previews and applies a deterministic draw', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Oak A needs a declaration');

    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    expect(await screen.findByText('Morning')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Heat 1' })).toHaveTextContent('Oak A');
    await user.click(screen.getByRole('button', { name: 'Apply draw' }));

    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith(
      '/competitions/7/sections/11/draw/apply',
      { seed: 1, fingerprint: 'fingerprint' },
    ));
    expect(reload).toHaveBeenCalled();
  });
  it('groups readiness rows by priority and keeps finished checks under Done', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, sessionOverlaps: [{ firstSessionId: 1, firstSessionName: 'Pairs', secondSessionId: 2, secondSessionName: 'Open', arena: 'Arena 1', startsAt: '2031-05-04T09:30:00Z', endsAt: '2031-05-04T10:00:00Z' }] } });
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Blocking publish' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Before the day' })).toBeInTheDocument();
    expect(screen.getByText('Pairs overlaps Open')).toBeInTheDocument();
    expect(screen.getByText(/Not ready to publish · checked/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix 1 clash' })).toHaveAttribute('href', '/competitions/7');
    expect(screen.getByText('Checks are advisory. They don’t stop you publishing.')).toBeInTheDocument();
    expect(screen.getByText('Done').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('No unpaid entries')).toBeInTheDocument();
    expect(screen.queryByText(/export/i)).not.toBeInTheDocument();
  });

  it('offers no Fix button when nothing clashes', async () => {
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Oak A needs a declaration');
    expect(screen.queryByRole('link', { name: /Fix/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Blocking publish' })).not.toBeInTheDocument();
  });

  it('keeps the last known checks and shows Retry on the payments row when a refresh fails', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Oak A needs a declaration');

    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: /Recheck/ }));

    expect(await screen.findByText(/Couldn’t refresh · last known/)).toBeInTheDocument();
    expect(screen.getByText('Oak A needs a declaration')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText(/Couldn’t refresh · last known/)).not.toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('shows an alert with Try again when the first load fails', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh the readiness checks');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Oak A needs a declaration')).toBeInTheDocument();
  });

  it('shows the draw as a lane-numbered preview with fairness, rounds and settings behind the overflow', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: wideDraw });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Oak A needs a declaration');
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Open teams' })).toBeInTheDocument();
    expect(screen.getByText('4 teams · 2 lanes · 2 rounds')).toBeInTheDocument();
    expect(screen.getByText('2 to check')).toBeInTheDocument();
    expect(screen.getByText(/1 passed/)).toBeInTheDocument();
    expect(screen.getByText('Two teams share a lane twice.')).toBeInTheDocument();
    expect(screen.getByText('Fairness').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Lane spread by team').closest('details')).not.toHaveAttribute('open');
    const heat = screen.getByRole('list', { name: 'Heat 1' });
    expect(heat.tagName).toBe('OL');
    expect(heat).toHaveTextContent('1Oak A');
    expect(screen.getByRole('button', { name: 'Round 1' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Round 2' }));
    expect(screen.getByText('Afternoon')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Heat 2' })).toHaveTextContent('1Elm B');
    expect(screen.getByText(/Publishing is a separate step/)).toBeInTheDocument();
    // Settings are not on the page until the overflow opens them.
    expect(screen.queryByLabelText('Draw number')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('dialog', { name: 'Draw settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Draw number')).toBeInTheDocument();
  });

  it('draws again with a new whole-number seed', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: wideDraw });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Oak A needs a declaration');
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await user.click(await screen.findByRole('button', { name: 'New seed' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const body = vi.mocked(api.post).mock.calls[1][1] as { seed: number };
    expect(Number.isSafeInteger(body.seed)).toBe(true);
    expect(body.seed).toBeGreaterThanOrEqual(10_000);
  });

  it('drops a stale preview when the draw number changes in settings', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: wideDraw });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Oak A needs a declaration');
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await screen.findByRole('button', { name: 'Apply draw' });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.type(screen.getByLabelText('Draw number'), '5');

    expect(screen.queryByRole('button', { name: 'Apply draw' })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('confirms an applied draw without an undo, and Discard clears the preview', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Oak A needs a declaration');
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await user.click(await screen.findByRole('button', { name: 'Apply draw' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Draw applied.');
    expect(screen.queryByRole('button', { name: /Undo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('button', { name: 'Apply draw' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview draw' })).toBeInTheDocument();
  });

  it('clears the preview and explains when the competition changed after it', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Oak A needs a declaration');
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await screen.findByRole('button', { name: 'Apply draw' });
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 409 } });
    await user.click(screen.getByRole('button', { name: 'Apply draw' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The competition changed after this preview');
    expect(screen.queryByRole('button', { name: 'Apply draw' })).not.toBeInTheDocument();
  });

  it('shows the wide-screen desk with grouped issue rows and a single Blocks publish tag', async () => {
    mockWideScreen(true);
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, sessionOverlaps: [{ firstSessionId: 1, firstSessionName: 'Pairs', secondSessionId: 2, secondSessionName: 'Open', arena: 'Arena 1', startsAt: '2031-05-04T09:30:00Z', endsAt: '2031-05-04T10:00:00Z' }] } });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'To resolve' })).toBeInTheDocument();
    expect(screen.getAllByText('Blocks publish')).toHaveLength(1);
    expect(screen.getByRole('columnheader', { name: /Arena clashes · 1 · block publishing/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Missing declarations · 1/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Equipment' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Equipment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recheck now' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Declarations 1' }));
    expect(screen.getByRole('tab', { name: 'Declarations 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('columnheader', { name: /Arena clashes/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open declarations for Oak A/ })).toHaveAttribute('href', '/competitions/7/declarations');
  });

  it('saves the equipment checklist from the wide-screen card', async () => {
    mockWideScreen(true);
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await user.click(await screen.findByRole('checkbox', { name: /4 × Pole/i }));
    await user.click(screen.getByRole('button', { name: 'Save checklist' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/competitions/7/operations/equipment-acknowledgements',
      { acknowledgedKeys: ['Lane|Pole|4'], expectedFingerprint: 'equipment-v1' },
    ));
  });
});
