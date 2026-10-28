import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { TickerProvider, useTicker } from '../../components/TickerContext';
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

function HeaderProbe() {
  const { header } = useCompactPageBarState();
  return <>
    <output data-testid="header">{JSON.stringify({ title: header?.title, subtitle: header?.subtitle, label: header?.refreshLabel })}</output>
    <button type="button" onClick={header?.refresh}>probe refresh</button>
    {header?.edit && <button type="button" aria-pressed={!!header.editing} onClick={header.edit}>{header.editLabel}</button>}
  </>;
}
/** Stands in for the ticker dock: the filter button the board puts beside it. */
function DockProbe() {
  const { dockAction } = useTicker();
  return dockAction ? <button type="button" onClick={dockAction.onClick}>{`${dockAction.label} (${dockAction.count})`}</button> : null;
}
function renderWithDock(ui = <TimetableBoard />) {
  return render(<MemoryRouter><CompactPageBarProvider><TickerProvider><HeaderProbe /><DockProbe />{ui}</TickerProvider></CompactPageBarProvider></MemoryRouter>);
}
const filterButton = () => screen.queryByRole('button', { name: /^Day, arena and age group/ });
const openFilters = () => { fireEvent.click(filterButton()!); return screen.getByRole('dialog', { name: 'Day, arena and age group' }); };
const header = () => JSON.parse(screen.getByTestId('header').textContent!) as { title: string; subtitle: string; label: string };
const weekday = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });

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

it('shows a late row with just "+6" beside it, no struck-out planned time', () => {
  // Delays cascade within an arena, so the second session shares the first one's arena.
  setCompetition({}, null, 'Main Arena');
  const { container } = renderBoard();
  const late = container.querySelector('.tt-late')!;
  expect(late).toHaveTextContent('Heat 2');
  expect(late.querySelector('.tt-planned')!.textContent).toBe('+6');
  expect(late.querySelector('.tt-planned s')).toBeNull();
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

it('filters by arena from the slider in the filter sheet, shows it as a chip and remembers the choice', () => {
  renderWithDock();
  expect(filterButton()).toHaveTextContent('(0)');
  const sheet = openFilters();
  const arenas = within(within(sheet).getByRole('group', { name: 'Arena' })).getAllByRole('button');
  expect(arenas.map((button) => button.textContent)).toEqual(['All arenas', 'Finished Arena', 'Main Arena', 'Arena Two']);
  expect(arenas[0]).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Heat 1')).toBeVisible();

  fireEvent.click(arenas[3]);
  expect(localStorage.getItem('mg.tt.arena.1')).toBe('Arena Two');
  expect(within(sheet).getByRole('button', { name: 'Arena Two' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Heat 2')).toBeVisible();
  expect(screen.queryByText('Heat 1')).toBeNull();
  expect(within(sheet).getByRole('button', { name: 'Show 1 heat' })).toBeVisible();
  expect(header().subtitle).toBe(`${weekday(day)} · Arena Two`);
  expect(filterButton()).toHaveTextContent('(1)');

  // The chip under the header clears it again.
  fireEvent.click(screen.getByRole('button', { name: 'Remove Arena Two' }));
  expect(localStorage.getItem('mg.tt.arena.1')).toBeNull();
  expect(screen.getByText('Heat 1')).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
});

it('closes the filter sheet from "Show N heats"', async () => {
  renderWithDock();
  const sheet = openFilters();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Show 3 heats' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('starts on the arena remembered on this phone', () => {
  localStorage.setItem('mg.tt.arena.1', 'Main Arena');
  renderBoard();
  expect(screen.getByRole('button', { name: 'Remove Main Arena' })).toBeVisible();
  expect(screen.queryByText('Heat 2')).toBeNull();
});

it('ignores a remembered arena that is not on this day', () => {
  localStorage.setItem('mg.tt.arena.1', 'Gone Arena');
  renderBoard();
  expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  expect(screen.getByText('Heat 2')).toBeVisible();
});

it('puts no filter button beside the ticker when there is one day and one arena', () => {
  setCompetition({ sessions: [session(1, { arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'Heat 1' })] })] });
  renderWithDock();
  expect(filterButton()).toBeNull();
  expect(screen.getByText('Heat 1')).toBeVisible();
});

it('offers day tabs, named by weekday, when the event runs over several days, and slides the new day in from its side', () => {
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  setCompetition({ endDate: tomorrow });
  const { container } = renderWithDock();
  const sheet = openFilters();
  const days = within(within(sheet).getByRole('group', { name: 'Day' })).getAllByRole('button');
  expect(days.map((button) => button.textContent)).toEqual([weekday(day), weekday(tomorrow)]);
  expect(days[0]).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(days[0]);
  expect(container.querySelector('.tt-body')!.className).toBe('tt-body');

  fireEvent.click(days[1]);
  expect(screen.getByText('Nothing scheduled for this day.')).toBeVisible();
  expect(container.querySelector('.tt-body')).toHaveClass('tt-in-right-1');
  expect(header().subtitle).toBe(weekday(tomorrow));
  fireEvent.click(days[0]);
  expect(screen.getByText('Heat 1')).toBeVisible();
  expect(container.querySelector('.tt-body')).toHaveClass('tt-in-left-0');
});

it('names days by short weekday over a long event, and adds the date when two share a name', () => {
  const plus = (n: number) => dayKey(new Date(Date.now() + n * 86_400_000));
  setCompetition({ endDate: plus(3) });
  const { unmount } = renderWithDock();
  expect(within(openFilters()).getAllByRole('button', { pressed: false })[0].textContent).toMatch(/^[A-Z][a-z]{2}$/);
  unmount();
  setCompetition({ endDate: plus(7) });
  renderWithDock();
  expect(within(openFilters()).getAllByRole('button', { pressed: false })[0].textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
});

it('has no day tabs on a one-day event', () => {
  renderWithDock();
  expect(within(openFilters()).queryByRole('group', { name: 'Day' })).toBeNull();
});

it('publishes its title, competition and update time, and the refresh, to the app header when there is nothing to filter', () => {
  setCompetition({ sessions: [session(1, { arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'Heat 1' })] })] }, new Date(2026, 5, 1, 10, 54));
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
  setCompetition({ sessions: [] });
  render(<MemoryRouter><CompactPageBarProvider><HeaderProbe /><TimetableBoard /></CompactPageBarProvider></MemoryRouter>);
  expect(JSON.parse(screen.getByTestId('header').textContent!)).toMatchObject({ title: 'Timetable', subtitle: 'Spring Games' });
});

