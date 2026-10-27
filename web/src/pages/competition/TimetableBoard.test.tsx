import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { competition, heat, race, session } from '../../test/factories';
import { dayKey } from '../../lib/timetableDay';
import { TimetableBoard } from './TimetableBoard';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context')>()), useCompetition: () => state.value }));
const auth = vi.hoisted(() => ({ organise: false }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organise }) }));

const day = dayKey(new Date());
const reload = vi.fn();

function setCompetition(extra: Record<string, unknown> = {}, updatedAt: Date | null = null, secondArena = 'Arena Two') {
  // Session 3 finished first; session 1 started six minutes late, which pushes session 2 back by the same.
  const sessions = [
    session(1, { status: 1, arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, startedAt: `${day}T10:06:00`, heats: [heat(11, { sessionId: 1, orderIndex: 0, label: 'Heat 1' })] }),
    session(2, { status: 0, arenaName: secondArena, scheduledStart: `${day}T11:00:00`, heats: [heat(22, { sessionId: 2, orderIndex: 0, label: 'Heat 2' })] }),
    session(3, { status: 2, orderIndex: 0, arenaName: 'Finished Arena', scheduledStart: `${day}T08:00:00`, heats: [heat(33, { sessionId: 3, label: 'Heat 3', finishedAt: `${day}T08:30:00` })] }),
  ];
  state.value = { competition: competition({ startDate: day, endDate: day, sessions, ...extra }), reload, updatedAt };
}

function renderBoard(ui = <TimetableBoard />) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  // The fixture is a morning at the venue; pin the clock so the late-running maths doesn't depend on when the tests run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${day}T09:00:00`));
  localStorage.clear();
  auth.organise = false;
  reload.mockClear();
  setCompetition();
});

afterEach(() => { vi.useRealTimers(); });

it('shows a late row with its delay and the planned time struck through', () => {
  // Delays cascade within an arena, so the second session shares the first one's arena.
  setCompetition({}, null, 'Main Arena');
  const { container } = renderBoard();
  const late = container.querySelector('.tt-late')!;
  expect(late).toHaveTextContent('Heat 2');
  expect(late.querySelector('.tt-planned')).toHaveTextContent(/^\+6m · 11:00/);
  expect(late.querySelector('.tt-planned s')).toHaveTextContent(/11:00/);
  expect(late.querySelector('.tt-time')).toHaveClass('tt-time-late');
  expect(late.querySelector('.tt-shift-card')).toBeNull();
  // Screen readers get the planned time, the new time and the status in words.
  expect(late).toHaveTextContent(/Planned 11:00.*, now 11:06/);
  expect(late).toHaveTextContent('+6 min');
  // One amber line says so for the whole arena; the group heading just counts.
  expect(screen.getByRole('status')).toHaveTextContent('Main Arena is running 6 minutes late');
  expect(screen.queryByText('Main Arena · 6 min late')).toBeNull();
});

it('marks the running heat "ON NOW" without a planned-time note or late summary on the live session', () => {
  const { container } = renderBoard();
  const live = container.querySelector('.tt-live')!;
  expect(live).toHaveTextContent('Heat 1');
  expect(within(live as HTMLElement).getByText('ON NOW')).toBeInTheDocument();
  expect(live.querySelector('.tt-planned')).toBeNull();
  expect(live.querySelector('.tt-time')).not.toHaveClass('tt-time-late');
  expect(screen.getByText('Main Arena · 1 heat')).toBeVisible();
  expect(screen.queryByRole('status')).toBeNull();
});

it('uses the count in the group summary when nothing is late', () => {
  setCompetition({ sessions: [session(1, { arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'Heat 1' }), heat(12, { sessionId: 1, orderIndex: 1, label: 'Heat 2' })] })] });
  renderBoard();
  expect(screen.getByText('Main Arena · 2 heats')).toBeVisible();
  expect(document.querySelector('.tt-summary-late')).toBeNull();
});

