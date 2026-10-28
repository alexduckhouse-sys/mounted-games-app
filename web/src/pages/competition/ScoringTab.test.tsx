import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { TickerProvider, useTicker } from '../../components/TickerContext';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import type { CompetitionDetail, Heat, Session, StandingRow } from '../../types';
import { ScoringTab } from './ScoringTab';

const state = vi.hoisted(() => ({ value: null as unknown, get: vi.fn(), manage: false }));
vi.mock('./context', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context')>()), useCompetition: () => state.value }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canManage: () => state.manage }) }));
vi.mock('../../api', () => ({ api: { get: state.get, post: vi.fn() } }));
// Stands in for 30 seconds passing (useHeldFor has its own timing test).
const held = vi.hoisted(() => ({ value: true }));
vi.mock('../../hooks/useHeldFor', () => ({ useHeldFor: (active: boolean) => active && held.value }));
// The Tack & Turnout table fetches on its own; it has its own tests.
vi.mock('./TackLeaderboard', () => ({ TackLeaderboard: () => null }));
vi.mock('./TimetableBoard', () => ({
  TimetableBoard: ({ bandExtra, lead, title }: { bandExtra?: React.ReactNode; lead?: React.ReactNode; title?: string }) => <div><h1>{title}</h1>{bandExtra}{lead}</div>,
}));

const reload = vi.fn();
const entries = (ids: number[]): Heat['entries'] => ids.map((teamId, lane) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: lane }));
const scored = (id: number, ...pairs: [number, number, number][]) => race(id, { name: `Race ${id}`, isComplete: true, results: pairs.map(([teamId, placing, points]) => result(teamId, placing, { points })) });

const qualifier: Session = session(1, { competitionSectionId: 9, name: 'Under 12 heats', status: 2, heats: [heat(1, { sessionId: 1, label: 'Heat 1', entries: entries([1, 2, 3]), races: [scored(1, [1, 1, 3], [2, 2, 2], [3, 3, 1])] })] });
const finalSession = (extra: Partial<Heat> = {}): Session => session(2, { competitionSectionId: 9, name: 'Under 12 finals', heats: [heat(2, { sessionId: 2, label: 'A Final', raceRoundStage: 2, entries: entries([1, 2, 3]), races: [scored(2, [3, 1, 6], [1, 2, 4], [2, 3, 2])], ...extra })] });
const standings: StandingRow[] = [standing(3, 7), standing(1, 7), standing(2, 4)];
const otherStandings: StandingRow[] = [standing(8, 3)];

function setCompetition(sessions: Session[], extra: Record<string, unknown> = {}) {
  state.value = {
    competition: competition({
      name: 'Hartpury Festival',
      sections: [{ id: 9, displayName: 'Under 12', finalistCount: 2 }, { id: 10, displayName: 'Under 14' }] as never,
      teams: [team(1, { competitionSectionId: 9 }), team(2, { competitionSectionId: 9 }), team(3, { competitionSectionId: 9 }), team(8, { competitionSectionId: 10 })],
      sessions,
      ...extra,
    }),
    streams: [],
    reload,
  };
}

function Probe() {
  const { pathname, search } = useLocation();
  const { header } = useCompactPageBarState();
  return <>
    <output data-testid="path">{pathname}</output>
    <output data-testid="search">{search}</output>
    <output data-testid="header">{JSON.stringify({ title: header?.title, subtitle: header?.subtitle, label: header?.refreshLabel })}</output>
    <button type="button" onClick={header?.refresh}>probe refresh</button>
  </>;
}

function renderTab(path = '/?section=9', props: { startOn?: 'draw' | 'scores' | 'toplist' } = { startOn: 'toplist' }) {
  return render(<MemoryRouter initialEntries={[path]}><CompactPageBarProvider><Probe /><ScoringTab {...props} /></CompactPageBarProvider></MemoryRouter>);
}

