import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import type { Heat, Session, StandingRow } from '../../types';
import { ScoringTab } from './ScoringTab';

const state = vi.hoisted(() => ({ value: null as unknown, get: vi.fn(), manage: false }));
vi.mock('./context', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context')>()), useCompetition: () => state.value }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canManage: () => state.manage }) }));
vi.mock('../../api', () => ({ api: { get: state.get, post: vi.fn() } }));
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

function renderTab(path = '/?section=9', props: { toplistOnly?: boolean } = { toplistOnly: true }) {
  return render(<MemoryRouter initialEntries={[path]}><CompactPageBarProvider><Probe /><ScoringTab {...props} /></CompactPageBarProvider></MemoryRouter>);
}

beforeEach(() => {
  state.manage = false;
  reload.mockClear();
  state.get.mockReset();
  state.get.mockImplementation((_url: string, config: { params: { sectionId: number } }) =>
    Promise.resolve({ data: config.params.sectionId === 9 ? standings : otherStandings, headers: {} }));
  setCompetition([qualifier, finalSession()]);
});

const rowNames = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.textContent);

describe('the toplist page header', () => {
  it('publishes the title, competition and progress, and refreshes the standings', async () => {
    const user = userEvent.setup();
    const { container } = renderTab();
    await screen.findByRole('group', { name: 'Toplist view' });
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
    await screen.findByRole('group', { name: 'Toplist view' });
    expect(JSON.parse(screen.getByTestId('header').textContent!).subtitle).toBe('Hartpury Festival');
  });

  it('does not publish a header when embedded in the timetable', async () => {
    renderTab('/?section=9', { toplistOnly: false });
    expect(screen.getByTestId('header').textContent).toBe(JSON.stringify({}));
  });
});

describe('the age group select', () => {
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
    renderTab('/', { toplistOnly: true });
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
    renderTab('/?section=9', { toplistOnly: false });
    expect(await screen.findByRole('navigation', { name: 'Age groups' })).toBeInTheDocument();
  });
});

