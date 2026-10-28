import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { PROTESTS_CHANGED_EVENT } from '../../lib/protests';
import { ProtestStatus, type Heat, type Protest, type Race } from '../../types';
import { ProtestsPanel } from './ProtestsPanel';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const race: Race = { id: 100, heatId: 10, name: 'Bending', orderIndex: 1, isComplete: true, results: [] };
const heat: Heat = {
  id: 10, sessionId: 1, label: 'Heat 1', orderIndex: 1, races: [race, { ...race, id: 101, name: 'Flag', orderIndex: 2 }],
  entries: [
    { id: 1, teamId: 4, teamName: 'Team B', laneIndex: 2 },
    { id: 2, teamId: 3, teamName: 'Team A', laneIndex: 1 },
  ],
};

function protest(overrides: Partial<Protest> = {}): Protest {
  return {
    id: 1, competitionId: 5, sessionId: 1, sessionName: 'Session A', heatId: 10, heatLabel: 'Heat 1', heatOrder: 1,
    raceId: 100, raceName: 'Bending', raisedByTeam: { teamId: 3, teamName: 'Team A' }, raisedByName: 'Jo (trainer)',
    concerns: [{ teamId: 4, teamName: 'Team B' }], reason: 'Crossed lanes at the last pole', status: ProtestStatus.Open,
    createdAt: '2026-10-27T10:05:00Z', raceSignedOff: false, ...overrides,
  };
}

const dialog = () => within(screen.getByRole('dialog'));