beforeEach(() => {
  held.value = true;
  state.manage = false;
  reload.mockClear();
  state.get.mockReset();
  state.get.mockImplementation((_url: string, config: { params: { sectionId: number } }) =>
    Promise.resolve({ data: config.params.sectionId === 9 ? standings : otherStandings, headers: {} }));
  setCompetition([qualifier, finalSession()]);
});

/** The "Show  Totals ›" row inside Toplist, and picking a view from the list it opens. */
const showRow = () => screen.findByRole('combobox', { name: 'Show' });
async function pickView(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await showRow());
  await user.click(within(screen.getByRole('listbox', { name: 'Show' })).getByRole('option', { name }));
}

const rowNames = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.textContent);

describe('the toplist page header', () => {
  it('publishes the title, competition and progress, and refreshes the standings', async () => {
    const user = userEvent.setup();
    const { container } = renderTab();
    await showRow();
    expect(JSON.parse(screen.getByTestId('header').textContent!)).toEqual({ title: 'Toplist', subtitle: 'Hartpury Festival · After session 1', label: 'Refresh toplist' });
    expect(state.get).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'probe refresh' }));
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
    // The page body carries no title band of its own.
    expect(container.querySelector('h1')).toBeNull();
  });

  it('leaves the competition name alone before any session is done', async () => {
    setCompetition([session(1, { competitionSectionId: 9, heats: [heat(1, { entries: entries([1]), races: [race(1)] })] })]);
    renderTab();
    await showRow();
    expect(JSON.parse(screen.getByTestId('header').textContent!).subtitle).toBe('Hartpury Festival');
  });

  it('does not publish a header when embedded in the timetable', async () => {
    renderTab('/?section=9', {});
    expect(screen.getByTestId('header').textContent).toBe(JSON.stringify({}));
  });
});