it('shows only the most recent finished heat, greyed, until "Show full timetable" is tapped', () => {
  const { container } = renderBoard();
  // The one finished heat stays in view with the other rows, in its place by time.
  expect(screen.getByText('Heat 3')).toBeVisible();
  expect(container.querySelector('.tt-finished')).toHaveTextContent('Heat 3');
  expect(screen.queryByRole('heading', { name: /Finished/ })).toBeNull();
  expect(container.querySelector('.tt-collapsed')).toBeNull();
  // Nothing was hidden, so there is nothing to show.
  expect(screen.queryByRole('button', { name: 'Show full timetable' })).toBeNull();
});

it('hides earlier finished heats behind "Show full timetable", which becomes "Hide finished heats"', () => {
  setCompetition({
    sessions: [
      session(1, { status: 2, arenaName: 'Main Arena', scheduledStart: `${day}T07:00:00`, heats: [
        heat(11, { sessionId: 1, orderIndex: 0, label: 'Early heat', finishedAt: `${day}T07:20:00` }),
        heat(12, { sessionId: 1, orderIndex: 1, label: 'Middle heat', finishedAt: `${day}T07:50:00` }),
        heat(13, { sessionId: 1, orderIndex: 2, label: 'Latest heat', finishedAt: `${day}T08:20:00` }),
      ] }),
      session(2, { status: 0, orderIndex: 2, arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(21, { sessionId: 2, label: 'Upcoming heat' })] }),
    ],
  });
  renderBoard();
  expect(screen.getByText('Latest heat')).toBeVisible();
  expect(screen.getByText('Upcoming heat')).toBeVisible();
  expect(screen.queryByText('Early heat')).toBeNull();
  expect(screen.queryByText('Middle heat')).toBeNull();

  const toggle = screen.getByRole('button', { name: 'Show full timetable' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByText('Early heat')).toBeVisible();
  expect(screen.getByText('Middle heat')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Hide finished heats' }));
  expect(screen.queryByText('Early heat')).toBeNull();
  expect(screen.getByText('Latest heat')).toBeVisible();
});

it('filters by arena from the menu, flags the live arena and remembers the choice', () => {
  renderBoard();
  const select = screen.getByRole('combobox', { name: 'Arena' });
  fireEvent.click(select);
  expect(within(screen.getByRole('listbox', { name: 'Arena' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['All arenas', 'Finished Arena', 'Main ArenaON NOW', 'Arena Two']);
  expect(screen.getByText('Heat 1')).toBeVisible();

  fireEvent.click(screen.getByRole('option', { name: 'Arena Two' }));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(localStorage.getItem('mg.tt.arena.1')).toBe('Arena Two');
  expect(screen.getByText('Heat 2')).toBeVisible();
  expect(screen.queryByText('Heat 1')).toBeNull();
  expect(select).toHaveTextContent('Arena Two');

  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: 'All arenas' }));
  expect(localStorage.getItem('mg.tt.arena.1')).toBeNull();
  expect(screen.getByText('Heat 1')).toBeVisible();
});

it('starts on the arena remembered on this phone', () => {
  localStorage.setItem('mg.tt.arena.1', 'Main Arena');
  const { container } = renderBoard();
  expect(screen.getByRole('combobox', { name: 'Arena' })).toHaveTextContent('Main Arena');
  expect(container.querySelector('.tt-arena-live')).not.toBeNull();
  expect(screen.queryByText('Heat 2')).toBeNull();
});

it('ignores a remembered arena that is not on this day', () => {
  localStorage.setItem('mg.tt.arena.1', 'Gone Arena');
  renderBoard();
  expect(screen.getByRole('combobox', { name: 'Arena' })).toHaveValue('');
});

it('hides the strip when there is one day and one arena', () => {
  setCompetition({ sessions: [session(1, { arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'Heat 1' })] })] });
  const { container } = renderBoard();
  expect(container.querySelector('.tt-strip')).toBeNull();
  expect(screen.getByText('Heat 1')).toBeVisible();
});

