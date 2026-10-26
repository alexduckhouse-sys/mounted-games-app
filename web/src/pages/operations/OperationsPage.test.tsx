import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { OperationsPage } from './OperationsPage';

const reload = vi.fn();
const auth = vi.hoisted(() => ({ mayOrganise: true }));
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

  it('lets an admin apply a draw with no edit mode to switch on', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    await screen.findByRole('tab', { name: 'Draw' });
    expect(screen.queryByText(/Edit mode/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    expect(await screen.findByRole('button', { name: 'Apply draw' })).toBeEnabled();
  });

  it('previews and applies a deterministic draw', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Dec forms missing');

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
  it('lists only the jobs to sort, then the set-up areas, with no subtitle or filler', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, sessionOverlaps: [{ firstSessionId: 1, firstSessionName: 'Pairs', secondSessionId: 2, secondSessionName: 'Open', arena: 'Arena 1', startsAt: '2031-05-04T09:30:00Z', endsAt: '2031-05-04T10:00:00Z' }] } });
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Blocking publish' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Preparations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'To sort' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Manage' })).toBeInTheDocument();
    expect(screen.getByText('Pairs overlaps Open')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dec forms missing/ })).toHaveAttribute('href', '/competitions/7/entries');
    expect(screen.getByRole('link', { name: /Equipment to check/ })).toHaveTextContent('1');
    // Zero counts are hidden.
    expect(screen.queryByText('Entries not paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Teams short of riders')).not.toBeInTheDocument();
    expect(screen.queryByText(/to sort · checked|Not ready to publish|advisory|Before the day/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Fix/ })).not.toBeInTheDocument();
  });

  it('links each set-up area to its page and marks the ones with jobs', async () => {
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Dec forms missing');

    expect(screen.getByRole('link', { name: 'Event details' })).toHaveAttribute('href', '/competitions/7/event-details');
    expect(screen.getByRole('link', { name: 'Sections and races' })).toHaveAttribute('href', '/competitions/7/sections');
    expect(screen.getByRole('link', { name: 'Sponsors and sharing' })).toHaveAttribute('href', '/competitions/7/sponsors-and-sharing');
    expect(screen.getByRole('link', { name: /Entries and dec forms/ })).toContainElement(screen.getAllByRole('img', { name: 'Has jobs to sort' })[0]);
    expect(screen.getByRole('link', { name: 'Event details' }).querySelector('[role="img"]')).toBeNull();
    expect(screen.getByRole('link', { name: /^Equipment(?! to check)/ })).toHaveAttribute('href', '/competitions/7/equipment');
  });

  it('says so when there is nothing to sort and offers no Blocking publish section', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, missingDeclarations: [], equipmentChecklist: [] } });
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    expect(await screen.findByText('Nothing to sort.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Blocking publish' })).not.toBeInTheDocument();
  });

  it('keeps the last known checks and shows Try again when a refresh fails', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Dec forms missing');

    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Recheck' }));

    expect(await screen.findByText(/Couldn’t refresh · last known/)).toBeInTheDocument();
    expect(screen.getByText('Dec forms missing')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Couldn’t refresh · last known/)).not.toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('shows an alert with Try again when the first load fails', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh the readiness checks');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Dec forms missing')).toBeInTheDocument();
  });

  it('shows the draw as a lane-numbered preview with fairness, rounds and settings behind the overflow', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: wideDraw });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Dec forms missing');
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
    await user.click(screen.getByRole('button', { name: 'Draw settings' }));
    expect(screen.getByRole('dialog', { name: 'Draw settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Draw number')).toBeInTheDocument();
  });

  it('draws again with a new whole-number seed', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: wideDraw });
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Dec forms missing');
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
    await screen.findByText('Dec forms missing');
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await screen.findByRole('button', { name: 'Apply draw' });
    await user.click(screen.getByRole('button', { name: 'Draw settings' }));
    await user.type(screen.getByLabelText('Draw number'), '5');

    expect(screen.queryByRole('button', { name: 'Apply draw' })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('confirms an applied draw without an undo, and Discard clears the preview', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Dec forms missing');
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await user.click(await screen.findByRole('button', { name: 'Apply draw' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Draw applied');
    expect(screen.queryByRole('button', { name: /Undo/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('button', { name: 'Apply draw' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview draw' })).toBeInTheDocument();
  });

  it('clears the preview and explains when the competition changed after it', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    await screen.findByText('Dec forms missing');
    await user.click(screen.getByRole('tab', { name: 'Draw' }));
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await screen.findByRole('button', { name: 'Apply draw' });
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 409 } });
    await user.click(screen.getByRole('button', { name: 'Apply draw' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The competition changed after this preview');
    expect(screen.queryByRole('button', { name: 'Apply draw' })).not.toBeInTheDocument();
  });

  it('keeps the tab strip on wide screens', async () => {
    mockWideScreen(true);
    render(<MemoryRouter><OperationsPage /></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: 'Draw' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'To sort' })).toBeInTheDocument();
  });

  it('opens the Scorers & team tab from ?tab=scorers or by clicking the tab', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/scorer-links')) return { data: { arenas: ['Main arena', 'All arenas'], defaultExpiresAt: '2031-05-06T00:00:00Z', links: [] } } as never;
      if (String(url).endsWith('/team')) return { data: { owner: { id: 'admin-1', fullName: 'Owner', email: 'o@example.com' }, admins: [] } } as never;
      return { data: readiness } as never;
    });
    render(<MemoryRouter initialEntries={['/competitions/7/operations?tab=scorers']}><OperationsPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { level: 1, name: 'Scorers & team' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scorer links' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Competition team' })).toBeInTheDocument();
  });
});
