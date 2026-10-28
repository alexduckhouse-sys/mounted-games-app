import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
// The undo banner has its own tests; here it would only add a second GET to the mocked API.
vi.mock('./DrawUndoBanner', () => ({ DrawUndoBanner: () => null }));

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

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
const at = (path = '/competitions/7/operations') => render(
  <MemoryRouter initialEntries={[path]}>
    <Where />
    <Routes>
      <Route path="/competitions/:id/operations" element={<OperationsPage />} />
      <Route path="/competitions/:id/operations/:tool" element={<OperationsPage />} />
    </Routes>
  </MemoryRouter>,
);

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

    at();

    expect(screen.getByRole('alert')).toHaveTextContent('You don’t have access');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('lets an admin apply a draw with no edit mode to switch on', async () => {
    const user = userEvent.setup();
    at('/competitions/7/operations/draw');

    await screen.findByRole('button', { name: 'Preview draw' });
    expect(screen.queryByText(/Edit mode/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    expect(await screen.findByRole('button', { name: 'Apply draw' })).toBeEnabled();
  });

  it('previews and applies a deterministic draw', async () => {
    const user = userEvent.setup();
    at('/competitions/7/operations/draw');

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
  it('shows the hub with no tab bar: a to-sort line, then the tiles in groups', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, unpaidSignups: [{ signupId: 1, sectionId: 11, sectionName: 'Open teams', amountMinor: 1500 }] } });
    at();

    expect(screen.getByRole('heading', { level: 1, name: 'Before the day' })).toBeInTheDocument();
    expect(screen.getByText('Sample Games')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    const sort = await screen.findByRole('button', { name: /things to sort/ });
    expect(sort).toHaveTextContent('3');
    expect(sort).toHaveTextContent('1 entry not paid · 1 dec form missing · 1 equipment item to check');
    for (const group of ['Set up', 'People', 'On the day', 'Other']) expect(screen.getByRole('heading', { name: group })).toBeInTheDocument();
  });

  it('links every tile to its page, with status lines only where the data is at hand', async () => {
    at();
    await screen.findByRole('button', { name: /things to sort/ });
    const href = (name: string | RegExp) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href(/^Event details/)).toBe('/competitions/7/event-details');
    expect(href(/^Sections and races/)).toBe('/competitions/7/sections');
    expect(href(/^Timetable and draw/)).toBe('/competitions/7/timetable-and-draw');
    expect(href(/^Equipment/)).toBe('/competitions/7/equipment');
    expect(href(/^Sponsors and sharing/)).toBe('/competitions/7/sponsors-and-sharing');
    expect(href(/^Rulebooks/)).toBe('/competitions/7/rulebooks');
    expect(href(/^Entries and dec forms/)).toBe('/competitions/7/entries');
    expect(href(/^Import teams/)).toBe('/competitions/7/operations/import');
    expect(href(/^Volunteers/)).toBe('/competitions/7/operations/volunteers');
    expect(href(/^Scorers and team/)).toBe('/competitions/7/operations/scorers');
    expect(href(/^Emergency contacts/)).toBe('/competitions/7/operations/safety');
    expect(href(/^Tack check/)).toBe('/competitions/7/operations/tack');
    expect(href(/^Passport check/)).toBe('/competitions/7/operations/passport');
    expect(href(/^Protests/)).toBe('/competitions/7/operations/protests');
    expect(href(/^Print sheets/)).toBe('/competitions/7/operations/print');
    expect(href(/^Results book/)).toBe('/competitions/7/operations/results');
    expect(screen.getByRole('link', { name: /^Entries and dec forms/ })).toHaveTextContent('1 dec form missing');
    expect(screen.getByRole('link', { name: /^Equipment/ })).toHaveTextContent('1 to check');
    expect(screen.getByRole('link', { name: /^Sponsors and sharing/ })).toHaveTextContent(/^Sponsors and sharing$/);
    expect(screen.getByRole('link', { name: /^Sections and races/ })).toHaveTextContent('2 sections');
  });

  it('opens the to-sort rows in place, blocking clashes first', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, sessionOverlaps: [{ firstSessionId: 1, firstSessionName: 'Pairs', secondSessionId: 2, secondSessionName: 'Open', arena: 'Arena 1', startsAt: '2031-05-04T09:30:00Z', endsAt: '2031-05-04T10:00:00Z' }] } });
    const user = userEvent.setup();
    at();
    const sort = await screen.findByRole('button', { name: /things to sort/ });
    expect(sort).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Pairs overlaps Open')).not.toBeVisible();
    await user.click(sort);

    expect(sort).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Blocking publish' })).toBeInTheDocument();
    expect(screen.getByText('Pairs overlaps Open')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dec forms missing/ })).toHaveAttribute('href', '/competitions/7/entries');
    expect(screen.getByRole('link', { name: /Equipment to check/ })).toHaveTextContent('1');
    expect(screen.queryByText('Entries not paid')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/competitions\/7\/operations$/);
    await user.click(sort);
    expect(screen.getByText('Pairs overlaps Open')).not.toBeVisible();
  });

  it('says so calmly when there is nothing to sort', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, missingDeclarations: [], equipmentChecklist: [] } });
    at();
    expect(await screen.findByText('Nothing to sort')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /to sort/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Blocking publish' })).not.toBeInTheDocument();
  });

  it('keeps the last known checks and shows Try again when a refresh fails', async () => {
    const user = userEvent.setup();
    at();
    await screen.findByRole('button', { name: /things to sort/ });

    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Recheck' }));

    expect(await screen.findByText(/Couldn’t refresh · last known/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /things to sort/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Couldn’t refresh · last known/)).not.toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('shows an alert with Try again when the first load fails, with the tiles still there', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    at();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh the readiness checks');
    expect(screen.getByRole('link', { name: /^Print sheets/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /things to sort/ })).toBeInTheDocument();
  });

  it('offers Duplicate event only to an Admin or Trainer', async () => {
    at();
    expect(await screen.findByRole('link', { name: /^Duplicate event/ })).toHaveAttribute('href', '/competitions/7/operations/duplicate');
  });

  it('shows the draw as a lane-numbered preview with fairness, rounds and settings behind the overflow', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: wideDraw });
    const user = userEvent.setup();
    at('/competitions/7/operations/draw');
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
    at('/competitions/7/operations/draw');
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
    at('/competitions/7/operations/draw');
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await screen.findByRole('button', { name: 'Apply draw' });
    await user.click(screen.getByRole('button', { name: 'Draw settings' }));
    await user.type(screen.getByLabelText('Draw number'), '5');

    expect(screen.queryByRole('button', { name: 'Apply draw' })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('confirms an applied draw without an undo, and Discard clears the preview', async () => {
    const user = userEvent.setup();
    at('/competitions/7/operations/draw');
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
    at('/competitions/7/operations/draw');
    await user.click(screen.getByRole('button', { name: 'Preview draw' }));
    await screen.findByRole('button', { name: 'Apply draw' });
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 409 } });
    await user.click(screen.getByRole('button', { name: 'Apply draw' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The competition changed after this preview');
    expect(screen.queryByRole('button', { name: 'Apply draw' })).not.toBeInTheDocument();
  });

  it('opens a tool on its own page with Back to the hub', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/scorer-links')) return { data: { arenas: ['Main arena', 'All arenas'], defaultExpiresAt: '2031-05-06T00:00:00Z', links: [] } } as never;
      if (String(url).endsWith('/team')) return { data: { owner: { id: 'admin-1', fullName: 'Owner', email: 'o@example.com' }, admins: [] } } as never;
      return { data: readiness } as never;
    });
    at('/competitions/7/operations/scorers');

    expect(await screen.findByRole('heading', { level: 1, name: 'Scorers and team' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scorer links' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Competition team' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Before the day' })).toHaveAttribute('href', '/competitions/7/operations');
    expect(screen.queryByText('Nothing to sort')).not.toBeInTheDocument();
  });

  it('redirects old ?tab= links to the tool page, and unknown ones to the hub', async () => {
    const { unmount } = at('/competitions/7/operations?tab=print');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/competitions/7/operations/print'));
    expect(screen.getByTestId('where')).not.toHaveTextContent('tab=');
    unmount();
    at('/competitions/7/operations?tab=checks');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/competitions\/7\/operations$/));
    expect(screen.getByRole('heading', { level: 1, name: 'Before the day' })).toBeInTheDocument();
  });

  it('sends an unknown tool back to the hub', async () => {
    at('/competitions/7/operations/nonsense');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/competitions\/7\/operations$/));
  });
});

describe('OperationsPage without the Admin or Trainer role', () => {
  it('hides Duplicate event and sends its page back to the hub', async () => {
    vi.resetModules();
    vi.doMock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, canOrganise: () => true, hasRole: () => false }) }));
    const { OperationsPage: Page } = await import('./OperationsPage');
    render(<MemoryRouter initialEntries={['/competitions/7/operations/duplicate']}><Routes>
      <Route path="/competitions/:id/operations" element={<Page />} />
      <Route path="/competitions/:id/operations/:tool" element={<Page />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Before the day' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Duplicate event/ })).not.toBeInTheDocument();
    vi.doUnmock('../../auth/AuthContext');
  });
});