it('offers a day dropdown when the event runs over several days', () => {
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  setCompetition({ endDate: tomorrow });
  const { container } = renderBoard();
  const select = screen.getByRole('combobox', { name: 'Day' });
  expect(select.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  // Day, arena and age group sit together on one navy line.
  expect(container.querySelector('.tt-strip')!.querySelectorAll('[role="combobox"]').length).toBeGreaterThanOrEqual(2);
  fireEvent.click(select);
  const options = within(screen.getByRole('listbox', { name: 'Day' })).getAllByRole('option');
  expect(options).toHaveLength(2);
  expect(options[0]).toHaveTextContent('Today');

  fireEvent.click(options[1]);
  expect(screen.getByText('Nothing scheduled for this day.')).toBeVisible();
  fireEvent.click(select);
  fireEvent.click(screen.getAllByRole('option')[0]);
  expect(screen.getByText('Heat 1')).toBeVisible();
});

it('has no day dropdown on a one-day event', () => {
  renderBoard();
  expect(screen.queryByRole('combobox', { name: 'Day' })).toBeNull();
});

function HeaderProbe() {
  const { header } = useCompactPageBarState();
  return <>
    <output data-testid="header">{JSON.stringify({ title: header?.title, subtitle: header?.subtitle, label: header?.refreshLabel })}</output>
    <button type="button" onClick={header?.refresh}>probe refresh</button>
  </>;
}

it('publishes its title, competition and update time, and the refresh, to the app header', () => {
  setCompetition({}, new Date(2026, 5, 1, 10, 54));
  const { container } = render(<MemoryRouter><CompactPageBarProvider><HeaderProbe /><TimetableBoard title="Seniors" /></CompactPageBarProvider></MemoryRouter>);
  expect(JSON.parse(screen.getByTestId('header').textContent!)).toEqual({ title: 'Seniors', subtitle: 'Spring Games · 10:54', label: 'Refresh timetable' });
  fireEvent.click(screen.getByRole('button', { name: 'probe refresh' }));
  expect(reload).toHaveBeenCalledTimes(1);
  // The page body no longer carries its own title band or refresh button.
  expect(container.querySelector('h1')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh timetable' })).toBeNull();
  expect(screen.queryByText(/^Updated/)).toBeNull();
});

it('defaults the header title to Timetable and leaves the time out until loaded', () => {
  render(<MemoryRouter><CompactPageBarProvider><HeaderProbe /><TimetableBoard /></CompactPageBarProvider></MemoryRouter>);
  expect(JSON.parse(screen.getByTestId('header').textContent!)).toMatchObject({ title: 'Timetable', subtitle: 'Spring Games' });
});

it('renders the bandExtra and lead slots, places Status colours above Show full timetable, and reveals footer inside Show full timetable', () => {
  renderBoard(<TimetableBoard bandExtra={<p>age chips</p>} lead={<p>toplist lead</p>} footer={<p>page footer</p>} />);
  expect(screen.getByText('age chips')).toBeVisible();
  expect(screen.getByText('toplist lead')).toBeVisible();
  expect(screen.queryByText('page footer')).toBeNull();

  const legend = screen.getByRole('list', { name: 'Status colours' });
  const toggle = screen.getByRole('button', { name: 'Show full timetable' });
  expect(toggle.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

  fireEvent.click(toggle);
  expect(screen.getByText('page footer')).toBeVisible();
});

it('lists break and briefing rows with their label and no chevron link', () => {
  setCompetition({ sessions: [
    session(1, { kind: 1, isBreak: true, name: 'Lunch', arenaName: 'Main Arena', scheduledStart: `${day}T12:00:00`, durationMinutes: 30 }),
    session(2, { kind: 2, name: 'Managers meeting', location: "Secretary's tent", scheduledStart: `${day}T12:30:00`, durationMinutes: 15 }),
  ] });
  renderBoard();
  expect(screen.getByText('Lunch')).toBeVisible();
  expect(screen.getByText('Break')).toBeVisible();
  expect(screen.getByText('Briefing')).toBeVisible();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});

it('links race rows to their heat and shows the legend', () => {
  renderBoard();
  expect(screen.getByRole('link', { name: /Heat 2/ })).toHaveAttribute('href', '/competitions/1/session/2?heat=22');
  expect(within(screen.getByRole('list', { name: 'Status colours' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['On time', 'Late', 'On now', 'Finished']);
});

it('shows a session with no heats as provisional to organisers, and hides it from everyone else', () => {
  const planned = session(4, { arenaName: 'Main Arena', name: 'Open', scheduledStart: `${day}T13:00:00`, durationMinutes: 60, orderIndex: 4 });
  setCompetition({ sessions: [...(state.value as { competition: { sessions: unknown[] } }).competition.sessions, planned] });
  const { unmount } = renderBoard();
  expect(screen.queryByText('Heats to follow')).not.toBeInTheDocument();
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
  unmount();

  auth.organise = true;
  renderBoard();
  const row = screen.getByText('Heats to follow').closest('.tt-row') as HTMLElement;
  expect(row).toHaveTextContent('Provisional');
  expect(screen.getByRole('note')).toHaveTextContent('Provisional timetable');
});

it('shows ON NOW · Race X of Y when a live heat has races, highlights followed teams, and keeps multi-arena sessions grouped chronologically by session', () => {
  localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ competitionId: 1, teamId: 7 }]));
  setCompetition({
    sessions: [
      session(1, {
        orderIndex: 1,
        status: 1,
        sectionName: 'Teams Under 12',
        arenaName: 'Arena 1',
        scheduledStart: `${day}T09:00:00`,
        minutesPerHeat: 15,
        heats: [
          heat(11, {
            sessionId: 1,
            orderIndex: 0,
            label: 'U12 Heat 1',
            entries: [{ id: 1, teamId: 7, teamName: 'Starred Team', laneIndex: 1 }],
            races: [race(1, { isComplete: true }), race(2, { isComplete: false }), race(3, { isComplete: false })],
          }),
          heat(12, { sessionId: 1, orderIndex: 1, label: 'U12 Heat 2' }),
        ],
      }),
      session(2, {
        orderIndex: 2,
        status: 0,
        competitionSectionId: 2,
        sectionName: 'Teams Under 15',
        arenaName: 'Arena 2',
        scheduledStart: `${day}T09:00:00`,
        minutesPerHeat: 15,
        heats: [
          heat(21, { sessionId: 2, orderIndex: 0, label: 'U15 Heat 1' }),
          heat(22, { sessionId: 2, orderIndex: 1, label: 'U15 Heat 2' }),
        ],
      }),
    ],
  });

  const { container } = renderBoard();
  const live = container.querySelector('.tt-live') as HTMLElement;
  expect(live).toHaveTextContent('ON NOW · Race 2 of 3');
  expect(live).toHaveAttribute('data-followed', 'true');

  // Concurrent sessions across arenas stay grouped as single session blocks rather than splitting heat-by-heat.
  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(['Under 12 · Session 1', 'Under 15 · Session 1']);
});

it('filters the timetable by age group (section) when the competition has multiple sections', () => {
  setCompetition({
    sections: [
      { id: 10, competitionId: 1, format: 2, ageGroup: 'Under 12', displayName: 'Teams Under 12' },
      { id: 20, competitionId: 1, format: 2, ageGroup: 'Under 15', displayName: 'Teams Under 15' },
    ],
    sessions: [
      session(1, {
        competitionSectionId: 10,
        sectionName: 'Teams Under 12',
        arenaName: 'Main Arena',
        scheduledStart: `${day}T10:00:00`,
        heats: [heat(11, { sessionId: 1, orderIndex: 0, label: 'U12 Heat 1' })],
      }),
      session(2, {
        competitionSectionId: 20,
        sectionName: 'Teams Under 15',
        arenaName: 'Main Arena',
        scheduledStart: `${day}T10:30:00`,
        heats: [heat(22, { sessionId: 2, orderIndex: 0, label: 'U15 Heat 1' })],
      }),
    ],
  });
  renderBoard();
  expect(screen.queryByRole('combobox', { name: 'Team' })).toBeNull();
  expect(screen.queryByRole('searchbox', { name: 'Search timetable' })).toBeNull();

  const select = screen.getByRole('combobox', { name: 'Age group' });
  fireEvent.click(select);
  expect(within(screen.getByRole('listbox', { name: 'Age group' })).getAllByRole('option').map((o) => o.textContent))
    .toEqual(['All ages', 'Under 12', 'Under 15']);

  fireEvent.click(screen.getByRole('option', { name: 'Under 15' }));
  expect(screen.getByText('U15 Heat 1')).toBeVisible();
  expect(screen.queryByText('U12 Heat 1')).toBeNull();

  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: 'All ages' }));
  expect(screen.getByText('U12 Heat 1')).toBeVisible();
});

