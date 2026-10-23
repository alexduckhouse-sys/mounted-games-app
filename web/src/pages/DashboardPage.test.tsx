import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, heat, race, session, team } from '../test/factories';
import type { CompetitionPickerItem, MySignup } from '../types';
import { DashboardPage } from './DashboardPage';
import { NeedsYouContext } from './profile/needsYou';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string; fullName: string; clubName: string | null; roles: string[] }, roles: [] as string[] }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: auth.user, hasRole: (role: string) => auth.roles.includes(role) }) }));
const current = vi.hoisted(() => ({ value: null as null | { id: number; name: string } }));
vi.mock('../competition/CurrentCompetitionContext', () => ({ useCurrentCompetition: () => ({ current: current.value }) }));

const today = new Date();
const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0);
const at = (h: number, m: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m).toISOString();
const pickerItem = (extra: Partial<CompetitionPickerItem> = {}): CompetitionPickerItem => ({ id: 1, name: 'Hartpury Area Festival', startDate: startToday.toISOString(), endDate: null, icon: 'flag', ...extra });
const entry = (teamId: number, laneIndex = 2) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex });
const hartpury = () => competition({
  id: 1, name: 'Hartpury Area Festival', startDate: startToday.toISOString(), location: 'Hartpury College', sections: [],
  teams: [team(1, { displayName: 'Stockport A', sectionName: 'Open', relationship: 'trainer' }), team(2, { displayName: 'Stockport B', sectionName: 'Junior', relationship: 'trainer' })],
  sessions: [session(1, { status: 1, sectionName: 'Open', arenaName: 'Arena 2', scheduledStart: at(9, 0), startedAt: at(9, 8), heats: [
    heat(1, { startedAt: at(9, 8), races: [race(1, { isComplete: true })] }), heat(2, { entries: [entry(1)] }), heat(3, { entries: [entry(2, 4)] }),
  ] })],
});
const signup = (extra: Partial<MySignup> = {}): MySignup => ({
  id: 9, competitionId: 4, competitionName: 'Bicton Arena Individuals', competitionStart: new Date(Date.now() + 7 * 864e5).toISOString(), competitionSectionId: 1,
  sectionName: 'Under 14', fullName: 'Ellie Hart', amountMinor: 1800, status: 0, createdAt: '2026-10-01T00:00:00Z', ...extra,
});

let picker: CompetitionPickerItem[];
let myTeams: unknown[];
let forms: unknown[];
let signups: MySignup[];

function mount(requests: unknown[] = []) {
  return render(<MemoryRouter><NeedsYouContext.Provider value={{ requests: requests as never, count: requests.length, review: async () => true }}><DashboardPage /></NeedsYouContext.Provider></MemoryRouter>);
}

beforeEach(() => {
  auth.user = { id: 'u1', fullName: 'Sarah Jones', clubName: 'Stockport Pony Club', roles: ['Trainer'] };
  auth.roles = ['Trainer'];
  current.value = null;
  picker = [pickerItem({ live: { heatLabel: 'Heat 2', arenaName: 'Arena 2' } })];
  myTeams = [];
  forms = [];
  signups = [];
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/competitions/picker') return { data: { items: picker, hasMore: false } } as never;
    if (url === '/trainer/my-teams') return { data: myTeams } as never;
    if (url === '/declaration-forms') return { data: forms } as never;
    if (url === '/me/signups') return { data: signups } as never;
    if (url.endsWith('/streams')) return { data: { enabled: true, streams: [{ id: 1, status: 1, viewerCount: 212 }] } } as never;
    return { data: hartpury() } as never;
  });
});