describe('the age group select', () => {
  it('keeps Heats first when opened from the menu', () => {
    renderTab('/?section=9', { startOn: 'draw' });
    const tabs = screen.getByRole('group', { name: 'Age group view' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Heats', 'Scores', 'Toplist']);
  });

  it('lists the age groups with the current one and its team count', async () => {
    renderTab();
    const select = screen.getByRole('combobox', { name: 'Age group' });
    expect(select).toHaveTextContent('Under 123 teams');
    await userEvent.click(select);
    const options = within(screen.getByRole('listbox', { name: 'Age group' })).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Under 12', 'Under 14']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('changes the section in the URL and loads that age group', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByText('Team 3');
    await user.click(screen.getByRole('combobox', { name: 'Age group' }));
    await user.click(screen.getByRole('option', { name: 'Under 14' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?section=10');
    await screen.findByText('Team 8');
    expect(screen.getByRole('combobox', { name: 'Age group' })).toHaveTextContent('Under 14');
    expect(state.get).toHaveBeenLastCalledWith('/competitions/1/standings', { params: { sectionId: 10 } });
  });

  it('is hidden when there is only one age group, and the old chips are gone', () => {
    setCompetition([qualifier], { sections: [{ id: 9, displayName: 'Under 12' }] });
    renderTab();
    expect(screen.queryByRole('combobox', { name: 'Age group' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Under 14' })).toBeNull();
  });

  it('shows no age groups message without sections', () => {
    setCompetition([], { sections: [] });
    renderTab('/', { startOn: 'toplist' });
    expect(screen.getByText('No age groups yet.')).toBeVisible();
  });
});

describe('the age group rail on a laptop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists every age group down the left instead of the menu, and switches on a click', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const user = userEvent.setup();
    renderTab();
    const rail = await screen.findByRole('navigation', { name: 'Age groups' });
    expect(within(rail).getByRole('button', { name: /Under 12/ })).toHaveAttribute('aria-current', 'true');
    expect(within(rail).getByRole('button', { name: /Under 14/ })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('button', { name: /^Age group/ })).not.toBeInTheDocument();
    await user.click(within(rail).getByRole('button', { name: /Under 14/ }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?section=10'));
  });

  it('wraps the timetable board too when it is not the toplist page', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    renderTab('/?section=9', {});
    expect(await screen.findByRole('navigation', { name: 'Age groups' })).toBeInTheDocument();
  });
});

describe('the Show row inside Toplist', () => {
  it('opens on Finals when the age group has finals with results', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('region', { name: 'Finals' });
    expect(await showRow()).toHaveTextContent('Finals');
    await user.click(await showRow());
    expect(within(screen.getByRole('listbox', { name: 'Show' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Totals', 'By session', 'Finals', 'Scores by heat']);
    expect(screen.queryByRole('option', { name: 'By game' })).toBeNull();
  });

  it('offers Totals, By session and Scores by heat without finals, opens on Totals, and Scores by heat shows the heat tables', async () => {
    const user = userEvent.setup();
    setCompetition([qualifier]);
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    expect(await showRow()).toHaveTextContent('Totals');
    await user.click(await showRow());
    expect(within(screen.getByRole('listbox', { name: 'Show' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Totals', 'By session', 'Scores by heat']);
    await user.click(screen.getByRole('option', { name: 'Scores by heat' }));
    expect(await screen.findByRole('region', { name: 'Section heat scores' })).toBeInTheDocument();
  });

  it('ignores a final nobody has a result in yet', async () => {
    setCompetition([qualifier, finalSession({ races: [race(2)] })]);
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    expect(await showRow()).toHaveTextContent('Totals');
  });

  it('switches between finals, totals and points by session', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('region', { name: 'Finals' });
    await pickView(user, 'Totals');
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(screen.getByText('Top 2 make the final')).toBeVisible();
    expect(within(totals).getByRole('separator', { name: 'A Final cut-off' })).toBeVisible();
    await pickView(user, 'By session');
    const table = screen.getByRole('region', { name: 'Points by session' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['#', 'Team', 'S1', 'F', 'Pts']);
    await pickView(user, 'Finals');
    expect(screen.getByRole('region', { name: 'Finals' })).toBeVisible();
  });

  it('starts the next age group on its own default view when none was chosen, and keeps By session when chosen', async () => {
    setCompetition([
      qualifier,
      finalSession(),
      session(5, { competitionSectionId: 10, name: 'Under 14 heats', status: 2, heats: [heat(5, { sessionId: 5, label: 'Heat 1', entries: entries([8]), races: [scored(5, [8, 1, 3])] })] }),
    ]);
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('region', { name: 'Finals' });
    await pickView(user, 'By session');
    expect(screen.getByRole('region', { name: 'Points by session' })).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'Age group' }));
    await user.click(screen.getByRole('option', { name: 'Under 14' }));
    await screen.findByText('Team 8');
    expect(await showRow()).toHaveTextContent('By session');
    expect(screen.getByRole('region', { name: 'Points by session' })).toBeVisible();
  });
});

/** The ticker dock's page button, as AppShell draws it. */
function DockButton() {
  const { dockAction } = useTicker();
  return dockAction ? <button type="button" data-icon={dockAction.icon ?? 'filters'} onClick={dockAction.onClick}>{dockAction.label}</button> : null;
}

describe('the Show sheet beside the ticker dock', () => {
  const renderWithDock = (path = '/?section=9') => render(
    <MemoryRouter initialEntries={[path]}><TickerProvider><CompactPageBarProvider><ScoringTab startOn="toplist" /><DockButton /></CompactPageBarProvider></TickerProvider></MemoryRouter>,
  );

  it('puts a "What to show" filters button by the dock instead of the Show row, and picks a view from a sheet', async () => {
    const user = userEvent.setup();
    renderWithDock();
    await screen.findByRole('region', { name: 'Finals' });
    expect(screen.queryByRole('combobox', { name: 'Show' })).toBeNull();
    const button = await screen.findByRole('button', { name: 'What to show' });
    expect(button).toHaveAttribute('data-icon', 'filters');
    await user.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Show' });
    const choices = within(sheet).getAllByRole('radio');
    expect(choices.map((c) => c.textContent)).toEqual(['Totals', 'By session', 'Finals', 'Scores by heat']);
    expect(within(sheet).getByRole('radio', { name: 'Finals' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).getByRole('radio', { name: 'Totals' })).toHaveAttribute('aria-checked', 'false');
    await user.click(within(sheet).getByRole('radio', { name: 'Scores by heat' }));
    expect(await screen.findByRole('region', { name: 'Section heat scores' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Show' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'What to show' }));
    expect(within(await screen.findByRole('dialog', { name: 'Show' })).getByRole('radio', { name: 'Scores by heat' })).toHaveAttribute('aria-checked', 'true');
  });

  it('offers no button when Totals is the only thing to show', async () => {
    setCompetition([], { sections: [{ id: 9, displayName: 'Under 12', finalistCount: 2 }] as never });
    renderWithDock();
    await screen.findByRole('region', { name: 'Totals' });
    expect(screen.queryByRole('button', { name: 'What to show' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Show' })).toBeNull();
  });
});

describe('the finals list', () => {
  it('orders each final by its points with the place and the winner trophy, without qualifying chips', async () => {
    renderTab();
    const list = await screen.findByRole('list', { name: 'A Final' });
    expect(rowNames(list)).toEqual(['1stTeam 3Champions6 points', '2ndTeam 14 points', '3rdTeam 22 points']);
    expect(within(list).getAllByRole('img', { name: 'Winner' })).toHaveLength(1);
  });

  it('gives tied teams the same place and lists every final under its own label', async () => {
    const second = session(3, { competitionSectionId: 9, name: 'Under 12 finals', orderIndex: 3, heats: [heat(3, { sessionId: 3, label: 'B Final', raceRoundStage: 2, entries: entries([4, 5, 6]), races: [scored(3, [4, 1, 5], [5, 1, 5], [6, 3, 1])] })] });
    setCompetition([qualifier, second, finalSession()]);
    renderTab();
    await screen.findByRole('list', { name: 'A Final' });
    const labels = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(labels).toEqual(['A Final', 'B Final']);
    expect(rowNames(screen.getByRole('list', { name: 'B Final' }))).toEqual(['1stTeam 4Champions5 points', '1stTeam 5Champions5 points', '3rdTeam 61 points']);
    // No qualifying position for teams that did not take part in qualifying.
    expect(within(screen.getByRole('list', { name: 'B Final' })).queryByText(/Qualified/)).toBeNull();
  });

  it('names a final from its session when the heat has no final wording', async () => {
    setCompetition([qualifier, session(2, { competitionSectionId: 9, name: 'Under 12 final', heats: [heat(2, { sessionId: 2, label: 'Heat 1', entries: entries([1]), races: [scored(2, [1, 1, 4])] })] })]);
    renderTab();
    await screen.findByRole('list', { name: 'Under 12 final · Heat 1' });
  });
});

describe('opening a team from the toplist', () => {
  it('opens the team sheet from finals, and its link goes to the full team page', async () => {
    const user = userEvent.setup();
    renderTab();
    const list = await screen.findByRole('list', { name: 'A Final' });
    await user.click(within(list).getByRole('button', { name: /Team 1/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('link', { name: 'Full team page' }));
    expect(screen.getByTestId('path').textContent).toBe('/competitions/1/teams/1');
  });

  it('opens the team sheet from the totals and sessions tables', async () => {
    const other = session(4, { competitionSectionId: 9, orderIndex: 4, name: 'Under 12 heats 2', heats: [heat(4, { sessionId: 4, label: 'Heat 2', entries: entries([2]), races: [race(4, { name: 'Race 4' })] })] });
    setCompetition([qualifier, other]);
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    await user.click(within(screen.getByRole('region', { name: 'Totals' })).getByRole('button', { name: /Team 1/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('link', { name: 'Full team page' }));
    expect(screen.getByTestId('path').textContent).toBe('/competitions/1/teams/1');
  });
});

describe('the totals list', () => {
  it('keeps the cut-off, run-off, per-row notes and hors concours teams', async () => {
    state.get.mockResolvedValue({ data: [standing(1, 10), standing(2, 6), standing(3, 6), standing(4, 2)], headers: {} });
    setCompetition([session(1, { competitionSectionId: 9, heats: [heat(1, { entries: entries([4, 5, 6]), races: [race(1), race(2)] })] })], {
      teams: [team(1), team(2), team(3), team(4), team(5, { competitionSectionId: 9, isHorsConcours: true, displayName: 'Guest' }), team(6, { competitionSectionId: 9, isHorsConcours: true })],
      sections: [{ id: 9, displayName: 'Under 12', finalistCount: 2, runoffRaceName: 'Sword' }] as never,
    });
    renderTab();
    const totals = await screen.findByRole('region', { name: 'Totals' });
    // Tied teams share the number and a soft tint; no bar and no words.
    const tied = totals.querySelectorAll('li[data-tied="true"]');
    expect([...tied].map((li) => li.getAttribute('data-rank-id'))).toEqual(['2', '3']);
    expect((tied[0] as HTMLElement).style.background).toBe('rgb(var(--mg-heading) / .07)');
    expect(within(totals).queryByText(/Joint|run-off/)).toBeNull();
    expect(within(totals).getByText('6 pts needed for the A Final (normal finishes)')).toBeVisible();
    expect(within(totals).queryByText(/races? left/)).toBeNull();
    expect(within(totals).getByRole('separator', { name: 'A Final cut-off' })).toBeVisible();
    expect(within(totals).getByText('Hors concours')).toBeVisible();
    expect(within(totals).getByText('Guest')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Run-off for 2nd' })).toBeVisible();
    expect(screen.getByText(/Sword/)).toBeVisible();
  });
});

describe('loading and failure states', () => {
  it('shows the error with a retry, then the list', async () => {
    const user = userEvent.setup();
    state.get.mockRejectedValueOnce(new Error('offline'));
    renderTab();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the results. Check your signal and try again.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await showRow();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says there are no results yet', async () => {
    state.get.mockResolvedValue({ data: [], headers: {} });
    renderTab();
    await screen.findByText('No results yet.');
    expect(screen.queryByRole('group', { name: 'Toplist view' })).toBeNull();
  });
});

describe('the age group page', () => {
  it('has the age group bar over three tabs: Heats, Scores and Toplist, opening on Heats from the menu', async () => {
    state.manage = true;
    const user = userEvent.setup();
    renderTab('/?section=9', {});
    expect(screen.getByRole('heading', { level: 1, name: 'Under 12' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Age group' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Create finals/ })).toBeVisible();
    const tabs = screen.getByRole('group', { name: 'Age group view' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Heats', 'Scores', 'Toplist']);
    expect(within(tabs).getByRole('button', { name: 'Heats' })).toHaveAttribute('aria-pressed', 'true');
    // "Show <age group> toplist" is gone: the Toplist tab replaces it.
    expect(screen.queryByRole('button', { name: /Show Under 12 toplist/ })).toBeNull();
    await user.click(within(tabs).getByRole('button', { name: 'Scores' }));
    expect(screen.getByRole('region', { name: 'Section heat scores' })).toBeVisible();
    await user.click(within(screen.getByRole('group', { name: 'Age group view' })).getByRole('button', { name: 'Toplist' }));
    await screen.findByRole('region', { name: 'Finals' });
    await user.click(screen.getByRole('combobox', { name: 'Age group' }));
    await user.click(screen.getByRole('option', { name: 'Under 14' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?section=10');
  });

  it('shows only the toplist from the Toplists tab: the age group bar, no tab row, and the toplist header', async () => {
    renderTab();
    expect(screen.getByRole('combobox', { name: 'Age group' })).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Age group view' })).toBeNull();
    await showRow();
    expect(JSON.parse(screen.getByTestId('header').textContent!)).toMatchObject({ title: 'Toplist' });
  });

  it('puts the tabs straight under the age group bar on the page from the menu', () => {
    renderTab('/?section=9', {});
    const bar = screen.getByRole('combobox', { name: 'Age group' });
    const tabs = screen.getByRole('group', { name: 'Age group view' });
    expect(bar.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the heat tables under Scores, not in the toplist, on the page from the menu', async () => {
    const user = userEvent.setup();
    renderTab('/?section=9', {});
    await user.click(screen.getByRole('button', { name: 'Toplist' }));
    await showRow();
    expect(screen.queryByRole('region', { name: 'Heat tables' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Scores' }));
    expect(screen.getByRole('region', { name: 'Section heat scores' })).toBeVisible();
    expect(JSON.parse(screen.getByTestId('header').textContent!)).toMatchObject({ title: 'Under 12', subtitle: 'Hartpury Festival', label: 'Refresh scores' });
  });

  it('creates finals in the planned finals session, with its races filled in', async () => {
    state.manage = true;
    const user = userEvent.setup();
    setCompetition([qualifier, session(7, { competitionSectionId: 9, name: 'Finals · Under 12', status: 0, plannedRaces: ['Bending', 'Flag'], heats: [] })]);
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    state.get.mockImplementation((url: string) => Promise.resolve({ data: url.includes('standings') ? standings : [], headers: {} }));
    renderTab('/?section=9', {});
    await user.click(screen.getByRole('button', { name: /Create finals/ }));
    const dialogButton = (await screen.findAllByRole('button', { name: /Create finals/ })).at(-1)!;
    await user.click(dialogButton);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/\/finals$/), expect.objectContaining({
      raceNames: ['Bending', 'Flag'], existingSessionId: 7,
    })));
  });
});

describe('personalisation, instant optimistic standings and section score fingerprint', () => {
  it('defaults to the followed team age group or mg.prefs.defaultAgeGroup when ?section is omitted', async () => {
    localStorage.setItem('mg.favourites.v1', JSON.stringify([{ competitionId: 1, teamId: 8 }]));
    const { unmount } = renderTab('/', { startOn: 'toplist' });
    expect(screen.getByRole('combobox', { name: 'Age group' })).toHaveTextContent('Under 14');
    unmount();

    localStorage.removeItem('mg.favourites.v1');
    localStorage.setItem('mg.prefs.defaultAgeGroup', 'Under 14');
    renderTab('/', { startOn: 'toplist' });
    expect(screen.getByRole('combobox', { name: 'Age group' })).toHaveTextContent('Under 14');
  });

  it('persists the chosen toplist view tab in localStorage and restores it on mount', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTab();
    await screen.findByRole('region', { name: 'Finals' });
    await pickView(user, 'By session');
    expect(localStorage.getItem('mg.prefs.toplistView')).toBe('sessions');
    unmount();

    renderTab();
    expect(await screen.findByRole('region', { name: 'Points by session' })).toBeVisible();
    expect(await showRow()).toHaveTextContent('By session');
  });

  it('keeps official standings during live refresh and invalidates combined-session and HC changes', async () => {
    setCompetition([qualifier]);
    // The server sends the resolved order for tied totals; array order alone is not a tie-break.
    state.get.mockResolvedValueOnce({ data: [standing(3, 7, { tieBreakOrder: 1 }), standing(1, 7, { tieBreakOrder: 2 }), standing(2, 4)], headers: {} });
    const view = renderTab('/?section=9', { startOn: 'toplist' });
    await screen.findByRole('region', { name: 'Totals' });
    expect(state.get).toHaveBeenCalledTimes(1);
    const original = state.value as { competition: CompetitionDetail; reload: typeof reload };
    const redraw = () => view.rerender(<MemoryRouter initialEntries={['/?section=9']}><CompactPageBarProvider><Probe /><ScoringTab startOn="toplist" /></CompactPageBarProvider></MemoryRouter>);
    state.value = { ...original, competition: { ...original.competition, sessions: [{ ...qualifier, startedAt: '2026-06-01T10:05:00Z' }] } };
    redraw();
    expect(state.get).toHaveBeenCalledTimes(1);

    let resolveStandings!: (v: unknown) => void;
    state.get.mockReturnValueOnce(new Promise((resolve) => { resolveStandings = resolve; }));
    const combined = session(5, { competitionSectionId: null, heats: [heat(5, { entries: entries([1, 8]), races: [scored(5, [1, 1, 30])] })] });
    state.value = { ...original, competition: { ...original.competition, sessions: [qualifier, combined] } };
    held.value = false;
    redraw();
    expect(state.get).toHaveBeenCalledTimes(2);
    // A refresh shows the old standings without a notice; it only appears once they have lasted 30 seconds.
    expect(screen.queryByText('Showing saved standings while results refresh.')).toBeNull();
    held.value = true;
    redraw();
    expect(screen.getByText('Showing saved standings while results refresh.')).toBeVisible();
    expect(rowNames(screen.getByRole('region', { name: 'Totals' }))[0]).toContain('Team 3');
    resolveStandings({ data: [standing(1, 40), standing(3, 7), standing(2, 4)], headers: {} });
    await waitFor(() => expect(rowNames(screen.getByRole('region', { name: 'Totals' }))[0]).toContain('Team 1'));
    expect(screen.queryByText('Showing saved standings while results refresh.')).toBeNull();

    state.get.mockResolvedValueOnce({ data: [standing(3, 7), standing(2, 4)], headers: {} });
    const beforeHc = state.value as typeof original;
    state.value = { ...beforeHc, competition: { ...beforeHc.competition, teams: beforeHc.competition.teams.map((item) => item.id === 1 ? { ...item, isHorsConcours: true } : item) } };
    redraw();
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(rowNames(screen.getByRole('region', { name: 'Totals' }))[0]).toContain('Team 3'));
  });
});


it('defaults to a populated age group when an earlier section is empty', async () => {
  setCompetition([qualifier], {
    sections: [{ id: 8, displayName: 'Empty section' }, { id: 9, displayName: 'Under 12' }],
  });
  renderTab('/');
  await waitFor(() => expect(state.get).toHaveBeenCalledWith('/competitions/1/standings', { params: { sectionId: 9 } }));
});

it('has no organiser button row: PA desk, TV kiosk and QR codes are in the menu', async () => {
  state.manage = true;
  renderTab('/?section=10', {});
  await waitFor(() => expect(state.get).toHaveBeenCalled());
  expect(screen.queryByRole('region', { name: 'Organiser quick actions' })).toBeNull();
  for (const name of [/PA Commentator/, /TV Kiosk/, /QR Access/]) {
    expect(screen.queryByRole('link', { name })).toBeNull();
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
});

describe('Create finals row', () => {
  it('shows for an organiser once every session in the age group is done, and opens the finals sheet', async () => {
    state.manage = true;
    const user = userEvent.setup();
    renderTab('/?section=9', {});
    await user.click(screen.getByRole('button', { name: /Create finals/ }));
    expect(await screen.findAllByRole('button', { name: /Create finals/ })).toHaveLength(2);
  });

  it('stays hidden while a session is still to run, for spectators, and when the age group has no sessions', async () => {
    state.manage = true;
    const running = session(3, { competitionSectionId: 9, name: 'Under 12 later', status: 1, heats: [heat(3, { sessionId: 3, label: 'Heat 2', entries: entries([1, 2, 3]), races: [race(3, { name: 'Race 3' })] })] });
    setCompetition([qualifier, running]);
    const view = renderTab('/?section=9', {});
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Create finals/ })).toBeNull();
    view.unmount();

    setCompetition([qualifier]);
    state.manage = false;
    const spectator = renderTab('/?section=9', {});
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Create finals/ })).toBeNull();
    spectator.unmount();

    state.manage = true;
    renderTab('/?section=10', {});
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Create finals/ })).toBeNull();
  });
});
