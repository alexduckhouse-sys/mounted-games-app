import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axiosError, heat, race, result, session } from '../test/factories';
import type { Heat, ScorerSession, StreamCommand } from '../types';
import { HEAT_SAVED, updateOutbox } from '../offline/useScoreOutbox';
import { createReplayBuffer } from '../live/replayBuffer';
import { asMedia, FakeMediaStream } from '../test/streamFakes';
import { chooseOption } from '../test/select';
import { ScorerPage } from './ScorerPage';
import { readSavedScorerSession } from '../offline/scorerLink';

const link = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn() }));
vi.mock('../live/replayBuffer', async (original) => { const actual = await original<typeof import('../live/replayBuffer')>(); return { ...actual, createReplayBuffer: vi.fn(actual.createReplayBuffer) }; });
const tripod = vi.hoisted(() => ({ handlers: {} as import('../live/useLiveHub').LiveHandlers, create: vi.fn() }));
vi.mock('../live/useLiveHub', () => ({ useLiveHub: (_id: number, handlers: import('../live/useLiveHub').LiveHandlers) => { tripod.handlers = handlers; return { connected: true }; } }));
vi.mock('../live/streamPublisher', async (original) => ({ ...await original<typeof import('../live/streamPublisher')>(), createStreamPublisher: tripod.create }));
vi.mock('../offline/scorerLink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../offline/scorerLink')>()),
  scorerApi: link,
}));

const entries = [1, 2, 3].map((n) => ({ id: n, teamId: n, teamName: `Team ${n}`, laneIndex: n }));
const heatWith = (over: Partial<Heat> = {}) => heat(1, { label: 'Heat 1', entries, races: [race(11, { name: 'Bending' }), race(12, { name: 'Flag' })], ...over });
const timetable = (over: Partial<ScorerSession> = {}): ScorerSession => ({
  label: 'Sam', competitionId: 1, competitionName: 'Spring Games', arenaName: 'Main', expiresAt: '2999-01-01T00:00:00Z',
  sessions: [session(1, { arenaName: 'Main', heats: [heatWith()] })], ...over,
});
const outbox = () => JSON.parse(localStorage.getItem('mg.outbox.scores') ?? '[]') as Array<Record<string, unknown>>;

const placed = () => screen.queryAllByLabelText(/^Place \d+$/).length;
const opened = (name: string) => screen.findByRole('region', { name: `Scoring ${name}` });

/**
 * Taps teams in order. A row's tap is detected by framer-motion from pointer events, which a slow CI machine
 * can miss, so each tap is checked by the number of placed teams and repeated if it didn't register.
 */