it('hides the arena selector when viewing a specific section', () => {
  setCompetition({
    sessions: [
      session(1, { competitionSectionId: 9, arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'Heat 1' })] }),
      session(2, { competitionSectionId: 9, arenaName: 'Arena Two', scheduledStart: `${day}T11:00:00`, heats: [heat(22, { sessionId: 2, label: 'Heat 2' })] }),
    ],
  });
  renderBoard(<TimetableBoard sectionId={9} title="Under 12" />);
  expect(screen.queryByRole('combobox', { name: 'Arena' })).toBeNull();
});

it('links heat rows directly to the heat without a lanes dropdown and shows a single shift note and coloured time on moved upcoming sessions', () => {
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  setCompetition({
    endDate: tomorrow,
    sessions: [
      session(1, {
        status: 1,
        arenaName: 'Main Arena',
        scheduledStart: `${day}T10:00:00`,
        startedAt: `${day}T10:15:00`,
        heats: [
          heat(11, {
            sessionId: 1,
            orderIndex: 0,
            label: 'Heat 1',
            entries: [
              { id: 1, teamId: 101, teamName: 'Cheshire A', laneIndex: 1 },
              { id: 2, teamId: 102, teamName: 'Oakley B', laneIndex: 3 },
            ],
          }),
          heat(12, {
            sessionId: 1,
            orderIndex: 1,
            label: 'Heat 2',
          }),
        ],
      }),
      session(2, {
        status: 0,
        orderIndex: 2,
        arenaName: 'Main Arena',
        scheduledStart: `${day}T11:00:00`,
        heats: [
          heat(21, {
            sessionId: 2,
            orderIndex: 0,
            label: 'Upcoming Late Heat',
          }),
        ],
      }),
      session(3, {
        status: 0,
        orderIndex: 3,
        arenaName: 'Arena Two',
        scheduledStart: `${day}T10:45:00`,
        notes: '[shift:-15]',
        heats: [
          heat(31, {
            sessionId: 3,
            orderIndex: 0,
            label: 'Early Heat 3',
          }),
        ],
      }),
    ],
  });
  const { container } = renderBoard();
  expect(screen.queryByRole('button', { name: /Lanes for/i })).toBeNull();
  expect(screen.getByRole('link', { name: /Heat 1/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=11');
  expect(container.querySelector('.tt-strip')).not.toHaveClass('tt-strip-stacked');
  expect(container.querySelectorAll('.tt-shift-card')).toHaveLength(0);

  // Live session rows do not show how late they are running.
  const liveRow = screen.getByRole('link', { name: /Heat 1/ });
  const sameSessionRow = screen.getByRole('link', { name: /Heat 2/ });
  expect(liveRow.querySelector('.tt-planned')).toBeNull();
  expect(sameSessionRow.querySelector('.tt-planned')).toBeNull();

  // Subsequent session in the same arena shows how late it is running and colours the time.
  const upcomingLateRow = screen.getByRole('link', { name: /Upcoming Late Heat/ });
  expect(upcomingLateRow.querySelector('.tt-planned')).toHaveTextContent(/^\+15m · 10:00|^\+15m · 11:00/);
  expect(upcomingLateRow.querySelector('.tt-time')).toHaveClass('tt-time-late');

  // Early-shifted session shows negative shift and colours the time green.
  const earlyRow = screen.getByRole('link', { name: /Early Heat 3/ });
  expect(earlyRow.querySelector('.tt-planned')).toHaveTextContent(/^-15m · 11:00/);
  expect(earlyRow.querySelector('.tt-time')).toHaveClass('tt-time-early');

  // Switching to Day 2 in a 2-day, 2-arena competition keeps the Arena selector available.
  fireEvent.click(screen.getByRole('combobox', { name: 'Day' }));
  fireEvent.click(screen.getAllByRole('option')[1]);
  expect(screen.getByRole('combobox', { name: 'Arena' })).toBeInTheDocument();
});

it('formats delays of an hour or more as hours and minutes, and lets organisers move times, pause, resume and see pace from the timing sheet', async () => {
  const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: [] } as never);
  auth.organise = true;
  const completedRaces = [1, 2, 3, 4, 5].map((id) => race(id, { isComplete: true }));
  setCompetition({
    sessions: [
      session(1, {
        status: 2,
        orderIndex: 1,
        arenaName: 'Main Arena',
        scheduledStart: `${day}T09:00:00`,
        startedAt: `${day}T09:00:00`,
        heats: [
          heat(11, {
            sessionId: 1,
            orderIndex: 0,
            label: 'Finished Heat 1',
            durationMinutes: 30,
            startedAt: `${day}T09:00:00`,
            finishedAt: `${day}T09:20:00`,
            races: completedRaces,
          }),
        ],
      }),
      session(2, {
        status: 0,
        orderIndex: 2,
        arenaName: 'Main Arena',
        scheduledStart: `${day}T11:34:00`,
        notes: '[shift:+94]',
        heats: [
          heat(21, {
            sessionId: 2,
            orderIndex: 0,
            label: 'Very Late Heat',
          }),
        ],
      }),
    ],
  });

  const { unmount } = renderBoard();
  const lateRow = screen.getByRole('link', { name: /Very Late Heat/ });
  expect(lateRow.querySelector('.tt-planned')).toHaveTextContent('+1h 34m · 10:00');
  expect(lateRow).toHaveTextContent('+1h 34m');
  // For an organiser the late line is a button that opens the timing sheet; the old shift row is gone.
  expect(screen.queryByRole('group', { name: 'Delay timetable' })).toBeNull();
  expect(screen.queryByRole('spinbutton', { name: 'Custom delay minutes' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Main Arena is running 1h 34m late/ }));
  const sheet = screen.getByRole('dialog', { name: 'Main Arena timing' });
  expect(sheet).toHaveTextContent('Running 1h 34m late');
  expect(within(sheet).getByText('Races are taking about 4.0 minutes each.')).toBeInTheDocument();

  fireEvent.click(within(sheet).getByRole('switch', { name: 'Pause the timetable' }));
  await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/competitions/1/sessions/pause', { arenaName: 'Main Arena' }));

  fireEvent.click(within(sheet).getByRole('button', { name: '5 minutes later' }));
  fireEvent.click(within(sheet).getByRole('button', { name: '5 minutes later' }));
  fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/competitions/1/sessions/shift-times', { deltaMinutes: 10, arenaName: 'Main Arena' }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Main Arena timing' })).toBeNull());
  unmount();

  // When a session has a [paused:...] tag, the link says so, the sheet's switch is on, and switching it off posts to /resume.
  setCompetition({
    sessions: [
      session(2, {
        status: 0,
        orderIndex: 2,
        arenaName: 'Main Arena',
        scheduledStart: `${day}T10:00:00`,
        notes: '[paused:1700000000000]',
        heats: [heat(21, { sessionId: 2, orderIndex: 0, label: 'Paused Heat' })],
      }),
    ],
  });
  renderBoard();
  fireEvent.click(screen.getByRole('button', { name: 'Timetable paused' }));
  const pausedSheet = screen.getByRole('dialog', { name: 'Timing' });
  const pauseSwitch = within(pausedSheet).getByRole('switch', { name: 'Pause the timetable' });
  expect(pauseSwitch).toBeChecked();
  fireEvent.click(pauseSwitch);
  await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/competitions/1/sessions/resume', { arenaName: undefined }));
  postSpy.mockRestore();
});