describe('ProtestsPanel', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: [protest()] });
    vi.mocked(api.post).mockResolvedValue({ data: protest() });
  });

  it('lists protests with their details and says why the race is held', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      protest(),
      protest({ id: 2, raceId: null, raceName: null, raisedByTeam: null, raisedByName: null, concerns: [], reason: 'Restart was late' }),
      protest({ id: 3, status: ProtestStatus.Dismissed, decision: 'Video shows no crossing', reason: 'Older one' }),
    ] });
    render(<ProtestsPanel competitionId={5} raceId={100} heat={heat} race={race} />);

    const first = await screen.findByTestId('protest-1');
    expect(api.get).toHaveBeenCalledWith('/competitions/5/protests', { params: { raceId: 100 } });
    expect(first).toHaveTextContent('Bending · Heat 1');
    expect(first).toHaveTextContent('Open');
    expect(first).toHaveTextContent('Raised by Team A, Jo (trainer)');
    expect(first).toHaveTextContent('Crossed lanes at the last pole');
    expect(first).toHaveTextContent('About Team B');
    expect(screen.getByTestId('protest-2')).toHaveTextContent('Whole heat · Heat 1');
    expect(screen.getByTestId('protest-2')).not.toHaveTextContent('Raised by');
    expect(screen.getByTestId('protest-3')).toHaveTextContent('Dismissed: Video shows no crossing');
    expect(within(screen.getByTestId('protest-3')).queryByRole('button', { name: /Decide/ })).toBeNull();
    expect(screen.getByText(/There are 2 open protests on this race, so its result can’t be signed off until they’re decided or withdrawn/)).toBeInTheDocument();
  });

  it('says so when one open protest holds the race, and when a protest came after sign-off', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [protest({ raceSignedOff: true })] });
    render(<ProtestsPanel competitionId={5} raceId={100} heat={heat} race={race} />);
    expect(await screen.findByText(/There’s an open protest on this race, so its result can’t be signed off until it’s decided/)).toBeInTheDocument();
    expect(screen.getByText('Raised after the result was signed off.')).toBeInTheDocument();
  });

  it('shows the empty message, filters by heat and open, and has no log button without a heat', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    render(<ProtestsPanel competitionId={5} heatId={10} openOnly empty="Nothing open." />);
    expect(await screen.findByText('Nothing open.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/competitions/5/protests', { params: { heatId: 10, open: true } });
    expect(screen.queryByRole('button', { name: 'Log a protest' })).toBeNull();
  });

  it('treats a response that is not a list as empty', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: '<html>' });
    render(<ProtestsPanel competitionId={5} />);
    expect(await screen.findByText('No protests.')).toBeInTheDocument();
  });

  it('explains a failed load and tries again', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: [protest()] });
    render(<ProtestsPanel competitionId={5} />);
    expect(await screen.findByText('Couldn’t load the protests. Check your signal and try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('protest-1')).toBeInTheDocument();
  });

  it('reloads when protests change elsewhere', async () => {
    render(<ProtestsPanel competitionId={5} />);
    await screen.findByTestId('protest-1');
    vi.mocked(api.get).mockResolvedValue({ data: [protest({ status: ProtestStatus.Withdrawn })] });
    window.dispatchEvent(new Event(PROTESTS_CHANGED_EVENT));
    await waitFor(() => expect(screen.getByTestId('protest-1')).toHaveTextContent('Withdrawn'));
  });

  it('upholds a protest with a written decision', async () => {
    const user = userEvent.setup();
    const heard = vi.fn();
    window.addEventListener(PROTESTS_CHANGED_EVENT, heard);
    render(<ProtestsPanel competitionId={5} />);
    await user.click(await screen.findByRole('button', { name: 'Decide protest on Bending · Heat 1' }));

    expect(dialog().getByRole('button', { name: 'Save decision' })).toBeDisabled();
    await user.click(dialog().getByRole('combobox', { name: /^Outcome/ }));
    await user.click(screen.getByRole('option', { name: 'Upheld' }));
    expect(dialog().getByText(/correct it in the score record/)).toBeInTheDocument();
    expect(dialog().getByRole('button', { name: 'Save decision' })).toBeDisabled();
    await user.type(dialog().getByLabelText('Decision and reason'), '  Crossing seen. Team B eliminated.  ');
    await user.click(dialog().getByRole('button', { name: 'Save decision' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/protests/1/decision', { outcome: ProtestStatus.Upheld, decision: 'Crossing seen. Team B eliminated.' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(PROTESTS_CHANGED_EVENT, heard);
  });

  it('records a withdrawal with an optional note', async () => {
    const user = userEvent.setup();
    render(<ProtestsPanel competitionId={5} />);
    await user.click(await screen.findByRole('button', { name: /Decide protest/ }));
    await user.click(dialog().getByRole('combobox', { name: /^Outcome/ }));
    await user.click(screen.getByRole('option', { name: 'Withdrawn by whoever raised it' }));
    await user.click(dialog().getByRole('button', { name: 'Mark withdrawn' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/protests/1/withdraw', { note: null }));
  });

  it('keeps the decision sheet open with the reason when saving fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'This protest has already been decided.' } } });
    render(<ProtestsPanel competitionId={5} />);
    await user.click(await screen.findByRole('button', { name: /Decide protest/ }));
    await user.click(dialog().getByRole('combobox', { name: /^Outcome/ }));
    await user.click(screen.getByRole('option', { name: 'Dismissed' }));
    await user.type(dialog().getByLabelText('Decision and reason'), 'No evidence');
    await user.click(dialog().getByRole('button', { name: 'Save decision' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent('This protest has already been decided.');
  });

  it('logs a protest about the race on screen', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    render(<ProtestsPanel competitionId={5} raceId={100} heat={heat} race={race} />);
    await user.click(await screen.findByRole('button', { name: 'Log a protest' }));

    expect(dialog().getByRole('button', { name: 'Log protest' })).toBeDisabled();
    await user.click(dialog().getByRole('combobox', { name: /^Raised by/ }));
    await user.click(screen.getByRole('option', { name: 'Team A' }));
    await user.type(dialog().getByLabelText('Who raised it (optional)'), ' Jo (trainer) ');
    await user.click(dialog().getByRole('switch', { name: 'Team B' }));
    await user.click(dialog().getByRole('switch', { name: 'Team A' }));
    await user.click(dialog().getByRole('switch', { name: 'Team A' }));
    await user.type(dialog().getByLabelText('What happened'), 'Crossed lanes');
    await user.click(dialog().getByRole('button', { name: 'Log protest' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/protests', expect.objectContaining({
      heatId: 10, raceId: 100, raisedByTeamId: 3, concernsTeamIds: [4], raisedByName: 'Jo (trainer)', reason: 'Crossed lanes',
    })));
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(expect.objectContaining({ requestId: expect.stringMatching(/^protest-/) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('logs a protest about the whole heat, from no team, and shows why it failed', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: protest() });
    render(<ProtestsPanel competitionId={5} heat={{ ...heat, label: null }} />);
    await user.click(await screen.findByRole('button', { name: 'Log a protest' }));
    expect(dialog().getByRole('combobox', { name: /^About/ })).toHaveTextContent('The whole heat (this heat)');
    await user.type(dialog().getByLabelText('What happened'), 'Restart was late');
    await user.click(dialog().getByRole('button', { name: 'Log protest' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent('Couldn’t log the protest. Check your signal and try again.');

    await user.click(dialog().getByRole('button', { name: 'Log protest' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(api.post).mock.calls.map((call) => call[1] as { requestId: string; raceId: number | null; raisedByTeamId: number | null; raisedByName: string | null });
    expect(second).toEqual(expect.objectContaining({ raceId: null, raisedByTeamId: null, raisedByName: null }));
    // The retry carries the same request id, so the server can't log it twice.
    expect(second.requestId).toBe(first.requestId);
  });

  it('can switch a race protest to the whole heat', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    render(<ProtestsPanel competitionId={5} heat={heat} race={race} />);
    await user.click(await screen.findByRole('button', { name: 'Log a protest' }));
    await user.click(dialog().getByRole('combobox', { name: /^About/ }));
    await user.click(screen.getByRole('option', { name: 'The whole heat (Heat 1)' }));
    await user.type(dialog().getByLabelText('What happened'), 'Restart was late');
    await user.click(dialog().getByRole('button', { name: 'Log protest' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/protests', expect.objectContaining({ raceId: null })));
  });
});