describe('the view tabs', () => {
  it('opens on Finals when the age group has finals with results', async () => {
    renderTab();
    await screen.findByRole('region', { name: 'Finals' });
    const tabs = screen.getByRole('group', { name: 'Toplist view' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Finals', 'Totals', 'By session', 'By game', 'Heat tables']);
    expect(within(tabs).getByRole('button', { name: 'Finals' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers Totals, By session, By game and Heat tables without finals, and opens on Totals', async () => {
    setCompetition([qualifier]);
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    const tabs = screen.getByRole('group', { name: 'Toplist view' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Totals', 'By session', 'By game', 'Heat tables']);
    expect(screen.queryByRole('button', { name: 'Finals' })).toBeNull();
  });

  it('ignores a final nobody has a result in yet', async () => {
    setCompetition([qualifier, finalSession({ races: [race(2)] })]);
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    expect(screen.queryByRole('button', { name: 'Finals' })).toBeNull();
  });

  it('switches between finals, totals, points by session and heat tables', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('region', { name: 'Finals' });
    await user.click(screen.getByRole('button', { name: 'Totals' }));
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(screen.getByText('Top 2 make the final')).toBeVisible();
    expect(within(totals).getByRole('separator', { name: 'Final cut-off' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'By session' }));
    const table = screen.getByRole('region', { name: 'Points by session' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['#', 'Team', 'S1', 'F', 'Pts', 'Open']);
    await user.click(screen.getByRole('button', { name: 'Heat tables' }));
    expect(screen.getByRole('region', { name: 'Heat tables' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Finals' }));
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
    await user.click(screen.getByRole('button', { name: 'By session' }));
    expect(screen.getByRole('region', { name: 'Points by session' })).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'Age group' }));
    await user.click(screen.getByRole('option', { name: 'Under 14' }));
    await screen.findByText('Team 8');
    expect(screen.getByRole('button', { name: 'By session' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Points by session' })).toBeVisible();
  });
});

describe('the finals list', () => {
  it('orders each final by its points with the place, the winner trophy and the qualifying chip', async () => {
    renderTab();
    const list = await screen.findByRole('list', { name: 'A Final' });
    expect(rowNames(list)).toEqual(['1stTeam 3Q3Qualified 3rd6 points', '2ndTeam 1Q1Qualified 1st4 points', '3rdTeam 2Q2Qualified 2nd2 points']);
    expect(within(list).getAllByRole('img', { name: 'Winner' })).toHaveLength(1);
  });

  it('gives tied teams the same place and lists every final under its own label', async () => {
    const second = session(3, { competitionSectionId: 9, name: 'Under 12 finals', orderIndex: 3, heats: [heat(3, { sessionId: 3, label: 'B Final', raceRoundStage: 2, entries: entries([4, 5, 6]), races: [scored(3, [4, 1, 5], [5, 1, 5], [6, 3, 1])] })] });
    setCompetition([qualifier, second, finalSession()]);
    renderTab();
    await screen.findByRole('list', { name: 'A Final' });
    const labels = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(labels).toEqual(['A Final', 'B Final']);
    expect(rowNames(screen.getByRole('list', { name: 'B Final' }))).toEqual(['1stTeam 45 points', '1stTeam 55 points', '3rdTeam 61 points']);
    // No qualifying position for teams that did not take part in qualifying.
    expect(within(screen.getByRole('list', { name: 'B Final' })).queryByText(/Qualified/)).toBeNull();
  });

  it('names a final from its session when the heat has no final wording', async () => {
    setCompetition([qualifier, session(2, { competitionSectionId: 9, name: 'Under 12 final', heats: [heat(2, { sessionId: 2, label: 'Heat 1', entries: entries([1]), races: [scored(2, [1, 1, 4])] })] })]);
    renderTab();
    await screen.findByRole('list', { name: 'Under 12 final · Heat 1' });
  });
});

describe('navigating to a team page from the toplist', () => {
  it('navigates straight to the full team page from finals', async () => {
    const user = userEvent.setup();
    renderTab();
    const list = await screen.findByRole('list', { name: 'A Final' });
    await user.click(within(list).getByRole('link', { name: /Team 1/ }));
    expect(screen.getByTestId('path').textContent).toBe('/competitions/1/teams/1');
  });

  it('navigates straight to the full team page from totals and sessions tables', async () => {
    const other = session(4, { competitionSectionId: 9, orderIndex: 4, name: 'Under 12 heats 2', heats: [heat(4, { sessionId: 4, label: 'Heat 2', entries: entries([2]), races: [race(4, { name: 'Race 4' })] })] });
    setCompetition([qualifier, other]);
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    await user.click(within(screen.getByRole('region', { name: 'Totals' })).getByRole('link', { name: /Team 1/ }));
    expect(screen.getByTestId('path').textContent).toBe('/competitions/1/teams/1');
    await user.click(screen.getByRole('button', { name: 'By session' }));
    await user.click(within(screen.getByRole('region', { name: 'Points by session' })).getByRole('link', { name: 'Team 2' }));
    expect(screen.getByTestId('path').textContent).toBe('/competitions/1/teams/2');
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
    expect(within(totals).getAllByText('Joint 2nd · run-off')).toHaveLength(2);
    expect(within(totals).getByText('5 needed to make the final (normal finishes)')).toBeVisible();
    expect(within(totals).getByRole('separator', { name: 'Final cut-off' })).toBeVisible();
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
    expect(alert).toHaveTextContent('Couldn’t load results');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('group', { name: 'Toplist view' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says there are no results yet', async () => {
    state.get.mockResolvedValue({ data: [], headers: {} });
    renderTab();
    await screen.findByText('No results yet.');
    expect(screen.queryByRole('group', { name: 'Toplist view' })).toBeNull();
  });
});

describe('embedded in the timetable', () => {
  it('keeps the age group menu, 3-way sub-tabs (Draw / Heats, Heat Scores, Toplist) and the collapsible toplist, with the create finals button for organisers', async () => {
    state.manage = true;
    const user = userEvent.setup();
    renderTab('/?section=9', { toplistOnly: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Under 12' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Age group' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Create finals/ })).toBeVisible();
    const sectionTabs = screen.getByRole('group', { name: 'Section view' });
    expect(within(sectionTabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Draw / Heats', 'Heat Scores', 'Toplist']);
    expect(screen.getByRole('region', { name: 'Draw and starting lanes' })).toBeVisible();
    await user.click(within(sectionTabs).getByRole('button', { name: 'Heat Scores' }));
    expect(screen.getByRole('region', { name: 'Section heat scores' })).toBeVisible();
    await user.click(within(screen.getByRole('group', { name: 'Section view' })).getByRole('button', { name: 'Draw / Heats' }));
    await user.click(screen.getByRole('button', { name: /Show Under 12 toplist/ }));
    await screen.findByRole('region', { name: 'Finals' });
    await user.click(screen.getByRole('combobox', { name: 'Age group' }));
    await user.click(screen.getByRole('option', { name: 'Under 14' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?section=10');
  });

  it('switches to heat scores without rendering the timetable underneath, and back again', async () => {
    const user = userEvent.setup();
    renderTab('/?section=9', { toplistOnly: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Under 12' })).toBeVisible();
    const toggle = screen.getByRole('button', { name: 'Heat Scores' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(screen.queryByRole('heading', { level: 1, name: 'Under 12' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Heat Scores' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Section heat scores' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Draw / Heats' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Under 12' })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1, name: /Heat 1 scores/ })).toBeNull();
  });
});