it('updates the paused timetable as time passes without requiring a competition reload', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${day}T09:00:00`));
  setCompetition({ sessions: [session(1, {
    scheduledStart: `${day}T10:00:00`, notes: `[paused:${Date.now()}]`,
    heats: [heat(11, { label: 'Paused heat' })],
  })] });
  const view = renderBoard();
  expect(screen.getByRole('link', { name: /Paused heat/ })).toHaveTextContent('10:00');
  act(() => vi.advanceTimersByTime(6 * 60_000));
  expect(screen.getByRole('link', { name: /Paused heat/ })).toHaveTextContent('10:06');
  expect(reload).not.toHaveBeenCalled();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('reports pause and shift failures, keeps the sheet open for a failed move, and offers a retry', async () => {
  auth.organise = true;
  setCompetition({}, null, 'Main Arena');
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('offline'));
  renderBoard();
  fireEvent.click(screen.getByRole('button', { name: /Main Arena is running 6 minutes late/ }));
  const sheet = screen.getByRole('dialog', { name: 'Main Arena timing' });
  fireEvent.click(within(sheet).getByRole('switch', { name: 'Pause the timetable' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t pause the timetable');
  fireEvent.click(within(sheet).getByRole('button', { name: '5 minutes earlier' }));
  fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t shift the timetable'));
  expect(post).toHaveBeenLastCalledWith('/competitions/1/sessions/shift-times', { deltaMinutes: -5, arenaName: 'Main Arena' });
  // The sheet stays so the move isn't lost, and Try again sends it once more.
  expect(screen.getByRole('dialog', { name: 'Main Arena timing' })).toBeInTheDocument();
  expect(within(screen.getByRole('dialog', { name: 'Main Arena timing' })).getByText('-5 min')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
  post.mockRestore();
});

it('gives organisers a Running late? link when nothing is late, and nobody else', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: [] } as never);
  setCompetition({ sessions: [session(1, { status: 0, arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'Heat 1' })] })] });
  const spectator = renderBoard();
  expect(screen.queryByRole('button', { name: 'Running late?' })).toBeNull();
  spectator.unmount();

  auth.organise = true;
  renderBoard();
  fireEvent.click(screen.getByRole('button', { name: 'Running late?' }));
  const sheet = screen.getByRole('dialog', { name: 'Timing' });
  expect(sheet).toHaveTextContent('Running on time');
  // Done with no move closes the sheet without posting anything.
  fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Timing' })).toBeNull());
  expect(post).not.toHaveBeenCalled();
  post.mockRestore();
});

it('shows spectators the late line as plain text, not a button', () => {
  setCompetition({}, null, 'Main Arena');
  renderBoard();
  expect(screen.getByRole('status')).toHaveTextContent('Main Arena is running 6 minutes late');
  expect(screen.queryByRole('button', { name: /is running/ })).toBeNull();
});

it('warms a row once when a delay moves its start time while you watch, but not on first draw', () => {
  setCompetition({}, null, 'Main Arena');
  const { container, rerender } = renderBoard();
  expect(container.querySelector('.tt-shifted')).toBeNull();
  // Session 1 started later still, so session 2 in the same arena moves back again.
  const value = state.value as { competition: ReturnType<typeof competition> };
  const sessions = value.competition.sessions.map((s) => (s.id === 1 ? { ...s, startedAt: `${day}T10:15:00` } : s));
  state.value = { ...value, competition: { ...value.competition, sessions } };
  rerender(<MemoryRouter><TimetableBoard /></MemoryRouter>);
  const moved = container.querySelector('.tt-late')!;
  expect(moved).toHaveTextContent('Heat 2');
  expect(moved.querySelector('.tt-shifted')).not.toBeNull();
  expect(container.querySelectorAll('.tt-shifted')).toHaveLength(1);
});
