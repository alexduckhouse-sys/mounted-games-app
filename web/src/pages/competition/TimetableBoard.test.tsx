import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  expect(late.querySelector('.tt-planned')).toHaveTextContent(/^\+6 · 11:00/);
  expect(late.querySelector('.tt-planned s')).toHaveTextContent(/11:00/);
  // Screen readers get the planned time, the new time and the status in words.
  expect(late).toHaveTextContent(/Planned 11:00.*, now 11:06/);
  expect(late).toHaveTextContent('+6 min');
  expect(screen.getAllByText('Main Arena · 6 min late').length).toBeGreaterThan(0);
});

it('marks the running heat "ON NOW" without a planned-time note', () => {
  const { container } = renderBoard();
  const live = container.querySelector('.tt-live')!;
  expect(live).toHaveTextContent('Heat 1');
  expect(within(live as HTMLElement).getByText('ON NOW')).toBeInTheDocument();
  expect(live.querySelector('.tt-planned')).toBeNull();
  expect(screen.getByText('Main Arena · 6 min late')).toBeVisible();
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

it('still renders the bandExtra, lead and footer slots', () => {
  renderBoard(<TimetableBoard bandExtra={<p>age chips</p>} lead={<p>toplist lead</p>} footer={<p>page footer</p>} />);
  expect(screen.getByText('age chips')).toBeVisible();
  expect(screen.getByText('toplist lead')).toBeVisible();
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

it('filters the timetable down to one team’s heats and shows their lane when heats have teams', () => {
  setCompetition({
    sessions: [
      session(1, {
        arenaName: 'Main Arena',
        scheduledStart: `${day}T10:00:00`,
        heats: [
          heat(11, {
            sessionId: 1,
            orderIndex: 0,
            label: 'Heat 1',
            entries: [
              { id: 1, teamId: 101, teamName: 'Cheshire A', laneIndex: 0 },
              { id: 2, teamId: 102, teamName: 'Oakley B', laneIndex: 2 },
            ],
          }),
          heat(12, {
            sessionId: 1,
            orderIndex: 1,
            label: 'Heat 2',
            entries: [
              { id: 3, teamId: 103, teamName: 'Romney C', laneIndex: 1 },
            ],
          }),
        ],
      }),
    ],
  });
  renderBoard();
  const select = screen.getByRole('combobox', { name: 'Team' });
  fireEvent.click(select);
  expect(within(screen.getByRole('listbox', { name: 'Team' })).getAllByRole('option').map((o) => o.textContent))
    .toEqual(['All teams', 'Cheshire A', 'Oakley B', 'Romney C']);

  fireEvent.click(screen.getByRole('option', { name: 'Oakley B' }));
  expect(screen.getByText('Heat 1')).toBeVisible();
  expect(screen.getByText('Lane 3')).toBeVisible();
  expect(screen.queryByText('Heat 2')).toBeNull();

  fireEvent.click(select);
  fireEvent.click(screen.getByRole('option', { name: 'All teams' }));
  expect(screen.getByText('Heat 2')).toBeVisible();
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

it('toggles the lanes dropdown on a heat row to reveal lane numbers and team links', () => {
  setCompetition({
    sessions: [
      session(1, {
        arenaName: 'Main Arena',
        scheduledStart: `${day}T10:00:00`,
        heats: [
          heat(11, {
            sessionId: 1,
            orderIndex: 0,
            label: 'Heat 1',
            entries: [
              { id: 1, teamId: 101, teamName: 'Cheshire A', laneIndex: 0 },
              { id: 2, teamId: 102, teamName: 'Oakley B', laneIndex: 2 },
            ],
          }),
        ],
      }),
    ],
  });
  renderBoard();
  const toggle = screen.getByRole('button', { name: 'Lanes for Heat 1' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('list', { name: 'Lanes for Heat 1' })).toBeNull();

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const lanesList = screen.getByRole('list', { name: 'Lanes for Heat 1' });
  expect(within(lanesList).getByText('Lane 1')).toBeVisible();
  expect(within(lanesList).getByText('Lane 3')).toBeVisible();
  expect(within(lanesList).getByRole('link', { name: 'Cheshire A' })).toHaveAttribute('href', '/competitions/1/teams/101');
  expect(within(lanesList).getByRole('link', { name: 'Oakley B' })).toHaveAttribute('href', '/competitions/1/teams/102');

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('list', { name: 'Lanes for Heat 1' })).toBeNull();
});
