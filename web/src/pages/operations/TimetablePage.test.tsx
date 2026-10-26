import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { TimetablePage } from './TimetablePage';

const reload = vi.fn();
const at = (minutes: number) => new Date(Date.UTC(2031, 4, 4, 9, 0) + minutes * 60_000).toISOString();
const session = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, competitionId: 7, competitionSectionId: 11, sectionName: 'Under 12', name, arenaName: 'Main arena', kind: 0, isBreak: false, status: 0, orderIndex: id,
  minutesPerHeat: 10, lanesPerHeat: 3, heats: [], plannedRaces: [], scheduledStart: at(0), durationMinutes: 20, ...extra,
});
const competition = {
  id: 7, name: 'Spring Open', startDate: at(0), endDate: null, isActive: true, isArchived: false, laneHatbands: ['Red', 'Blue'],
  sections: [{ id: 11, format: 2, ageGroup: 'Under 12', displayName: 'Under 12', usesRaceFinals: false }],
  teams: [1, 2, 3, 4, 5, 6].map((id) => ({ id, competitionSectionId: 11, isWithdrawn: false })),
  sessions: [
    session(1, 'Under 12 · Session 1', { scheduledStart: at(0), durationMinutes: 20 }),
    session(2, 'Lunch', { kind: 1, isBreak: true, competitionSectionId: null, scheduledStart: at(40), durationMinutes: 30, minutesPerHeat: null }),
    session(3, 'Under 12 · Session 2', { scheduledStart: at(80), durationMinutes: 20 }),
  ],
};
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition, reload }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const preview = {
  sectionId: 11, seed: 12345, fingerprint: 'fp',
  fairness: { teamCount: 2, sessionCount: 1, heatSizeSpread: 0, maximumOpponentMeetings: 0, repeatedOpponentPairs: 0, maximumLaneUseSpread: 0, everyTeamAppearsOncePerSession: true, warnings: [] },
  sessions: [{ sessionId: 1, name: 'S', heats: [{ heatId: 1, label: 'Heat 1', orderIndex: 1, teams: [{ teamId: 2, teamName: 'Elm B', laneIndex: 2 }, { teamId: 1, teamName: 'Oak A', laneIndex: 1 }] }] }],
};

function show() {
  return render(<MemoryRouter><TimetablePage /></MemoryRouter>);
}
const startOf = (id: number) => at(id === 3 ? 80 : id === 2 ? 40 : 0);

