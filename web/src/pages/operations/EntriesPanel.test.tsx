import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { EntriesPanel } from './EntriesPanel';

vi.mock('../competition/context', () => ({
  useCompetition: () => ({ competition: { id: 7, name: 'Sample Games', sections: [] }, reload: vi.fn() }),
}));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const entry = (teamId: number, extra = {}) => ({
  teamId, teamName: `Team ${teamId}`, sectionId: 11, sectionName: 'Open teams', isHorsConcours: false,
  status: 0, reason: null, changedAt: null, canReinstate: false, redrawAvailable: false, ...extra,
});

const heat = (heatId: number, teams: number[]) => ({
  heatId, label: `Heat ${heatId}`, orderIndex: heatId,
  teams: teams.map((teamId, index) => ({ teamId, teamName: `Team ${teamId}`, laneIndex: index + 1 })),
});

const preview = {
  sectionId: 11, fingerprint: 'fp-1', hasChanges: true, replayed: false,
  outTeams: [{ teamId: 3, teamName: 'Team 3', status: 1 }],
  notes: ['Morning: 1 heat would be removed.'],
  sessions: [{
    sessionId: 20, name: 'Morning', protectedHeats: 1,
    before: [heat(31, [1, 2]), heat(32, [4])], after: [heat(31, [1, 2, 4])], removedHeatIds: [32],
    moves: [{ teamId: 4, teamName: 'Team 4', fromHeatId: 32, toHeatId: 31 }],
  }],
};

const declaration = (extra = {}) => ({
  id: 90, teamId: 1, teamName: 'Team 1', competitionId: 7, competitionName: 'Sample Games', submittedAt: '2026-10-01T10:00:00Z', isLocked: false,
  riders: [
    { id: 1, fullName: 'Alice Captain', isCaptain: true, isReserve: false, orderIndex: 0 },
    { id: 2, fullName: 'Bea Rider', isCaptain: false, isReserve: false, orderIndex: 1 },
    { id: 3, fullName: 'Cara Reserve', isCaptain: false, isReserve: true, orderIndex: 2 },
  ],
  ...extra,
});

const offline = () => Object.assign(new Error('Network Error'), { response: undefined });
const failure = (status: number, message: string) => Object.assign(new Error(message), { response: { status, data: { message } } });