it('says in the header line what is showing once there is something to filter', () => {
  setCompetition({ sections: [
    { id: 10, competitionId: 1, format: 2, ageGroup: 'Under 12', displayName: 'Teams Under 12' },
    { id: 20, competitionId: 1, format: 2, ageGroup: 'Under 15', displayName: 'Teams Under 15' },
  ] }, new Date(2026, 5, 1, 10, 54));
  renderWithDock();
  expect(header().subtitle).toBe(`${weekday(day)} · All ages`);
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

it('gives a break its own heading line with how long it lasts, and lists briefings with their label and no chevron link', () => {
  setCompetition({ sessions: [
    session(1, { kind: 1, isBreak: true, name: 'Lunch', arenaName: 'Main Arena', scheduledStart: `${day}T12:00:00`, durationMinutes: 30 }),
    session(2, { kind: 2, name: 'Managers meeting', location: "Secretary's tent", scheduledStart: `${day}T12:30:00`, durationMinutes: 15 }),
  ] });
  const { container } = renderBoard();
  expect(screen.getByText('Lunch')).toBeVisible();
  expect(screen.getByRole('heading', { level: 2, name: 'Break' })).toBeVisible();
  expect(screen.getByText('Main Arena · 30 minutes')).toBeVisible();
  // The heading says it is a break, so the row underneath doesn't repeat it.
  expect(container.querySelector('.tt-sub')).toHaveTextContent('Briefing');
  expect(container.querySelectorAll('.tt-sub')).toHaveLength(1);
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

it('shows everyone an age group’s finals at the time the organiser set, before the draw', () => {
  const finals = session(5, { arenaName: 'Arena Two', name: 'Juniors finals', sectionName: 'Juniors', competitionSectionId: 2, scheduledStart: `${day}T15:30:00`, orderIndex: 5 });
  const unset = session(6, { arenaName: 'Main Arena', name: 'Seniors finals', sectionName: 'Seniors', competitionSectionId: 3, orderIndex: 6 });
  setCompetition({ sessions: [...(state.value as { competition: { sessions: unknown[] } }).competition.sessions, finals, unset] });
  renderBoard();
  const block = screen.getByRole('region', { name: 'Juniors · Finals' });
  const row = within(block).getByRole('link', { name: /Finals start/ });
  expect(row).toHaveTextContent(/15:30|03:30 PM/);
  expect(row).toHaveTextContent('Teams decided by the heats');
  expect(row).toHaveAttribute('href', '/competitions/1/session/5');
  expect(block).not.toHaveTextContent(/\d finals?\b/);
  expect(screen.queryByRole('region', { name: 'Seniors · Finals' })).not.toBeInTheDocument();
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
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
  // The star comes after the heat's name.
  const title = live.querySelector('.tt-event strong')!;
  expect(title.lastElementChild).toHaveClass('tt-fav-star');

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
  const { container } = renderWithDock();
  const sheet = openFilters();
  const tiles = within(within(sheet).getByRole('group', { name: 'Age group' })).getAllByRole('button');
  // No "All ages" tile: with none chosen you see every age.
  expect(tiles.map((tile) => tile.querySelector('strong')!.textContent)).toEqual(['Under 12', 'Under 15']);
  expect(tiles[0].querySelector('span')).toHaveTextContent(/^1 heat · next 10:00/);
  expect(tiles[1].querySelector('span')).toHaveTextContent(/^1 heat · next 10:30/);

  fireEvent.click(tiles[1]);
  expect(tiles[1]).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('U15 Heat 1')).toBeVisible();
  expect(screen.queryByText('U12 Heat 1')).toBeNull();
  expect(header().subtitle).toBe(`${weekday(day)} · Under 15`);
  expect(screen.getByRole('button', { name: 'Remove Under 15' })).toBeVisible();

  // Tapping the chosen tile again goes back to every age.
  fireEvent.click(tiles[1]);
  expect(screen.getByText('U12 Heat 1')).toBeVisible();
  expect(container.querySelector('.tt-tiles')).toBeInTheDocument();

  fireEvent.click(tiles[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Under 12' }));
  expect(screen.getByText('U15 Heat 1')).toBeVisible();
});

it('says on an age group tile when it is on now, when it has finished, or that it has nothing that day', () => {
  setCompetition({
    sections: [
      { id: 10, competitionId: 1, format: 2, ageGroup: 'Under 12', displayName: 'Teams Under 12' },
      { id: 20, competitionId: 1, format: 2, ageGroup: 'Under 15', displayName: 'Teams Under 15' },
      { id: 30, competitionId: 1, format: 2, ageGroup: 'Open', displayName: 'Open' },
    ],
    sessions: [
      session(1, { competitionSectionId: 10, status: 1, arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, startedAt: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'U12 Heat 1' }), heat(12, { sessionId: 1, orderIndex: 1, label: 'U12 Heat 2' })] }),
      session(2, { competitionSectionId: 20, status: 2, arenaName: 'Main Arena', scheduledStart: `${day}T08:00:00`, heats: [heat(21, { sessionId: 2, label: 'U15 Heat 1', finishedAt: `${day}T08:20:00` })] }),
    ],
  });
  renderWithDock();
  const tiles = within(within(openFilters()).getByRole('group', { name: 'Age group' })).getAllByRole('button');
  expect(tiles.map((tile) => tile.querySelector('span')!.textContent)).toEqual(['2 heats · on now', '1 heat', 'Nothing this day']);
});

it('has nothing to filter when viewing a specific section on one day', () => {
  setCompetition({
    sessions: [
      session(1, { competitionSectionId: 9, arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, heats: [heat(11, { sessionId: 1, label: 'Heat 1' })] }),
      session(2, { competitionSectionId: 9, arenaName: 'Arena Two', scheduledStart: `${day}T11:00:00`, heats: [heat(22, { sessionId: 2, label: 'Heat 2' })] }),
    ],
  });
  renderWithDock(<TimetableBoard sectionId={9} title="Under 12" />);
  expect(filterButton()).toBeNull();
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
  const { container } = renderWithDock();
  expect(screen.queryByRole('button', { name: /Lanes for/i })).toBeNull();
  expect(screen.getByRole('link', { name: /Heat 1/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=11');
  expect(container.querySelectorAll('.tt-shift-card')).toHaveLength(0);

  // Live session rows do not show how late they are running.
  const liveRow = screen.getByRole('link', { name: /Heat 1/ });
  const sameSessionRow = screen.getByRole('link', { name: /Heat 2/ });
  expect(liveRow.querySelector('.tt-planned')).toBeNull();
  expect(sameSessionRow.querySelector('.tt-planned')).toBeNull();

  // Subsequent session in the same arena shows how late it is running and colours the time.
  const upcomingLateRow = screen.getByRole('link', { name: /Upcoming Late Heat/ });
  expect(upcomingLateRow.querySelector('.tt-planned')!.textContent).toBe('+15');
  expect(upcomingLateRow.querySelector('.tt-time')).toHaveClass('tt-time-late');

  // Early-shifted session shows negative shift and colours the time green.
  const earlyRow = screen.getByRole('link', { name: /Early Heat 3/ });
  expect(earlyRow.querySelector('.tt-planned')!.textContent).toBe('−15');
  expect(earlyRow.querySelector('.tt-time')).toHaveClass('tt-time-early');

  // Switching to Day 2 in a 2-day, 2-arena competition keeps the arena slider available.
  const sheet = openFilters();
  fireEvent.click(within(within(sheet).getByRole('group', { name: 'Day' })).getAllByRole('button')[1]);
  expect(within(sheet).getByRole('group', { name: 'Arena' })).toBeInTheDocument();
});

it('formats delays of an hour or more as hours and minutes, and lets organisers move the times by typed minutes from the timing sheet behind the pencil', async () => {
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

  const { unmount } = renderWithDock();
  const lateRow = screen.getByRole('link', { name: /Very Late Heat/ });
  expect(lateRow.querySelector('.tt-planned')!.textContent).toBe('+1h 34m');
  expect(screen.getByText('Main Arena is running 1h 34m late')).toHaveClass('tt-late-line');

  // The timing sheet stays out of the way until the pencil in the header opens it.
  expect(screen.queryByRole('dialog')).toBeNull();
  const pencil = screen.getByRole('button', { name: 'Change the timing' });
  fireEvent.click(pencil);
  expect(pencil).toHaveAttribute('aria-pressed', 'true');
  const sheet = screen.getByRole('dialog', { name: 'Timing' });
  expect(sheet).toHaveTextContent('Running 1h 34m late');
  expect(within(sheet).getByText('Races are taking about 4.0 minutes each.')).toBeInTheDocument();
  // There is no Pause any more, and nothing is paused to continue.
  expect(within(sheet).queryByRole('switch')).toBeNull();
  expect(within(sheet).queryByRole('button', { name: 'Continue the timetable' })).toBeNull();

  fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'Move times by' }), { target: { value: '95' } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Shift' }));
  await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/competitions/1/sessions/shift-times', { deltaMinutes: 95, arenaName: undefined }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(pencil).toHaveAttribute('aria-pressed', 'false');
  unmount();

  // A timetable paused before Pause went can still be set going again from the sheet.
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
  renderWithDock();
  fireEvent.click(screen.getByRole('button', { name: 'Change the timing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue the timetable' }));
  await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/competitions/1/sessions/resume', { arenaName: undefined }));
  postSpy.mockRestore();
});

it('gives everyone else no pencil', () => {
  renderWithDock();
  expect(screen.queryByRole('button', { name: 'Change the timing' })).toBeNull();
});

it('moves only the arena being shown', async () => {
  auth.organise = true;
  localStorage.setItem('mg.tt.arena.1', 'Arena Two');
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: [] } as never);
  renderWithDock();
  fireEvent.click(screen.getByRole('button', { name: 'Change the timing' }));
  const sheet = screen.getByRole('dialog', { name: 'Arena Two timing' });
  expect(sheet).toHaveTextContent('Running on time');
  fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'Move times by' }), { target: { value: '-10' } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Shift' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/competitions/1/sessions/shift-times', { deltaMinutes: -10, arenaName: 'Arena Two' }));
  post.mockRestore();
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

it('reports continue and shift failures, keeping the sheet open with the minutes typed', async () => {
  auth.organise = true;
  setCompetition({ sessions: [session(2, {
    arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, notes: '[paused:1700000000000]',
    heats: [heat(21, { sessionId: 2, label: 'Paused Heat' })],
  })] });
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('offline'));
  renderWithDock();
  fireEvent.click(screen.getByRole('button', { name: 'Change the timing' }));
  const sheet = screen.getByRole('dialog', { name: 'Timing' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Continue the timetable' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/competitions/1/sessions/resume', { arenaName: undefined }));
  expect(await screen.findByText('Couldn’t continue the timetable. Check your signal and try again.')).toBeInTheDocument();
  const input = within(sheet).getByRole('spinbutton', { name: 'Move times by' });
  fireEvent.change(input, { target: { value: '12' } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Shift' }));
  expect(await within(sheet).findByRole('alert')).toHaveTextContent('Couldn’t move the times');
  expect(screen.getByText('Couldn’t shift the timetable. Check your signal and try again.')).toBeInTheDocument();
  expect(input).toHaveValue(12);

  // "Try again" on the page's notice sends the same move again.
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
  post.mockRestore();
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