describe('TimetablePage', () => {
  beforeEach(() => {
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    vi.mocked(api.post).mockResolvedValue({ data: preview });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it('lists each arena with its items in order, what each runs and the gaps, and has no draw number', async () => {
    show();
    const list = await screen.findByRole('list', { hidden: true, name: 'Main arena' }).catch(() => null);
    expect(list ?? screen.getByLabelText('Main arena')).toBeTruthy();
    const first = screen.getByRole('button', { name: /Under 12 · Session 1/ });
    expect(first).toHaveTextContent('2 heats · 10 min a heat · 20 min');
    expect(screen.getByRole('button', { name: /Lunch/ })).toHaveTextContent('Break · 30 min');
    expect(screen.getAllByText(/min gap/)).toHaveLength(2);
    expect(screen.queryByLabelText(/Draw number/i)).not.toBeInTheDocument();
  });

  it('moves everything earlier or later by the chosen minutes', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Earlier' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/sessions/shift-times', { deltaMinutes: -15 }));
    await user.click(screen.getByRole('button', { name: 'More minutes' }));
    await user.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/competitions/7/sessions/shift-times', { deltaMinutes: 20 }));
  });

  it('sets the time per heat and moves what follows when each follows on', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Under 12 · Session 1/ }));
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Longer time per heat' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/1', { minutesPerHeat: 15, durationMinutes: 30 }));
    // Everything after it in the arena moves by the 10 extra minutes.
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2', { scheduledStart: at(50) }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/3', { scheduledStart: at(90) });
  });

  it('shows a start time to type when follow-on is off, and nothing moves with it', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('switch', { name: 'Each one follows on from the one before' }));
    await user.click(screen.getByRole('button', { name: /Under 12 · Session 2/ }));
    expect(screen.getByLabelText('Start')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow on from the one before' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Follow on from the one before' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/3', { scheduledStart: at(70) }));
  });

  it('edits a break: its name, length and removal', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    show();
    await user.click(await screen.findByRole('button', { name: /Lunch/ }));
    await user.click(screen.getByRole('button', { name: 'Name: Lunch' }));
    await user.click(screen.getByRole('option', { name: 'Tea' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2', { name: 'Tea' }));

    await user.click(screen.getByRole('button', { name: 'Longer length' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2', { durationMinutes: 35 }));

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/7/sessions/2'));
    expect(asked.titles).toEqual(['Remove this break?']);
  });

  it('moves an item above its neighbour', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Lunch/ }));
    await user.click(screen.getByRole('button', { name: 'Move Lunch up' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2', { scheduledStart: startOf(1) }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/1', { scheduledStart: at(50) });
  });

  it('adds a break after an item', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a break' }));
    await user.click(screen.getByRole('button', { name: 'After: Under 12 · Session 2' }));
    await user.click(screen.getByRole('option', { name: 'Under 12 · Session 1' }));
    await user.click(screen.getByRole('button', { name: 'Longer how long' }));
    await user.click(screen.getByRole('button', { name: 'Add break' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/sessions', expect.objectContaining({ name: 'Lunch', arenaName: 'Main arena', durationMinutes: 35, kind: 1, scheduledStart: at(20) })));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2', { scheduledStart: at(75) });
  });

  it('manages hatbands: add from a colour, reorder, remove, and clear', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a hatband' }));
    await user.click(screen.getByRole('button', { name: 'Green' }));
    await user.click(screen.getByRole('button', { name: 'Add hatband' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ laneHatbands: ['Red', 'Blue', 'Green'], name: 'Spring Open' })));

    await user.click(screen.getByRole('button', { name: 'Move Blue up' }));
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/7', expect.objectContaining({ laneHatbands: ['Blue', 'Red'] })));
    await user.click(screen.getByRole('button', { name: 'More for Red' }));
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveClass('rf-menu-danger');
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/7', expect.objectContaining({ laneHatbands: ['Blue'] })));
    await user.click(screen.getByRole('button', { name: 'Remove all hatbands' }));
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/7', expect.objectContaining({ laneHatbands: [] })));
  });

  it('changes a hatband’s name and colour in a panel under its row and saves as you go', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'More for Blue' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change colour' }));
    const panel = screen.getByRole('group', { name: 'Change colour of Blue' });
    const name = within(panel).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Lilac');
    const hex = within(panel).getByLabelText('Colour code');
    await user.clear(hex);
    await user.type(hex, '#b79ced');
    expect(api.put).not.toHaveBeenCalled();
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ laneHatbands: ['Red', 'Lilac #B79CED'] }));
    await user.click(within(panel).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('group', { name: /Change colour of/ })).not.toBeInTheDocument();
  });

  it('sends the last change at once when Done is pressed, and lets the colour picker and a bare hex box both work', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'More for Red' }));
    await user.click(screen.getByRole('menuitem', { name: 'Change colour' }));
    const panel = screen.getByRole('group', { name: 'Change colour of Red' });
    fireEvent.change(within(panel).getByLabelText('Colour'), { target: { value: '#112233' } });
    expect(within(panel).getByLabelText('Colour code')).toHaveValue('#112233');
    await user.clear(within(panel).getByLabelText('Colour code'));
    await user.type(within(panel).getByLabelText('Colour code'), '445566');
    await user.click(within(panel).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ laneHatbands: ['Red #445566', 'Blue'] })));
  });

  it('keeps the old name when the name is emptied, and shows a custom hatband by its name only', async () => {
    const user = userEvent.setup();
    competition.laneHatbands = ['Lilac #B79CED', 'Blue'];
    try {
      show();
      expect(await screen.findByText('Lilac')).toBeInTheDocument();
      expect(screen.queryByText(/#B79CED/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'More for Lilac' }));
      await user.click(screen.getByRole('menuitem', { name: 'Change colour' }));
      const panel = screen.getByRole('group', { name: 'Change colour of Lilac' });
      expect(within(panel).getByLabelText('Colour code')).toHaveValue('#B79CED');
      await user.clear(within(panel).getByLabelText('Name'));
      await user.type(within(panel).getByLabelText('Colour code'), '{Backspace}0');
      await user.click(within(panel).getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ laneHatbands: ['Lilac #B79CE0', 'Blue'] })));
    } finally {
      competition.laneHatbands = ['Red', 'Blue'];
    }
  });

  it('adds a hatband with a picked colour and its own name', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a hatband' }));
    await user.type(screen.getByLabelText('Name'), 'Mint');
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: '#a0e8c0' } });
    expect(screen.getByLabelText('Colour code')).toHaveValue('#A0E8C0');
    await user.click(screen.getByRole('button', { name: 'Add hatband' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ laneHatbands: ['Red', 'Blue', 'Mint #A0E8C0'] })));
  });

  it('draws a section, shows heat 1 lanes and applies or shuffles it', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Draw' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/sections/11/draw/preview', { seed: expect.any(Number) }));
    const lanes = await screen.findByRole('list', { name: 'Heat 1' }).catch(() => null);
    expect(lanes ?? screen.getByLabelText('Heat 1')).toBeTruthy();
    const rows = screen.getAllByText(/^Lane \d$/).map((n) => n.textContent);
    expect(rows).toEqual(['Lane 1', 'Lane 2']);
    await user.click(screen.getByRole('button', { name: 'Shuffle again' }));
    await waitFor(() => expect(vi.mocked(api.post).mock.calls.filter((c) => String(c[0]).endsWith('/draw/preview'))).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Apply draw' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/sections/11/draw/apply', { seed: 12345, fingerprint: 'fp' }));
    expect(await screen.findByText(/Draw applied/)).toBeInTheDocument();
  });

  it('shows why a change failed', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { message: 'Nope.' } } });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Later' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope.');
    expect(within(screen.getByRole('alert')).queryByRole('button')).not.toBeInTheDocument();
  });
});
