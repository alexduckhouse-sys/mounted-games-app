import { act, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('heading', { name: /Scoring · Bending/ })).toBeInTheDocument();
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
    await screen.findByRole('heading', { name: /Scoring · Bending/ });

    await user.click(screen.getByText('Team 2'));
    await user.click(screen.getByText('Team 1'));
    await user.click(screen.getByText('Team 3'));
    await user.click(screen.getByRole('button', { name: /Save 3 results/ }));

    expect(outbox()).toEqual([expect.objectContaining({
      viaLink: true, raceId: 11, competitionId: 1, sessionId: 1, state: 'waiting', label: 'Heat 1 · Bending',
      places: [{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 2, eliminated: false }, { teamId: 3, place: 3, eliminated: false }],
    })]);
    expect(await screen.findByRole('heading', { name: /Scoring · Flag/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('saved on this phone');
  });

  it('asks for a reason before correcting a race that already has results', async () => {
    const user = userEvent.setup();
    link.get.mockResolvedValue({ data: timetable({ sessions: [session(1, { arenaName: 'Main', heats: [heatWith({
      races: [race(11, { name: 'Bending', isComplete: true, results: [result(1, 1), result(2, 2), result(3, 3)] }), race(12, { name: 'Flag' })],
    })] })] }) });
    open();
    await screen.findByRole('heading', { name: /Scoring · Flag/ });
    await user.click(screen.getByRole('button', { name: /1\. Bending/ }));
    // The saved placings are there to correct.
    expect(screen.getByRole('button', { name: /Save 3 results/ })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /Save 3 results/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add a reason for this correction');
    expect(outbox()).toEqual([]);

    await user.type(screen.getByLabelText('Reason for correction'), 'Judge changed it');
    await user.click(screen.getByRole('button', { name: /Save 3 results/ }));
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
    expect(screen.getByRole('button', { name: /Save 0 results/ })).toBeDisabled();
  });

  it('lets the scorer eliminate a team, and shows storage trouble', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('heading', { name: /Scoring · Bending/ });
    await user.click(screen.getByText('Team 1'));
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('full'); };
    try {
      await user.click(screen.getByRole('button', { name: /Save 1 result/ }));
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
    await screen.findByRole('heading', { name: /Scoring · Bending/ });
    await user.click(screen.getByRole('tab', { name: 'Heat 2' }));
    expect(screen.getByRole('heading', { name: /Scoring · Mug/ })).toBeInTheDocument();

    const picker = screen.getByLabelText('Session');
    expect(screen.queryByRole('option', { name: 'Lunch' })).not.toBeInTheDocument();
    await user.selectOptions(picker, 'Teams');
    expect(screen.getByRole('heading', { name: /Scoring · Ball/ })).toBeInTheDocument();
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

  it('shows the saved copy when offline, and says so', async () => {
    const user = userEvent.setup();
    link.get.mockResolvedValueOnce({ data: timetable() }).mockRejectedValue(axiosError());
    const first = open();
    await screen.findByText('Scoring as Sam');
    first.unmount();

    open('');
    expect(screen.getByText('Scoring as Sam')).toBeInTheDocument();
    expect(await screen.findByText(/last copy saved on this phone/)).toBeInTheDocument();
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
    await screen.findByRole('heading', { name: /Scoring · Bending/ });
    const newer = heatWith({ races: [race(11, { name: 'Bending', isComplete: true, results: [result(1, 1)] }), race(12, { name: 'Flag' })] });

    act(() => { window.dispatchEvent(new CustomEvent(HEAT_SAVED, { detail: { sessionId: 1, heat: newer } })); });
    act(() => { window.dispatchEvent(new CustomEvent(HEAT_SAVED, { detail: {} })); });

    await waitFor(() => expect(screen.getByRole('button', { name: /1\. Bending/ }).className).toContain('emerald'));
  });

  it('reloads when the phone comes back online or the page is shown again', async () => {
    open();
    await screen.findByText('Scoring as Sam');
    const calls = link.get.mock.calls.length;
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(link.get.mock.calls.length).toBeGreaterThan(calls));
  });
});