async function tapTeams(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  for (const [index, name] of names.entries()) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${name}, lane`) }));
      try {
        await waitFor(() => expect(placed()).toBe(index + 1), { timeout: 1500 });
        break;
      } catch {
        // The tap never registered (nothing changed), so tapping again can't undo it.
      }
    }
    await waitFor(() => expect(placed()).toBe(index + 1));
  }
}

function open(hash = '#t=mgs_token') {
  window.history.replaceState(null, '', `/score${hash}`);
  return render(<ScorerPage />);
}

beforeEach(() => {
  link.get.mockReset();
  link.post.mockReset();
  link.get.mockResolvedValue({ data: timetable() });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); // keep the outbox from sending during these tests
  // An earlier test's sheet saves its choice after the exit delay; start each test with the question unanswered.
  localStorage.removeItem('mg.commentatorScoring.1');
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

describe('ScorerPage', () => {
  it('imports a backup using scorer-link credentials', async () => {
    open();
    await opened('Bending');
    await userEvent.click(screen.getByText('Import scores from another phone'));
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: JSON.stringify([{
      raceId: 11, competitionId: 1, sessionId: 1, label: 'Synthetic race',
      places: [{ teamId: 1, place: 1, eliminated: false }], expected: [], teamNames: { 1: 'Synthetic Team' },
      queuedAt: '2026-06-01T10:00:00Z', state: 'waiting', viaLink: false,
    }]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Add scores' }));

    expect(outbox()).toEqual([expect.objectContaining({ raceId: 11, viaLink: true })]);
  });

  it('asks for the link when the phone has none', () => {
    open('');
    expect(screen.getByRole('alert')).toHaveTextContent('No scorer link on this phone');
    expect(link.get).not.toHaveBeenCalled();
  });

  it('keeps the token from the address, tidies the address bar and shows the arena', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Spring Games · Main' })).toBeInTheDocument();
    expect(localStorage.getItem('mg.scorer.token')).toBe('mgs_token');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/score');
    expect(link.get).toHaveBeenCalledWith('/scorer/session');
    expect(screen.getByText('Scoring as Sam')).toBeInTheDocument();
    expect(await opened('Bending')).toBeInTheDocument();
    // No clock or sign-off controls for a link.
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sign off/i)).not.toBeInTheDocument();
  });

  it('uses the token already on the phone when the address has none', async () => {
    localStorage.setItem('mg.scorer.token', 'mgs_stored');
    open('');
    expect(await screen.findByText('Scoring as Sam')).toBeInTheDocument();
  });

  it('saves a race to the phone’s outbox for the link, then moves to the next race', async () => {
    const user = userEvent.setup();
    open();
    await opened('Bending');

    await tapTeams(user, ['Team 2', 'Team 1', 'Team 3']);
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));

    expect(outbox()).toEqual([expect.objectContaining({
      viaLink: true, raceId: 11, competitionId: 1, sessionId: 1, state: 'waiting', label: 'Heat 1 · Bending',
      places: [{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 2, eliminated: false }, { teamId: 3, place: 3, eliminated: false }],
    })]);
    expect(await opened('Flag')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('saved on this phone');
  });

  it('asks for a reason before correcting a race that already has results', async () => {
    const user = userEvent.setup();
    link.get.mockResolvedValue({ data: timetable({ sessions: [session(1, { arenaName: 'Main', heats: [heatWith({
      races: [race(11, { name: 'Bending', isComplete: true, results: [result(1, 1), result(2, 2), result(3, 3)] }), race(12, { name: 'Flag' })],
    })] })] }) });
    open();
    await opened('Flag');
    await user.click(screen.getByRole('button', { name: 'Previous race' }));
    await opened('Bending');
    // The saved placings are there to correct.
    expect(placed()).toBe(3);
    // A saved race is read only until the scorer chooses to edit it.
    expect(screen.queryByRole('button', { name: 'SAVE SCORES' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit this race' }));

    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add a reason for this correction');
    expect(outbox()).toEqual([]);

    await user.type(screen.getByLabelText('Reason for correction'), 'Judge changed it');
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    expect(outbox()).toEqual([expect.objectContaining({ raceId: 11, reason: 'Judge changed it', expected: expect.any(Array) })]);
  });

  it('can clear a corrected race’s placings to start again', async () => {
    const user = userEvent.setup();
    link.get.mockResolvedValue({ data: timetable({ sessions: [session(1, { arenaName: 'Main', heats: [heatWith({
      races: [race(11, { name: 'Bending', isComplete: true, results: [result(1, 1), result(2, 2), result(3, 3)] })],
    })] })] }) });
    open();
    await opened('Bending');
    await user.click(screen.getByRole('button', { name: 'Edit this race' }));
    await user.click(screen.getByRole('button', { name: /Clear/ }));
    expect(placed()).toBe(0);
  });

  it('lists the teams in lane order with a hatband-style band down the left', async () => {
    const bibbed = [
      { id: 1, teamId: 1, teamName: 'Team 1', laneIndex: 3, bibColour: 'Red' },
      { id: 2, teamId: 2, teamName: 'Team 2', laneIndex: 1, bibColour: 'Green' },
      { id: 3, teamId: 3, teamName: 'Team 3', laneIndex: 2 },
    ];
    link.get.mockResolvedValue({ data: timetable({ sessions: [session(1, { arenaName: 'Main', heats: [heatWith({ entries: bibbed })] })] }) });
    open();
    const region = await opened('Bending');
    const rows = within(region).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows[0]).toMatch(/L1.*Team 2/);
    expect(rows[1]).toMatch(/L2.*Team 3/);
    expect(rows[2]).toMatch(/L3.*Team 1/);
    expect(region.querySelectorAll('.sc-band')).toHaveLength(3);
  });

  it('opens on the session running in this arena, ahead of an earlier one left unfinished', async () => {
    link.get.mockResolvedValue({ data: timetable({ sessions: [
      session(1, { arenaName: 'Main', status: 0, heats: [heatWith({ races: [race(21, { name: 'Sack race' })] })] }),
      session(2, { arenaName: 'Main', status: 1, heats: [heat(2, { label: 'Heat 1', entries, races: [race(31, { name: 'Mug race' })] })] }),
    ] }) });
    open();
    expect(await opened('Mug race')).toBeInTheDocument();
  });

  it('asks why an eliminated team is out and records the reason, while having no HC button', async () => {
    const user = userEvent.setup();
    open();
    await opened('Bending');
    await tapTeams(user, ['Team 1']);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Team 2, lane/ }), { key: 'Delete' });
    await user.click(screen.getByRole('button', { name: /^Team 3, lane/ }));
    await waitFor(() => expect(placed()).toBe(2));
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why were teams eliminated?' });
    // The official faults sit in a grid, with the non-finishes and Other in their own group after them.
    const reasons = within(sheet).getByRole('group', { name: 'Reason for Team 2' });
    expect(reasons).toHaveClass('sc-reasons');
    expect(within(reasons).getByRole('button', { name: 'Hatband on wrong rider' })).not.toHaveAttribute('data-kind');
    expect(within(reasons).getAllByRole('button').filter((b) => b.dataset.kind === 'finish').map((b) => b.textContent))
      .toEqual(['Did not start', 'Did not finish', 'Retired', 'Other']);
    await user.click(within(sheet).getByRole('button', { name: 'Did not start' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save race' }));
    expect(outbox()[0].places).toEqual([
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 2, place: 0, eliminated: true, status: 2, refereeNote: 'Did not start' },
      { teamId: 3, place: 2, eliminated: false },
    ]);
    expect(screen.queryByRole('button', { name: /hors concours/i })).not.toBeInTheDocument();
  });

  it('undoes a tap, and cancels a save that is still waiting on the phone', async () => {
    const user = userEvent.setup();
    open();
    await opened('Bending');
    await tapTeams(user, ['Team 2', 'Team 1', 'Team 3']);
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(placed()).toBe(2));
    await user.click(screen.getByRole('button', { name: /^Team 3, lane/ }));
    await waitFor(() => expect(placed()).toBe(3));
    await user.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
    await opened('Flag');
    expect(outbox()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Undo last save' }));
    await opened('Bending');
    expect(outbox()).toHaveLength(0);
    expect(placed()).toBe(3);
  });

  it('says so when the phone can’t store the scores', async () => {
    const user = userEvent.setup();
    open();
    await opened('Bending');
    await tapTeams(user, ['Team 1', 'Team 2', 'Team 3']);
    const save = await screen.findByRole('button', { name: 'SAVE SCORES' }, { timeout: 5000 });
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('full'); };
    try {
      await user.click(save);
    } finally { Storage.prototype.setItem = set; }
    expect(screen.getByRole('alert')).toHaveTextContent('couldn’t be saved on this phone');
  });

  it('offers a choice of heat and session', async () => {
    const user = userEvent.setup();
    link.get.mockResolvedValue({ data: timetable({ sessions: [
      session(1, { name: 'Pairs', arenaName: 'Main', orderIndex: 1, heats: [heatWith({ id: 1 }), heatWith({ id: 2, label: 'Heat 2', orderIndex: 2, races: [race(21, { name: 'Mug' })] })] }),
      session(2, { name: 'Teams', arenaName: 'Main', orderIndex: 2, heats: [heatWith({ id: 3, label: 'Final', races: [race(31, { name: 'Ball' })] })] }),
      session(3, { name: 'Lunch', arenaName: 'Main', orderIndex: 3, kind: 1 }),
    ] }) });
    open();
    await opened('Bending');
    await user.click(screen.getByRole('tab', { name: 'Heat 2' }));
    expect(screen.getByRole('region', { name: 'Scoring Mug' })).toBeInTheDocument();

    const picker = screen.getByLabelText('Session');
    expect(screen.queryByRole('option', { name: 'Lunch' })).not.toBeInTheDocument();
    await user.selectOptions(picker, 'Teams');
    expect(screen.getByRole('region', { name: 'Scoring Ball' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Final' })).toHaveAttribute('aria-selected', 'true');
  });

  it('says when nothing is timetabled for the arena, or the session has no heats', async () => {
    link.get.mockResolvedValueOnce({ data: timetable({ sessions: [] }) });
    const { unmount } = open();
    expect(await screen.findByText(/Nothing is timetabled for this arena yet/)).toBeInTheDocument();
    unmount();

    link.get.mockResolvedValueOnce({ data: timetable({ sessions: [session(1, { arenaName: 'Main' })] }) });
    open();
    expect(await screen.findByText('No heats in this session yet.')).toBeInTheDocument();
  });

  it.each([
    [404, 'This link isn’t valid'],
    [401, 'No scorer link on this phone'],
  ])('forgets the token and says so on a %i', async (status, title) => {
    link.get.mockRejectedValue(axiosError({ status }));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent(title);
    expect(localStorage.getItem('mg.scorer.token')).toBeNull();
    expect(screen.queryByText(/Scoring · /)).not.toBeInTheDocument();
  });

  it('keeps the token (so queued scores can still report) when a link has been withdrawn', async () => {
    link.get.mockRejectedValue(axiosError({ status: 410 }));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('stopped working');
    expect(localStorage.getItem('mg.scorer.token')).toBe('mgs_token');
  });

  it('offers a retry on an unexpected error or a wrong response', async () => {
    const user = userEvent.setup();
    link.get.mockRejectedValueOnce(axiosError({ status: 400 })).mockResolvedValueOnce({ data: '<html>' }).mockResolvedValue({ data: timetable() });
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(link.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Scoring as Sam')).toBeInTheDocument();
  });

  it('shows a recently saved copy when offline without any notice', async () => {
    link.get.mockResolvedValueOnce({ data: timetable() }).mockRejectedValue(axiosError());
    const first = open();
    await screen.findByText('Scoring as Sam');
    first.unmount();

    open('');
    expect(screen.getByText('Scoring as Sam')).toBeInTheDocument();
    await waitFor(() => expect(link.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No signal/)).not.toBeInTheDocument();
  });

  it('shows an old saved copy when offline, and says so', async () => {
    // At midday, so the saved time is never yesterday's (the notice then adds the date).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 5, 15, 12, 0) });
    const user = userEvent.setup();
    link.get.mockResolvedValueOnce({ data: timetable() }).mockRejectedValue(axiosError());
    const first = open();
    await screen.findByText('Scoring as Sam');
    first.unmount();
    localStorage.setItem('mg.scorer.sessionAt', new Date(Date.now() - 60 * 60_000).toISOString());

    open('');
    expect(screen.getByText('Scoring as Sam')).toBeInTheDocument();
    expect(await screen.findByText(/Last updated \d\d:\d\d\. No signal\. Scores you enter will send/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(link.get).toHaveBeenCalledTimes(3));
  });

  it('says so when offline with nothing saved', async () => {
    link.get.mockRejectedValue(axiosError());
    open();
    expect(await screen.findByText(/nothing is saved on this phone yet/)).toBeInTheDocument();
  });

  it('shows a newer copy of a heat when one is saved, and refreshes on a timer', async () => {
    open();
    await opened('Bending');
    const newer = heatWith({ races: [race(11, { name: 'Bending', isComplete: true, results: [result(1, 1)] }), race(12, { name: 'Flag' })] });

    act(() => { window.dispatchEvent(new CustomEvent(HEAT_SAVED, { detail: { sessionId: 1, heat: newer } })); });
    act(() => { window.dispatchEvent(new CustomEvent(HEAT_SAVED, { detail: {} })); });

    await waitFor(() => expect(screen.getByRole('region', { name: 'Scoring Flag' })).toBeInTheDocument());
    // The saved copy follows, so a reload while offline doesn't bring the old results back.
    const saved = readSavedScorerSession();
    expect(saved?.sessions[0].heats.find((h) => h.id === newer.id)?.races).toHaveLength(2);
  });

  it('retains earlier draft taps separately when the programme changes online', async () => {
    open(); await opened('Bending');
    await tapTeams(userEvent.setup(), ['Team 2']);
    const oldKey = 'mg.draft.scoring:1:11';
    await waitFor(() => expect(JSON.parse(localStorage.getItem(oldKey)!)).toEqual([{ teamId: 2, place: 1, eliminated: false }]));
    const newer = heatWith({ races: [race(11, { name: 'Replacement', programmeRevision: 1 }), race(12, { name: 'Flag' })] });
    act(() => { window.dispatchEvent(new CustomEvent(HEAT_SAVED, { detail: { sessionId: 1, heat: newer } })); });
    await opened('Replacement'); expect(placed()).toBe(0);
    expect(JSON.parse(localStorage.getItem(oldKey)!)).toEqual([{ teamId: 2, place: 1, eliminated: false }]);
  });

  it('reloads when the phone comes back online or the page is shown again', async () => {
    open();
    await screen.findByText('Scoring as Sam');
    const calls = link.get.mock.calls.length;
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(link.get.mock.calls.length).toBeGreaterThan(calls));
  });

  it('shows the side-by-side Score clash banner when a queued score conflicts and resolves it in one tap', async () => {
    const user = userEvent.setup();
    updateOutbox(() => [{
      saveId: 'c1',
      competitionId: 5,
      sessionId: 1,
      heatId: 10,
      raceId: 11,
      label: 'Heat 1 · Bending',
      places: [{ teamId: 2, place: 1, eliminated: false, points: 2 }, { teamId: 1, place: 2, eliminated: false, points: 1 }],
      expected: [],
      teamNames: { 1: 'Team 1', 2: 'Team 2' },
      queuedAt: new Date().toISOString(),
      state: 'conflict',
      message: 'Results changed on another device.',
    }]);
    open();
    expect(await screen.findByRole('dialog', { name: /Two results for/ })).toBeInTheDocument();
    expect(screen.getByText('Result A (Saved)')).toBeInTheDocument();
    expect(screen.getByText('Result B (Submitted)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep result A' }));
    expect(screen.queryByRole('dialog', { name: /Two results for/ })).not.toBeInTheDocument();
  });

  it('shows the RemoteStreamControlBar when scope is 2 (Score + Stream) and sends remote camera and director cut commands', async () => {
    const user = userEvent.setup();
    link.get.mockImplementation(async (url: string) => {
      if (url === '/scorer/session') return { data: timetable({ scope: 2 }) };
      if (url === '/competitions/1/streams') {
        return {
          data: {
            enabled: true,
            streams: [
              { id: 10, competitionId: 1, arenaName: 'Main', angleName: 'Main camera', status: 0, caption: null, audioMuted: false, hasAudio: true, startedAt: '2026-10-24T12:00:00Z', viewerCount: 14, generation: 1 },
              { id: 11, competitionId: 1, arenaName: 'Main', angleName: 'Finish line', status: 0, caption: null, audioMuted: false, hasAudio: true, startedAt: '2026-10-24T12:00:00Z', viewerCount: 8, generation: 1 },
            ],
          },
        };
      }
      return { data: {} };
    });
    link.post.mockResolvedValue({ data: {} });

    open();
    expect(await screen.findByRole('region', { name: 'Remote camera control' })).toBeInTheDocument();
    expect(await screen.findByText(/LIVE · Main camera \(14 watching\)/)).toBeInTheDocument();

    // Mute camera mic
    await user.click(screen.getByRole('button', { name: 'Mute camera mic' }));
    expect(link.post).toHaveBeenCalledWith('/competitions/1/streams/10/command', { command: 'mute', value: 'true' });

    // Remote zoom 2x
    await user.click(screen.getByRole('button', { name: 'Remote zoom 2x' }));
    expect(link.post).toHaveBeenCalledWith('/competitions/1/streams/10/command', { command: 'setZoom', value: '2' });

    // Stream quality 720p
    await user.click(screen.getByRole('button', { name: 'Stream quality 720p' }));
    expect(link.post).toHaveBeenCalledWith('/competitions/1/streams/10/command', { command: 'setQualityPreset', value: '720p' });

    // Multi-camera director cut to Finish line
    await user.click(screen.getByRole('button', { name: 'Cut to Finish line' }));
    expect(link.post).toHaveBeenCalledWith('/competitions/1/streams/11/command', { command: 'selectAngle', value: '11' });

    // Save 15s camera replay
    await user.click(screen.getByRole('button', { name: 'Save 15s camera replay' }));
    expect(link.post).toHaveBeenCalledWith('/competitions/1/streams/11/command', { command: 'saveReplay', value: '15' });
  });

  it('shows the TripodCameraBroadcaster without scoring controls when scope is 1 (Camera only)', async () => {
    link.get.mockResolvedValue({ data: timetable({ scope: 1 }) });
    open();
    expect(await screen.findByRole('region', { name: 'Tripod camera broadcaster' })).toBeInTheDocument();
    expect(screen.getByText(/Stream-only link/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Scoring Bending' })).not.toBeInTheDocument();
  });
});


describe('tripod remote commands', () => {
  async function camera(withMedia = false, hash = '#t=mgs_token', over: Record<string, unknown> = {}) {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const state: Record<string, unknown> = { state: 'live', media: withMedia ? asMedia(new FakeMediaStream()) : null, streamId: 10, viewerCount: 0, signal: 'good', audioMuted: false, hasAudio: false, error: null, ...over };
    const dispose = vi.fn(); const unsubscribe = vi.fn();
    let notify = () => {};
    const stopWatching = vi.fn();
    const devicesChanged: { listener: (cameras: MediaDeviceInfo[], mics: MediaDeviceInfo[]) => void } = { listener: () => {} };
    const controls = {
      getSnapshot: () => state, subscribe: vi.fn((callback: () => void) => { notify = callback; callback(); return unsubscribe; }), dispose,
      mute: vi.fn(async () => {}), pause: vi.fn(async () => {}), switchCamera: vi.fn(async () => {}), switchAudio: vi.fn(async () => {}), setWindFilter: vi.fn(async () => {}),
      setZoom: vi.fn(async () => {}), setQualityPreset: vi.fn(async () => {}), start: vi.fn(async () => {}), setCameraLock: vi.fn(async () => {}),
      capture: vi.fn(async () => {}), devices: vi.fn(async () => [] as MediaDeviceInfo[]), audioDevices: vi.fn(async () => [] as MediaDeviceInfo[]),
      watchDevices: vi.fn((listener: typeof devicesChanged.listener) => { devicesChanged.listener = listener; return stopWatching; }),
    };
    tripod.create.mockReturnValue(controls);
    vi.stubGlobal('RTCPeerConnection', class {}); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
    link.get.mockResolvedValue({ data: timetable({ scope: 1 }) });
    const view = open(hash); await screen.findByRole('region', { name: 'Tripod camera broadcaster' });
    await waitFor(() => expect(tripod.create).toHaveBeenCalled());
    if (withMedia) await screen.findByLabelText('Tripod camera preview');
    const change = (patch: Record<string, unknown>) => act(() => { Object.assign(state, patch); notify(); });
    const send = async (command: string, value?: string, streamId = 10) => act(async () => { tripod.handlers.onStreamCommand?.({ streamId, arenaName: 'Main', command, value } as StreamCommand); });
    return { state, controls, send, change, stopWatching, devicesChanged, ...view };
  }
  it('starts on the camera position the link names', async () => {
    const view = await camera(true, '#t=mgs_token&angle=Judges%20box', { state: 'idle', streamId: null });
    expect(localStorage.getItem('mg.scorer.angle')).toBe('Judges box');
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('button', { name: 'Judges box' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Main camera' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    await waitFor(() => expect(view.controls.start).toHaveBeenCalledWith('Main', 'Judges box', true));
  });
  it('uses a known position without listing it twice, and forgets an old one when a new link has none', async () => {
    localStorage.setItem('mg.scorer.angle', 'Old spot');
    const first = await camera(true, '#t=mgs_token&angle=Finish%20line', { state: 'idle', streamId: null });
    expect(screen.getAllByRole('button', { name: 'Finish line' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Finish line' })).toHaveAttribute('aria-pressed', 'true');
    first.unmount();
    await camera(true, '#t=mgs_other', { state: 'idle', streamId: null });
    expect(localStorage.getItem('mg.scorer.angle')).toBeNull();
    expect(screen.getByRole('button', { name: 'Main camera' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('lists cameras and microphones once allowed, follows devices being plugged in, and switches', async () => {
    const view = await camera(false, '#t=mgs_token', { state: 'idle', streamId: null });
    view.controls.devices.mockResolvedValue([{ deviceId: 'back', label: 'Back camera' }, { deviceId: 'usb', label: 'USB camera' }] as MediaDeviceInfo[]);
    view.controls.audioDevices.mockResolvedValue([{ deviceId: 'mic', label: 'Phone mic' }] as MediaDeviceInfo[]);
    view.controls.capture.mockImplementation(async () => { Object.assign(view.state, { media: asMedia(new FakeMediaStream()) }); });
    fireEvent.click(screen.getByRole('button', { name: 'Allow camera' }));
    await waitFor(() => expect(view.controls.devices).toHaveBeenCalled());
    view.change({});
    expect(await screen.findByRole('combobox', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Microphone' })).toBeNull();
    expect(view.controls.watchDevices).toHaveBeenCalledOnce();
    act(() => view.devicesChanged.listener([{ deviceId: 'back', label: 'Back camera' }] as MediaDeviceInfo[],
      [{ deviceId: 'mic', label: 'Phone mic' }, { deviceId: 'lapel', label: 'Lapel mic' }] as MediaDeviceInfo[]));
    expect(screen.queryByRole('combobox', { name: 'Camera' })).toBeNull();
    chooseOption(screen.getByRole('combobox', { name: 'Microphone' }), 'lapel');
    await waitFor(() => expect(view.controls.switchAudio).toHaveBeenCalledWith('lapel'));
    act(() => view.devicesChanged.listener([{ deviceId: 'back', label: '' }, { deviceId: 'usb', label: '' }] as MediaDeviceInfo[], []));
    chooseOption(screen.getByRole('combobox', { name: 'Camera' }), 'Camera 2');
    await waitFor(() => expect(view.controls.switchCamera).toHaveBeenCalledWith('usb'));
    view.controls.switchCamera.mockRejectedValueOnce(new Error('busy'));
    chooseOption(screen.getByRole('combobox', { name: 'Camera' }), 'Camera 1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t switch to that camera');
    view.unmount();
    expect(view.stopWatching).toHaveBeenCalledOnce();
  });
  it('says so when the camera won’t start', async () => {
    const view = await camera(false, '#t=mgs_token', { state: 'idle', streamId: null });
    view.controls.capture.mockRejectedValueOnce(new Error('NotAllowedError'));
    fireEvent.click(screen.getByRole('button', { name: 'Allow camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The camera didn’t start');
    expect(screen.getByRole('button', { name: 'Allow camera' })).toBeEnabled();
  });
  it('offers the camera locks the phone reports', async () => {
    const view = await camera(true, '#t=mgs_token', { cameraLocks: { whiteBalance: false } });
    expect(screen.queryByRole('button', { name: 'Lock focus' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lock white balance' }));
    await waitFor(() => expect(view.controls.setCameraLock).toHaveBeenCalledWith('whiteBalance', true));
    view.controls.setCameraLock.mockRejectedValueOnce(new Error('refused'));
    fireEvent.click(screen.getByRole('button', { name: 'Lock white balance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The camera didn’t accept that');
  });
  it('routes commands only to the exact active camera and disposes it on unmount', async () => {
    const view = await camera();
    await view.send('mute', 'true', 11); expect(view.controls.mute).not.toHaveBeenCalled();
    await view.send('mute', 'true'); expect(view.controls.mute).toHaveBeenCalledWith(true);
    await view.send('pause', 'true'); expect(view.controls.pause).toHaveBeenCalledWith(true);
    await view.send('flipCamera'); expect(view.controls.switchCamera).toHaveBeenCalledOnce();
    await view.send('windFilter', 'true'); expect(view.controls.setWindFilter).toHaveBeenCalledWith(true);
    await view.send('setZoom', '2'); expect(view.controls.setZoom).toHaveBeenCalledWith(2);
    await view.send('setQualityPreset', '720p'); expect(view.controls.setQualityPreset).toHaveBeenCalledWith('720p');
    await view.send('setQualityPreset', 'invalid'); expect(view.controls.setQualityPreset).toHaveBeenCalledTimes(1);
    view.state.state = 'ended'; await view.send('mute', 'false'); expect(view.controls.mute).toHaveBeenCalledTimes(1);
    view.unmount(); expect(view.controls.dispose).toHaveBeenCalledOnce();
    await view.send('flipCamera'); expect(view.controls.switchCamera).toHaveBeenCalledOnce();
  });
  it('shows a failed remote camera command instead of rejecting silently', async () => {
    const view = await camera(); view.controls.pause.mockRejectedValueOnce(new Error('Disconnected'));
    await view.send('pause', 'true'); expect(await screen.findByRole('alert')).toHaveTextContent('camera command failed');
  });
  it('records and saves a requested tripod replay, using the scorer API for camera requests', async () => {
    const buffer = { start: vi.fn(() => true), stop: vi.fn(), dispose: vi.fn(), recording: true, supported: true, chunkCount: () => 1,
      markRaceBookmark: vi.fn(async () => null), saveClip: vi.fn(async () => null) };
    vi.mocked(createReplayBuffer).mockReturnValueOnce(buffer);
    const view = await camera(true); await waitFor(() => expect(buffer.start).toHaveBeenCalledWith(view.state.media));
    await view.send('saveReplay', '15'); expect(buffer.saveClip).toHaveBeenCalledWith('Camera replay', expect.objectContaining({ durationSeconds: 15, signal: expect.any(AbortSignal) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No replay video');
    link.request.mockResolvedValueOnce({ data: { accepted: true } });
    const deps = tripod.create.mock.calls.at(-1)![1];
    await expect(deps.request('POST', '/synthetic-camera-path', { zoom: 2 })).resolves.toEqual({ accepted: true });
    expect(link.request).toHaveBeenCalledWith({ method: 'POST', url: '/synthetic-camera-path', data: { zoom: 2 } });
    view.unmount(); expect(buffer.dispose).toHaveBeenCalledOnce();
  });

});


it('labels scoped scores honestly and keeps organiser and stream tools off a scoring-only link', async () => {
  link.get.mockResolvedValue({ data: timetable({ scope: 0, sessions: [session(1, {
    competitionSectionId: 9,
    heats: [heatWith({ races: [race(11, { name: 'Bending', isComplete: true, results: [result(1, 1, { points: 3 })] })] })],
  })] }) });
  open();
  await opened('Bending');
  await userEvent.click(await screen.findByRole('button', { name: 'Yes, show them' }));
  const facts = await screen.findByRole('region', { name: 'Live commentator facts' });
  expect(facts).toHaveTextContent('Available scores: 3 pts');
  expect(facts).not.toHaveTextContent('Rank');
  expect(screen.queryByRole('region', { name: 'Live stream control strip' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Score history & correction' })).toBeNull();
  expect(link.get).not.toHaveBeenCalledWith('/competitions/1/streams');
});