describe('DashboardPage', () => {
  it('shows the event on today with its live band and four tiles of facts', async () => {
    mount();
    expect(await screen.findByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('Hartpury Area Festival', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Open · Session 1, Heat 2 on now')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Open Hartpury Area Festival$/ })).toHaveAttribute('href', '/competitions/1');
    const tiles = within(screen.getByRole('navigation', { name: 'This event' })).getAllByRole('link');
    expect(tiles.map((tile) => [tile.textContent, tile.getAttribute('href')])).toEqual([
      ['TimetableArena 2 · 8 min late', '/competitions/1'],
      ['ToplistsNo age groups yet', '/competitions/1/toplists'],
      ['Live & stream212 watching', '/competitions/1/chat'],
      ['DetailsHartpury College', '/competitions/1/details'],
    ]);
  });

  it('prefers the competition the person is following', async () => {
    current.value = { id: 7, name: 'Mine' };
    picker = [];
    mount();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/7'));
    expect(await screen.findByText('Hartpury Area Festival', { selector: 'strong' })).toBeInTheDocument();
  });

  it('links a signed-in person to their teams', async () => {
    mount();
    await screen.findByText('LIVE');
    expect(screen.getByRole('link', { name: /My teams/ })).toHaveAttribute('href', '/teams');
  });

  it('lists what needs the person: a missing dec form, an unpaid entry, and trainer requests for an admin', async () => {
    auth.roles = ['Admin'];
    myTeams = [team(1, { displayName: 'Stockport A', competitionId: 1, relationship: 'trainer' }), team(2, { displayName: 'Stockport B', competitionId: 1, relationship: 'trainer' })];
    forms = [{ id: 1, teamId: 1 }];
    signups = [signup(), signup({ id: 10, status: 1 })];
    mount([{ userId: 'r1', fullName: 'Pat Newtrainer', clubName: 'Wirral PC', email: null, requestedAt: '2026-10-01' }]);
    const needs = await screen.findByRole('region', { name: 'Needs you' });
    await waitFor(() => expect(within(needs).getAllByRole('link')).toHaveLength(3));
    const links = within(needs).getAllByRole('link');
    expect(links[0]).toHaveTextContent('Dec form needed: Stockport B');
    expect(links[0]).toHaveTextContent('Hartpury Area Festival');
    expect(links[0]).toHaveAttribute('href', '/competitions/1/declarations');
    expect(links[1]).toHaveTextContent('Entry awaiting payment');
    expect(links[1]).toHaveTextContent('Bicton Arena Individuals · £18.00');
    expect(links[2]).toHaveTextContent('Trainer request: Pat Newtrainer');
    expect(needs).toHaveTextContent('3');
  });

  it('lists the heats still to run today for the person’s teams, with any delay', async () => {
    myTeams = [team(1, { displayName: 'Stockport A', competitionId: 1, sectionName: 'Open', relationship: 'trainer' }), team(2, { displayName: 'Stockport B', competitionId: 1, sectionName: 'Junior', relationship: 'supporter' })];
    mount();
    const section = await screen.findByRole('region', { name: 'Your teams today' });
    const rows = within(section).getAllByText(/^Stockport/);
    expect(rows.map((row) => row.textContent)).toEqual(['Stockport A', 'Stockport B']);
    expect(section).toHaveTextContent('Open · Heat 2 · +8 min');
    expect(section).toHaveTextContent('Junior · Heat 3 · +8 min');
  });

  it('counts dec forms and entries in the shortcuts, and hides My signups for an admin', async () => {
    myTeams = [team(1, { competitionId: 1, relationship: 'trainer' }), team(2, { competitionId: 1, relationship: 'manager' }), team(3, { competitionId: 1, relationship: 'supporter' })];
    forms = [{ id: 1, teamId: 1 }];
    signups = [signup(), signup({ id: 10 })];
    const view = mount();
    const shortcuts = await screen.findByRole('region', { name: 'Shortcuts' });
    await waitFor(() => expect(shortcuts).toHaveTextContent('1 of 2 in'));
    expect(shortcuts).toHaveTextContent('3 teams');
    await waitFor(() => expect(within(shortcuts).getByRole('link', { name: /My signups/ })).toHaveTextContent('2'));
    expect(within(shortcuts).getByRole('link', { name: /Create a competition/ })).toHaveAttribute('href', '/admin/competitions/new');
    expect(within(shortcuts).getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/shop');
    expect(within(shortcuts).queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    view.unmount();
    auth.roles = ['Admin'];
    mount();
    const adminShortcuts = await screen.findByRole('region', { name: 'Shortcuts' });
    expect(within(adminShortcuts).queryByRole('link', { name: /My signups/ })).not.toBeInTheDocument();
    expect(within(adminShortcuts).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('shows a visitor the event and a way to sign in, with nothing private', async () => {
    auth.user = null;
    auth.roles = [];
    mount();
    expect(await screen.findByText('LIVE')).toBeInTheDocument();
    const shortcuts = screen.getByRole('region', { name: 'Shortcuts' });
    expect(within(shortcuts).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(within(shortcuts).queryByRole('link', { name: /My teams/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/me/signups');
  });

  it('says so when nothing is on today, naming the next event', async () => {
    picker = [pickerItem({ id: 5, name: 'Winter League', startDate: new Date(Date.now() + 14 * 864e5).toISOString() })];
    mount();
    expect(await screen.findByText(/Nothing is on today\. Next up: Winter League/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'This event' })).not.toBeInTheDocument();
  });

  it('copes with the event or the signups failing to load', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/picker') return { data: { items: picker, hasMore: false } } as never;
      if (url === '/trainer/my-teams' || url === '/declaration-forms') return { data: [] } as never;
      throw new Error('offline');
    });
    mount();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/1'));
    expect(screen.getByRole('region', { name: 'Shortcuts' })).toBeInTheDocument();
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });

  it('shows a quiet line while it looks for what is on', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Looking for what’s on today…');
  });
});
