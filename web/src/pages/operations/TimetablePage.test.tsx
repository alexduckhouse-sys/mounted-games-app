import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { CurrentCompetitionProvider } from '../../competition/CurrentCompetitionContext';
import { TickerProvider } from '../../components/TickerContext';
import { TopBarTicker } from '../../components/TopBarTicker';
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
// The undo banner and clash list have their own tests and each makes a GET this page's tests don't answer.
vi.mock('./DrawUndoBanner', () => ({ DrawUndoBanner: () => null }));
vi.mock('./TimetableClashes', () => ({ TimetableClashes: () => null }));

const preview = {
  sectionId: 11, seed: 12345, fingerprint: 'fp',
  fairness: { teamCount: 2, sessionCount: 1, heatSizeSpread: 0, maximumOpponentMeetings: 0, repeatedOpponentPairs: 0, maximumLaneUseSpread: 0, everyTeamAppearsOncePerSession: true, warnings: [] },
  sessions: [{ sessionId: 1, name: 'S', heats: [{ heatId: 1, label: 'Heat 1', orderIndex: 1, teams: [{ teamId: 2, teamName: 'Elm B', laneIndex: 2 }, { teamId: 1, teamName: 'Oak A', laneIndex: 1 }] }] }],
};

function show() {
  return render(<MemoryRouter><TimetablePage /></MemoryRouter>);
}
function showDocked() {
  return render(
    <MemoryRouter>
      <CurrentCompetitionProvider>
        <TickerProvider>
          <TimetablePage />
          <TopBarTicker />
        </TickerProvider>
      </CurrentCompetitionProvider>
    </MemoryRouter>,
  );
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

  it('offers to send the timetable on, with the arena order and a link, and nothing is sent by itself', async () => {
    show();
    const link = await screen.findByRole('link', { name: 'Send on WhatsApp' });
    const text = decodeURIComponent(link.getAttribute('href') ?? '');
    expect(text).toContain('Spring Open');
    expect(text).toContain('Main arena');
    expect(text.indexOf('Under 12 · Session 1')).toBeLessThan(text.indexOf('Under 12 · Session 2'));
    expect(text).toContain('/competitions/7');
    expect(screen.getByRole('button', { name: 'Copy timetable' })).toBeInTheDocument();
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

  it('offers to continue a timetable that was put on hold, and only then', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('button', { name: 'Earlier' });
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    cleanup();

    const first = competition.sessions[0];
    const before = first.notes;
    first.notes = '[paused:1700000000000]';
    try {
      show();
      expect(await screen.findByText('The timetable is on hold')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/sessions/resume', {}));
      await waitFor(() => expect(reload).toHaveBeenCalled());

      vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      expect(await screen.findByText(/Couldn’t continue the timetable/)).toBeInTheDocument();
    } finally {
      first.notes = before;
    }
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

  it('leaves the next day’s blocks alone when it moves what follows', async () => {
    const user = userEvent.setup();
    competition.sessions.push(session(4, 'Sunday session', { scheduledStart: at(24 * 60), orderIndex: 4 }));
    try {
      show();
      await user.click(await screen.findByRole('button', { name: /Under 12 · Session 1/ }));
      await user.click(screen.getByRole('button', { name: 'Longer time per heat' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/3', { scheduledStart: at(90) }));
      expect(api.put).not.toHaveBeenCalledWith('/competitions/7/sessions/4', expect.anything());
    } finally {
      competition.sessions.pop();
    }
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

  it('always offers a start time for finals, and saves it even when the suggested time is kept', async () => {
    competition.sessions.push(session(4, 'Under 12 finals', { scheduledStart: null, durationMinutes: null }));
    try {
      const user = userEvent.setup();
      show();
      const row = await screen.findByRole('button', { name: /Under 12 finals/ });
      expect(row).toHaveTextContent('Set a start time so it shows on the public timetable');
      await user.click(row);
      const start = screen.getByLabelText('Start');
      fireEvent.blur(start);
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/4', { scheduledStart: expect.any(String) }));
      fireEvent.change(start, { target: { value: '15:30' } });
      fireEvent.blur(start);
      await waitFor(() => expect(vi.mocked(api.put).mock.calls.some(([url, body]) => url === '/competitions/7/sessions/4'
        && new Date((body as { scheduledStart: string }).scheduledStart).getHours() === 15)).toBe(true));
    } finally {
      competition.sessions.pop();
    }
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
    expect(asked.titles).toEqual(['Remove Lunch?']);
  });

  it('has no grips until the order is open to change, then drags and keys move a block', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.queryByRole('button', { name: /^Move .*drag/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('switch', { name: 'Drag to change the order' }));
    // Pressing the arrow key on a focused grip moves the block one place.
    const grip = screen.getByRole('button', { name: /^Move Lunch: drag/ });
    grip.focus();
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2', { scheduledStart: startOf(1) }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/1', { scheduledStart: at(50) });
    // Lunch is first now and nothing is before it, so up does nothing; other keys are ignored.
    await waitFor(() => expect(grip).toHaveAttribute('aria-disabled', 'false'));
    vi.mocked(api.put).mockClear();
    await user.keyboard('{ArrowUp}{a}');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('shows a moved block at its new time while it saves, and keeps the grip focused', async () => {
    let finish = () => {};
    vi.mocked(api.put).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ data: {} }); }));
    const user = userEvent.setup();
    const { container } = show();
    await user.click(await screen.findByRole('switch', { name: 'Drag to change the order' }));
    const timeOf = (id: number) => container.querySelector(`[data-tt-row="${id}"] .ops-time`)?.textContent;
    const firstTime = timeOf(1);
    const grip = screen.getByRole('button', { name: /^Move Lunch: drag/ });
    grip.focus();
    await user.keyboard('{ArrowUp}');
    // Before the save answers, Lunch already sits first with Session 1's old start.
    await waitFor(() => expect(timeOf(2)).toBe(firstTime));
    expect([...container.querySelectorAll('[data-tt-row]')].map((row) => row.getAttribute('data-tt-row'))).toEqual(['2', '1', '3']);
    expect(grip).toHaveFocus();
    expect(grip).toHaveAttribute('aria-disabled', 'true');
    // A second press while it saves does nothing.
    const calls = vi.mocked(api.put).mock.calls.length;
    await user.keyboard('{ArrowDown}');
    expect(api.put).toHaveBeenCalledTimes(calls);
    finish();
  });

  it('drags a block down the order with a pointer and saves the new times', async () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 50 } as DOMRect);
    try {
      const user = userEvent.setup();
      show();
      await user.click(await screen.findByRole('switch', { name: 'Drag to change the order' }));
      const grip = screen.getByRole('button', { name: /^Move Under 12 · Session 1: drag/ });
      fireEvent.pointerDown(grip, { clientY: 100, button: 0 });
      fireEvent(window, new MouseEvent('pointermove', { clientY: 160 }));
      fireEvent(window, new MouseEvent('pointerup'));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2', { scheduledStart: at(0) }));
      expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/1', { scheduledStart: at(50) });
      // Letting go where it started saves nothing.
      vi.mocked(api.put).mockClear();
      fireEvent.pointerDown(grip, { clientY: 100, button: 0 });
      fireEvent(window, new MouseEvent('pointercancel'));
      fireEvent.pointerDown(grip, { clientY: 100, button: 2 });
      expect(api.put).not.toHaveBeenCalled();
    } finally {
      rect.mockRestore();
    }
  });

  it('keeps a final where it is: no grip, and others are not moved onto its time', async () => {
    competition.sessions.push(session(4, 'Under 12 finals', { scheduledStart: at(200), durationMinutes: 30 }));
    try {
      const user = userEvent.setup();
      show();
      await user.click(await screen.findByRole('switch', { name: 'Drag to change the order' }));
      expect(screen.queryByRole('button', { name: /^Move Under 12 finals/ })).not.toBeInTheDocument();
      screen.getByRole('button', { name: /^Move Under 12 · Session 2: drag/ }).focus();
      await user.keyboard('{ArrowDown}');
      expect(api.put).not.toHaveBeenCalled();
    } finally {
      competition.sessions.pop();
    }
  });

  it('moves a block and everything after it by the chosen minutes, even when each follows on', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Lunch/ }));
    await user.click(screen.getByRole('button', { name: 'More minutes from here' }));
    await user.click(screen.getByRole('button', { name: 'Move Lunch and later ones later' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/2', { scheduledStart: at(60) }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/3', { scheduledStart: at(100) });
    expect(api.put).not.toHaveBeenCalledWith('/competitions/7/sessions/1', expect.anything());
    await user.click(screen.getByRole('button', { name: 'Fewer minutes from here' }));
    await user.click(screen.getByRole('button', { name: 'Move Lunch and later ones earlier' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/3', { scheduledStart: at(65) }));
  });

  it('adds a break straight after the row being edited', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Under 12 · Session 1/ }));
    await user.click(screen.getByRole('button', { name: 'Add a break after this' }));
    expect(screen.getByRole('button', { name: 'After: Under 12 · Session 1' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add break' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/sessions', expect.objectContaining({ name: 'Lunch', durationMinutes: 30, scheduledStart: at(20) })));
  });

  it('adds a break at the start and moves everything later', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a break' }));
    await user.click(screen.getByRole('button', { name: 'After: Under 12 · Session 2' }));
    await user.click(screen.getByRole('option', { name: 'At the start' }));
    await user.click(screen.getByRole('button', { name: 'Add break' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/sessions', expect.objectContaining({ durationMinutes: 30, scheduledStart: at(0) })));
    for (const [id, minutes] of [[1, 30], [2, 70], [3, 110]]) expect(api.put).toHaveBeenCalledWith(`/competitions/7/sessions/${id}`, { scheduledStart: at(minutes) });
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

describe('TimetablePage after the draw', () => {
  const originals = competition.sessions.slice();
  const heat = (id: number, extra: Record<string, unknown> = {}) => ({ id, label: `Heat ${id}`, orderIndex: id, startedAt: null, finishedAt: null, entries: [], races: [{ id: id * 10, isComplete: false }], ...extra });
  const drawn = (id: number, name: string, start: number, extra: Record<string, unknown> = {}) =>
    session(id, name, { scheduledStart: at(start), durationMinutes: 20, heats: [heat(id * 2), heat(id * 2 + 1)], ...extra });
  const use = (...sessions: unknown[]) => { competition.sessions = sessions as typeof competition.sessions; };

  beforeEach(() => {
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    vi.mocked(api.post).mockResolvedValue({ data: preview });
  });
  afterEach(() => { competition.sessions = originals; });

  it('lets a drawn session that has not started change its time per heat and moves what follows', async () => {
    use(drawn(1, 'Under 12 · Session 1', 0), session(2, 'Lunch', { kind: 1, isBreak: true, competitionSectionId: null, scheduledStart: at(40), durationMinutes: 30, minutesPerHeat: null }), drawn(3, 'Under 12 · Session 2', 80));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Under 12 · Session 1/ }));
    expect(screen.queryByText(/has started or has scores/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Longer time per heat' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/1', { minutesPerHeat: 15, durationMinutes: 30 }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/3', { scheduledStart: at(90) }));
  });

  it('offers a start time and a move-from on a drawn session', async () => {
    use(drawn(1, 'Under 12 · Session 1', 0), drawn(3, 'Under 12 · Session 2', 80));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('switch', { name: 'Each one follows on from the one before' }));
    await user.click(screen.getByRole('button', { name: /Under 12 · Session 2/ }));
    expect(screen.getByLabelText('Start')).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Follow on from the one before' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/3', { scheduledStart: at(20) }));
  });

  it('swaps two drawn sessions: each takes the other’s slot, with no block', async () => {
    use(drawn(1, 'Under 12 · Session 1', 0), drawn(3, 'Under 12 · Session 2', 80));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('switch', { name: 'Drag to change the order' }));
    const grip = screen.getByRole('button', { name: /^Move Under 12 · Session 1: drag/ });
    grip.focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/3', { scheduledStart: at(0) }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/1', { scheduledStart: at(80) });
  });

  it('warns, and does not block, when a moved session overlaps the one before', async () => {
    use(drawn(1, 'Under 12 · Session 1', 0, { heats: [heat(2), heat(3), heat(4), heat(5)] }), drawn(3, 'Under 12 · Session 2', 10));
    show();
    expect(await screen.findByText('Overlaps the one before')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Under 12 · Session 2/ })).toBeEnabled();
  });

  it('keeps a session that has started locked: no grip, no start time, and says why', async () => {
    use(drawn(1, 'Under 12 · Session 1', 0, { status: 1, startedAt: at(0) }), drawn(3, 'Under 12 · Session 2', 80));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('switch', { name: 'Drag to change the order' }));
    expect(screen.queryByRole('button', { name: /^Move Under 12 · Session 1: drag/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Drag to change the order' }));
    await user.click(screen.getByRole('button', { name: /Under 12 · Session 1/ }));
    expect(screen.getByText(/has started or has scores/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Shift/ })).not.toBeInTheDocument();
  });

  it('keeps a session with a scored race locked', async () => {
    use(drawn(1, 'Under 12 · Session 1', 0, { heats: [heat(2, { races: [{ id: 20, isComplete: true }] }), heat(3)] }));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Under 12 · Session 1/ }));
    expect(screen.getByText(/has started or has scores/)).toBeInTheDocument();
  });

  it('puts the timetable tools in a sheet opened from the dock, with the break form back on the page', async () => {
    const user = userEvent.setup();
    showDocked();
    await screen.findByRole('button', { name: /Under 12 · Session 1/ });
    expect(screen.queryByText('Move everything')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a hatband' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a break' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Timetable tools' }));
    const sheet = await screen.findByRole('dialog', { name: 'Timetable tools' });
    for (const name of ['Move everything', 'Each one follows on from the one before', 'Drag to change the order', 'Send the timetable', 'Hatbands', 'Lanes for heat 1']) {
      expect(within(sheet).getByText(name)).toBeInTheDocument();
    }
    await user.click(within(sheet).getByRole('button', { name: 'Add a break' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Timetable tools' })).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Add break' })).toBeInTheDocument();
  });
});

vi.mock('../../components/PaceReview', () => ({ PaceReview: () => null }));
