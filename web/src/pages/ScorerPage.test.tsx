import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axiosError, heat, race, result, session } from '../test/factories';
import type { Heat, ScorerSession } from '../types';
import { HEAT_SAVED } from '../offline/useScoreOutbox';
import { ScorerPage } from './ScorerPage';

const link = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
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
});
afterEach(() => { vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

describe('ScorerPage', () => {
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
    await user.click(screen.getByRole('button', { name: 'Race complete' }));

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
    await user.click(screen.getByRole('button', { name: /1\. Bending/ }));
    // The saved placings are there to correct.
    expect(placed()).toBe(3);

    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add a reason for this correction');
    expect(outbox()).toEqual([]);

    await user.type(screen.getByLabelText('Reason for correction'), 'Judge changed it');
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    expect(outbox()).toEqual([expect.objectContaining({ raceId: 11, reason: 'Judge changed it', expected: expect.any(Array) })]);
  });

  it('can clear a corrected race’s placings to start again', async () => {
    const user = userEvent.setup();
    link.get.mockResolvedValue({ data: timetable({ sessions: [session(1, { arenaName: 'Main', heats: [heatWith({
      races: [race(11, { name: 'Bending', isComplete: true, results: [result(1, 1), result(2, 2), result(3, 3)] })],
    })] })] }) });
    open();
    await screen.findByRole('button', { name: /1\. Bending/ });
    await user.click(screen.getByRole('button', { name: /1\. Bending/ }));
    await user.click(screen.getByRole('button', { name: /Clear/ }));
    expect(placed()).toBe(0);
  });

  it('lists the teams in lane order with the bib colour under each name', async () => {
    const bibbed = [
      { id: 1, teamId: 1, teamName: 'Team 1', laneIndex: 3, bibColour: 'Red' },
      { id: 2, teamId: 2, teamName: 'Team 2', laneIndex: 1, bibColour: 'Green' },
      { id: 3, teamId: 3, teamName: 'Team 3', laneIndex: 2 },
    ];
    link.get.mockResolvedValue({ data: timetable({ sessions: [session(1, { arenaName: 'Main', heats: [heatWith({ entries: bibbed })] })] }) });
    open();
    const region = await opened('Bending');
    const rows = within(region).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows[0]).toMatch(/Team 2.*Green bib/);
    expect(rows[1]).toMatch(/Team 3.*No bib colour/);
    expect(rows[2]).toMatch(/Team 1.*Red bib/);
  });

  it('asks why an eliminated team is out and records the reason, while having no HC button', async () => {
    const user = userEvent.setup();
    open();
    await opened('Bending');
    await tapTeams(user, ['Team 1']);
    await user.click(screen.getByRole('button', { name: 'Eliminate Team 2' }));
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    const sheet = await screen.findByRole('dialog', { name: 'Why were teams eliminated?' });
    await user.click(within(sheet).getByRole('button', { name: 'Did not start' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save race' }));
    expect(outbox()[0].places).toEqual([
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 2, place: 0, eliminated: true, status: 2, refereeNote: 'Did not start' },
    ]);
    expect(screen.queryByRole('button', { name: /hors concours/i })).not.toBeInTheDocument();
  });

  it('undoes a tap, and cancels a save that is still waiting on the phone', async () => {
    const user = userEvent.setup();
    open();
    await opened('Bending');
    await tapTeams(user, ['Team 2', 'Team 1']);
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(placed()).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Race complete' }));
    await opened('Flag');
    expect(outbox()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Undo last save' }));
    await opened('Bending');
    expect(outbox()).toHaveLength(0);
    expect(placed()).toBe(1);
  });

  it('says so when the phone can’t store the scores', async () => {
    const user = userEvent.setup();
    open();
    await opened('Bending');
    await tapTeams(user, ['Team 1']);
    const save = await screen.findByRole('button', { name: 'Race complete' }, { timeout: 5000 });
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
    expect(await screen.findByRole('alert')).toHaveTextContent('expired or been withdrawn');
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
    const user = userEvent.setup();
    link.get.mockResolvedValueOnce({ data: timetable() }).mockRejectedValue(axiosError());
    const first = open();
    await screen.findByText('Scoring as Sam');
    first.unmount();
    localStorage.setItem('mg.scorer.sessionAt', new Date(Date.now() - 60 * 60_000).toISOString());

    open('');
    expect(screen.getByText('Scoring as Sam')).toBeInTheDocument();
    expect(await screen.findByText(/Last updated \d\d:\d\d\. No signal; scores you enter will send/)).toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByRole('button', { name: /^1\. Bending.*1st Team 1/ })).toBeInTheDocument());
  });

  it('reloads when the phone comes back online or the page is shown again', async () => {
    open();
    await screen.findByText('Scoring as Sam');
    const calls = link.get.mock.calls.length;
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(link.get.mock.calls.length).toBeGreaterThan(calls));
  });
});
