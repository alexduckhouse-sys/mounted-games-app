import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import type { Heat, Session, StandingRow } from '../../types';
import { ScoringTab } from './ScoringTab';

const state = vi.hoisted(() => ({ value: null as unknown, get: vi.fn(), manage: false }));
vi.mock('./context', () => ({ useCompetition: () => state.value }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canManage: () => state.manage }) }));
vi.mock('../../api', () => ({ api: { get: state.get, post: vi.fn() } }));
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
    reload,
  };
}

function Probe() {
  const { search } = useLocation();
  const { header } = useCompactPageBarState();
  return <>
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

describe('the view tabs', () => {
  it('opens on Finals when the age group has finals with results', async () => {
    renderTab();
    await screen.findByRole('region', { name: 'Finals' });
    const tabs = screen.getByRole('group', { name: 'Toplist view' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Finals', 'Totals', 'By session']);
    expect(within(tabs).getByRole('button', { name: 'Finals' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers only Totals and Sessions without finals, and opens on Totals', async () => {
    setCompetition([qualifier]);
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    const tabs = screen.getByRole('group', { name: 'Toplist view' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Totals', 'By session']);
    expect(screen.queryByRole('button', { name: 'Finals' })).toBeNull();
  });

  it('ignores a final nobody has a result in yet', async () => {
    setCompetition([qualifier, finalSession({ races: [race(2)] })]);
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    expect(screen.queryByRole('button', { name: 'Finals' })).toBeNull();
  });

  it('switches between finals, totals and the points by session', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Finals' }));
    expect(screen.getByRole('region', { name: 'Finals' })).toBeVisible();
  });

  it('starts the next age group on its own default view', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('region', { name: 'Finals' });
    await user.click(screen.getByRole('combobox', { name: 'Age group' }));
    await user.click(screen.getByRole('option', { name: 'Under 14' }));
    await screen.findByText('Team 8');
    expect(screen.getByRole('region', { name: 'Totals' })).toBeVisible();
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

describe('the team sheet', () => {
  it('opens with the qualifying and final points and the races, and Esc closes it and returns focus', async () => {
    const user = userEvent.setup();
    renderTab();
    const list = await screen.findByRole('list', { name: 'A Final' });
    const opener = within(list).getByRole('button', { name: /Team 1/ });
    opener.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Team 1');
    expect(within(dialog).getByText('Under 12 · rode 1 session + A Final')).toBeVisible();
    expect(within(dialog).getByText(/1st · 3 pts/)).toBeVisible();
    expect(within(dialog).getByText(/2nd · 4 pts/)).toBeVisible();
    expect(within(dialog).getByRole('region', { name: 'A Final' })).toHaveTextContent('not carried over');
    expect(within(dialog).getByRole('region', { name: 'Session 1 · Heat 1' })).toHaveTextContent('Race 11st3 points');
    expect(within(dialog).getByRole('button', { name: 'Close team breakdown' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('closes from the close button and the backdrop, and keeps Tab inside', async () => {
    const user = userEvent.setup();
    renderTab();
    const list = await screen.findByRole('list', { name: 'A Final' });
    await user.click(within(list).getByRole('button', { name: /Team 2/ }));
    const dialog = screen.getByRole('dialog');
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close team breakdown' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: 'Close team breakdown' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Close team breakdown' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(within(list).getByRole('button', { name: /Team 2/ }));
    await user.pointer({ target: screen.getByRole('dialog').parentElement!, keys: '[MouseLeft]' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the totals and the sessions table, and says when a team did not ride', async () => {
    const other = session(4, { competitionSectionId: 9, orderIndex: 4, name: 'Under 12 heats 2', heats: [heat(4, { sessionId: 4, label: 'Heat 2', entries: entries([2]), races: [race(4, { name: 'Race 4' })] })] });
    setCompetition([qualifier, other]);
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('region', { name: 'Totals' });
    await user.click(within(screen.getByRole('region', { name: 'Totals' })).getByRole('button', { name: /Team 1/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('region', { name: 'Session 2' })).toHaveTextContent('Didn’t ride this session');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'By session' }));
    await user.click(within(screen.getByRole('region', { name: 'Points by session' })).getByRole('button', { name: 'Team 2' }));
    expect(within(screen.getByRole('dialog')).getByRole('region', { name: 'Session 2 · Heat 2' })).toHaveTextContent('Not ridden yet');
  });
});

describe('the totals list', () => {
  it('keeps the cut-off, run-off, per-row notes and hors concours teams', async () => {
    state.get.mockResolvedValue({ data: [standing(1, 10), standing(2, 6), standing(3, 6), standing(4, 2)], headers: {} });
    setCompetition([session(1, { competitionSectionId: 9, heats: [heat(1, { entries: entries([4]), races: [race(1), race(2)] })] })], {
      teams: [team(1), team(2), team(3), team(4), team(5, { competitionSectionId: 9, isHorsConcours: true, displayName: 'Guest' })],
      sections: [{ id: 9, displayName: 'Under 12', finalistCount: 2, runoffRaceName: 'Sword' }] as never,
    });
    renderTab();
    const totals = await screen.findByRole('region', { name: 'Totals' });
    expect(within(totals).getAllByText('Joint 2nd · run-off')).toHaveLength(2);
    expect(within(totals).getByText('5 needed to make the final')).toBeVisible();
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
  it('keeps the age group menu and the collapsible toplist, with the create finals button for organisers', async () => {
    state.manage = true;
    const user = userEvent.setup();
    renderTab('/?section=9', { toplistOnly: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Under 12' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Age group' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Create finals/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Show Under 12 toplist/ }));
    await screen.findByRole('region', { name: 'Finals' });
    await user.click(screen.getByRole('combobox', { name: 'Age group' }));
    await user.click(screen.getByRole('option', { name: 'Under 14' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?section=10');
  });
});
