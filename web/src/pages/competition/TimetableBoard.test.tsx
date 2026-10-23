import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { competition, heat, session } from '../../test/factories';
import { dayKey } from '../../lib/timetableDay';
import { TimetableBoard } from './TimetableBoard';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context')>()), useCompetition: () => state.value }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => false }) }));

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

it('folds finished groups into one line under a divider and expands them on tap', () => {
  const { container } = renderBoard();
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
});

it('no longer offers the old "View complete timetable" toggle', () => {
  renderBoard();
  expect(screen.queryByRole('button', { name: /complete timetable|completed sessions/i })).toBeNull();
});

it('filters by arena from the native menu, flags the live arena and remembers the choice', () => {
  renderBoard();
  const select = screen.getByRole('combobox', { name: 'Arena' });
  expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['All arenas', 'Finished Arena', 'Main Arena · on now', 'Arena Two']);
  expect(screen.getByText('Heat 1')).toBeVisible();

  fireEvent.change(select, { target: { value: 'Arena Two' } });
  expect(localStorage.getItem('mg.tt.arena.1')).toBe('Arena Two');
  expect(screen.getByText('Heat 2')).toBeVisible();
  expect(screen.queryByText('Heat 1')).toBeNull();
  expect(select).toHaveValue('Arena Two');

  fireEvent.change(select, { target: { value: '' } });
  expect(localStorage.getItem('mg.tt.arena.1')).toBeNull();
  expect(screen.getByText('Heat 1')).toBeVisible();
});

it('starts on the arena remembered on this phone', () => {
  localStorage.setItem('mg.tt.arena.1', 'Main Arena');
  const { container } = renderBoard();
  expect(screen.getByRole('combobox', { name: 'Arena' })).toHaveValue('Main Arena');
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
  setCompetition({ startDate: yesterday, endDate: day });
  renderBoard();
  fireEvent.click(within(screen.getByRole('group', { name: 'Choose day' })).getAllByRole('button')[0]);
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
