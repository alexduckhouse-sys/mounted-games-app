import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  expect(screen.getAllByText('Main Arena · 6 min late').length).toBeGreaterThan(0);
});

it('marks the running heat "ON NOW" without a planned-time note or late summary on the live session', () => {
  const { container } = renderBoard();
  const live = container.querySelector('.tt-live')!;
  expect(live).toHaveTextContent('Heat 1');
  expect(within(live as HTMLElement).getByText('ON NOW')).toBeInTheDocument();
  expect(live.querySelector('.tt-planned')).toBeNull();
  expect(live.querySelector('.tt-time')).not.toHaveClass('tt-time-late');
  expect(screen.getByText('Main Arena · 1 heat')).toBeVisible();
  expect(screen.queryByText('Main Arena · 6 min late')).toBeNull();
});

it('uses the count in the group summary when nothing is late', () => {
  setCompetition({ sessions: [session(1, { arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'Heat 1' }), heat(12, { sessionId: 1, orderIndex: 1, label: 'Heat 2' })] })] });
  renderBoard();
  expect(screen.getByText('Main Arena · 2 heats')).toBeVisible();
  expect(document.querySelector('.tt-summary-late')).toBeNull();
});

it('hides finished groups behind "Show full timetable", then folds them into one line under a divider and expands them on tap', () => {
  const { container } = renderBoard();
  expect(screen.queryByRole('heading', { name: 'Finished today · 1' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Seniors · Session 1 · 1 finished/ })).toBeNull();

  const toggle = screen.getByRole('button', { name: 'Show full timetable' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);

  expect(screen.getByRole('heading', { name: 'Finished today · 1' })).toBeVisible();
  const folded = screen.getByRole('button', { name: /Seniors · Session 1 · 1 finished/ });
  expect(folded).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Heat 3')).toBeNull();
  // Active groups come first, the folded one last.
  expect(container.querySelector('.tt-collapsed')!.compareDocumentPosition(container.querySelector('.tt-live')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

  fireEvent.click(folded);
  expect(screen.getByText('Heat 3')).toBeVisible();
  const title = screen.getByRole('button', { name: /Seniors · Session 1/ });
  expect(title).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(title);
  expect(screen.queryByText('Heat 3')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Hide finished sessions' }));
  expect(screen.queryByRole('heading', { name: 'Finished today · 1' })).toBeNull();
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

it('offers a segmented day control when the event runs over several days', () => {
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  setCompetition({ endDate: tomorrow });
  renderBoard();
  const group = screen.getByRole('group', { name: 'Choose day' });
  const [first, second] = within(group).getAllByRole('button');
  expect(first).toHaveAccessibleName(/^Day 1, .*, today$/);
  expect(second).toHaveAccessibleName(/^Day 2, /);
  expect(second).not.toHaveAccessibleName(/today/);
  expect(first).toHaveAttribute('aria-pressed', 'true');
  expect(first.textContent).toMatch(/^[A-Z][a-z]{2}$/);

  fireEvent.click(second);
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(first).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('Nothing scheduled for this day.')).toBeVisible();
  fireEvent.click(first);
  expect(screen.getByText('Heat 1')).toBeVisible();
});

it('labels the folded section "Finished" rather than "today" on another day', () => {
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  setCompetition({
    startDate: yesterday,
    endDate: day,
    sessions: [session(3, { status: 2, orderIndex: 0, arenaName: 'Finished Arena', scheduledStart: `${yesterday}T08:00:00`, heats: [heat(33, { sessionId: 3, label: 'Heat 3', finishedAt: `${yesterday}T08:30:00` })] })],
  });
  renderBoard();
  fireEvent.click(within(screen.getByRole('group', { name: 'Choose day' })).getAllByRole('button')[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Show full timetable' }));
  expect(screen.getByRole('heading', { name: 'Finished · 1' })).toBeVisible();
  expect(screen.queryByText(/Finished today/)).toBeNull();
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
    .toEqual(['All age groups', 'Under 12', 'Under 15']);

  fireEvent.click(screen.getByRole('option', { name: 'Under 15' }));
  expect(screen.getByText('U15 Heat 1')).toBeVisible();
  expect(screen.queryByText('U12 Heat 1')).toBeNull();

  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: 'All age groups' }));
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
  expect(container.querySelector('.tt-strip')).toHaveClass('tt-strip-stacked');
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
  const [, day2Btn] = within(screen.getByRole('group', { name: 'Choose day' })).getAllByRole('button');
  fireEvent.click(day2Btn);
  expect(screen.getByRole('combobox', { name: 'Arena' })).toBeInTheDocument();
});

it('formats delays of an hour or more as hours and minutes, and lets organisers pause, resume, apply custom delays, and see pace', async () => {
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
  expect(screen.getByText('Main Arena · 1h 34m late')).toBeInTheDocument();
  expect(screen.getByText('Pace: ~4.0m/race')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/competitions/1/sessions/pause', { arenaName: undefined }));

  const input = screen.getByRole('spinbutton', { name: 'Custom delay minutes' });
  fireEvent.change(input, { target: { value: '95' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/competitions/1/sessions/shift-times', { deltaMinutes: 95, arenaName: undefined }));
  unmount();

  // When a session has a [paused:...] tag, the button switches to Continue and posts to /resume.
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
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/competitions/1/sessions/resume', { arenaName: undefined }));
  postSpy.mockRestore();
});