function mockGet(handlers: Record<string, unknown>) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    for (const [fragment, value] of Object.entries(handlers)) {
      if (url.includes(fragment)) {
        if (value instanceof Error) throw value;
        return { data: value };
      }
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

const renderPanel = (canWrite = true, onTimetableChanged = vi.fn()) =>
  render(<MemoryRouter><EntriesPanel canWrite={canWrite} onTimetableChanged={onTimetableChanged} /></MemoryRouter>);

describe('EntriesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists teams by section with their status and shows the reason to organisers', async () => {
    mockGet({ '/entries': [entry(1), entry(2, { status: 1, reason: 'Pony lame', changedAt: '2026-10-20T09:30:00Z', canReinstate: true, redrawAvailable: true })] });

    renderPanel();

    expect(await screen.findByText('Team 1')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
    expect(screen.getByText(/Pony lame/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reinstate Team 2' })).toBeInTheDocument();
    expect(screen.getByText(/1 team is out/)).toBeInTheDocument();
  });

  it('shows an empty state, a loading state and an offline error with retry', async () => {
    mockGet({ '/entries': [] });
    const first = renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent('Loading teams');
    expect(await screen.findByText('No teams have entered yet.')).toBeInTheDocument();
    first.unmount();

    vi.mocked(api.get).mockRejectedValueOnce(offline());
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    mockGet({ '/entries': [entry(1)] });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Team 1')).toBeInTheDocument();
  });

  it('keeps every write control disabled when the panel is read-only', async () => {
    mockGet({ '/entries': [entry(1)] });
    renderPanel(false);

    expect(await screen.findByText('Team 1')).toBeInTheDocument();
    expect(screen.queryByText(/Edit mode/i)).not.toBeInTheDocument();
    for (const name of ['Withdraw Team 1', 'Mark Team 1 as a no-show', 'Swap a rider for Team 1']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('withdraws a team with a reason, then reloads and refreshes the timetable', async () => {
    const changed = vi.fn();
    mockGet({ '/entries': [entry(1)] });
    vi.mocked(api.put).mockResolvedValue({ data: { team: entry(1, { status: 1 }), heatPlacesChanged: 2, changedSessionIds: [20] } });
    renderPanel(true, changed);

    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw Team 1' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw team' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Say why');
    expect(api.put).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Pony lame');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw team' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/teams/1/entry-status', { status: 1, reason: 'Pony lame' }));
    expect(await screen.findByText(/Team 1 is out of 2 unscored heats/)).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('marks a no-show without needing a reason and reports a lost connection', async () => {
    mockGet({ '/entries': [entry(1)] });
    vi.mocked(api.put).mockRejectedValueOnce(offline());
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Mark Team 1 as a no-show' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as no-show' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('nothing was changed');
    expect(api.put).toHaveBeenCalledWith('/competitions/7/teams/1/entry-status', { status: 2, reason: null });
  });

  it('explains when a team can no longer be reinstated', async () => {
    mockGet({ '/entries': [entry(2, { status: 2, canReinstate: false })] });
    renderPanel();

    expect(await screen.findByText(/can’t be undone here/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reinstate/ })).not.toBeInTheDocument();
  });

  it('reinstates a team and surfaces a refusal from the server', async () => {
    mockGet({ '/entries': [entry(2, { status: 1, reason: 'x', canReinstate: true })] });
    vi.mocked(api.put).mockRejectedValueOnce(failure(409, 'A draw has been applied since this team went out.'));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Reinstate Team 2' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reinstate team' }));

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('A draw has been applied');
  });

  it('previews the re-draw as before and after and applies it with one request id across retries', async () => {
    const changed = vi.fn();
    mockGet({ '/entries': [entry(3, { status: 1, redrawAvailable: true, canReinstate: true })], '/redraw/preview': preview });
    vi.mocked(api.post).mockRejectedValueOnce(offline()).mockResolvedValueOnce({ data: preview });
    renderPanel(true, changed);

    await userEvent.click(await screen.findByRole('button', { name: /Open teams/ }));
    expect(await screen.findByText('Morning')).toBeInTheDocument();
    expect(screen.getByText(/1 heat is scored or started/)).toBeInTheDocument();
    expect(screen.getByText(/Heat 32 \(removed\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 team moves: Team 4/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Apply re-draw' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('can’t apply twice');
    await userEvent.click(screen.getByRole('button', { name: 'Apply re-draw' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(api.post).mock.calls;
    expect(first[0]).toBe('/competitions/7/sections/11/redraw/apply');
    expect(second[1]).toEqual(first[1]);
    expect(first[1]).toMatchObject({ fingerprint: 'fp-1' });
    expect((first[1] as { requestId: string }).requestId).toBeTruthy();
    expect(await screen.findByText(/Re-draw applied/)).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
  });

  it('shows a fresh preview when the timetable changed under the organiser', async () => {
    mockGet({ '/entries': [entry(3, { status: 1, redrawAvailable: true })], '/redraw/preview': preview });
    vi.mocked(api.post).mockRejectedValueOnce(failure(409, 'The timetable changed after this preview. Preview the re-draw again.'));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /Open teams/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Apply re-draw' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Showing a fresh preview');
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => String(url).includes('/redraw/preview'))).toHaveLength(2));
  });

  it('says so when there is nothing to re-draw and offers no Apply', async () => {
    mockGet({ '/entries': [entry(3, { status: 1, redrawAvailable: true })], '/redraw/preview': { ...preview, hasChanges: false, sessions: [], notes: ['The unscored heats are already tidy. Nothing needs to change.'] } });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /Open teams/ }));

    expect(await screen.findByText(/already tidy/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply re-draw' })).not.toBeInTheDocument();
  });

  it('reports a failed preview offline and returns to the list', async () => {
    mockGet({ '/entries': [entry(3, { status: 1, redrawAvailable: true })], '/redraw/preview': offline() });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /Open teams/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    await userEvent.click(screen.getByRole('button', { name: 'Back to entries' }));

    expect(await screen.findByText('Team 3')).toBeInTheDocument();
  });

  it('swaps a rider on an unlocked declaration and lists the audit history', async () => {
    mockGet({
      '/entries': [entry(1)],
      '/declaration-forms/90/swaps': [{ id: 5, declarationFormId: 90, teamId: 1, outRiderEntryId: 1, inRiderEntryId: 3, before: declaration().riders.map((r) => ({ riderEntryId: r.id, fullName: r.fullName })), after: [], actorUserId: 'u', reason: 'Earlier fall', overrodeLock: true, createdAt: '2026-10-20T09:30:00Z', replayed: false }],
      '/declaration-forms': [declaration()],
    });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 6, outRiderEntryId: 2, inRiderEntryId: 3, before: declaration().riders.map((r) => ({ riderEntryId: r.id, fullName: r.fullName })), after: [], reason: '', overrodeLock: false, createdAt: '2026-10-21T09:30:00Z' } });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Swap a rider for Team 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Bea Rider')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByText('Swap history'));
    expect(within(dialog).getByText(/Cara Reserve in for Alice Captain/)).toBeInTheDocument();
    expect(within(dialog).getByText('Earlier fall')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Swap rider' })).toBeDisabled();
    await userEvent.click(within(dialog).getByLabelText('Bea Rider'));
    await userEvent.click(within(dialog).getByLabelText('Cara Reserve'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Swap rider' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/declaration-forms/90/swap', expect.objectContaining({ outRiderEntryId: 2, inRiderEntryId: 3, overrideLock: false, reason: null })));
    expect(await screen.findByText(/Team 1: Cara Reserve in for Bea Rider/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('needs the override box and a reason for a locked declaration', async () => {
    mockGet({ '/entries': [entry(1)], '/declaration-forms/90/swaps': [], '/declaration-forms': [declaration({ isLocked: true })] });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 6, outRiderEntryId: 2, inRiderEntryId: 3, before: [], after: [], reason: 'Lame', overrodeLock: true, createdAt: '2026-10-21T09:30:00Z' } });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Swap a rider for Team 1' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByLabelText('Bea Rider'));
    await userEvent.click(within(dialog).getByLabelText('Cara Reserve'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Swap rider' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('locked');
    await userEvent.click(within(dialog).getByLabelText(/Override the lock/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Swap rider' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason');
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Lame');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Swap rider' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/declaration-forms/90/swap', expect.objectContaining({ overrideLock: true, reason: 'Lame' })));
  });

  it('handles a team with no declaration, no reserve, a failed load and a failed swap', async () => {
    mockGet({ '/entries': [entry(1)], '/declaration-forms': [] });
    const view = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Swap a rider for Team 1' }));
    expect(await screen.findByText(/hasn’t submitted a declaration/)).toBeInTheDocument();
    view.unmount();

    mockGet({ '/entries': [entry(1)], '/declaration-forms/90/swaps': [], '/declaration-forms': [declaration({ riders: declaration().riders.slice(0, 2) })] });
    const second = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Swap a rider for Team 1' }));
    expect(await screen.findByText(/lists no reserve/)).toBeInTheDocument();
    second.unmount();

    mockGet({ '/entries': [entry(1)], '/declaration-forms': offline() });
    const third = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Swap a rider for Team 1' }));
    expect(await screen.findByText(/offline/)).toBeInTheDocument();
    third.unmount();

    mockGet({ '/entries': [entry(1)], '/declaration-forms/90/swaps': [], '/declaration-forms': [declaration()] });
    vi.mocked(api.post).mockRejectedValueOnce(failure(400, 'The rider to bring in isn’t a reserve.')).mockRejectedValueOnce(offline());
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Swap a rider for Team 1' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByLabelText('Bea Rider'));
    await userEvent.click(within(dialog).getByLabelText('Cara Reserve'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Swap rider' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('isn’t a reserve');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Swap rider' }));
    expect(await within(dialog).findByText(/can’t apply twice/)).toBeInTheDocument();
    const [firstTry, retry] = vi.mocked(api.post).mock.calls;
    expect((retry[1] as { requestId: string }).requestId).not.toBe((firstTry[1] as { requestId: string }).requestId);
  });
});
