import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import type { CompetitionSection } from '../../types';
import { CompetitionContext, type CompetitionCtx } from './context';
import { FollowingTab } from './FollowingTab';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const data = competition({ teams: [team(1, { displayName: 'Example Blue' }), team(2, { displayName: 'Example Red' })], sessions: [
  session(1, { status: 1, heats: [heat(1, { entries: [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }], races: [
    race(1, { isComplete: true, results: [result(1, 1, { points: 4 })] }), race(2),
  ] })] }),
] });
function mount(extra: Partial<CompetitionCtx> = {}, comp = data) {
  return render(<MemoryRouter initialEntries={['/competitions/1/following']}><CompetitionContext.Provider value={{ competition: comp, reload: vi.fn(), updatedAt: new Date('2026-07-01T10:00:00Z'), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [], ...extra }}><Routes><Route path="/competitions/:id"><Route path="following" element={<FollowingTab />} /></Route></Routes></CompetitionContext.Provider></MemoryRouter>);
}
const section = (extra: Partial<CompetitionSection> = {}): CompetitionSection => ({ id: 5, competitionId: 1, format: 2, ageGroup: 'Seniors', displayName: 'Seniors', ...extra });

beforeEach(() => { vi.mocked(api.get).mockRejectedValue(new Error('offline')); });

describe('FollowingTab', () => {
  it('lets a signed-out visitor search, star and unstar a team', async () => {
    mount();
    // Nothing followed yet means no cards, only the finder.
    expect(screen.queryByRole('heading', { name: 'On now' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'Blue');
    expect(screen.queryByRole('button', { name: 'Follow Example Red' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Follow Example Blue' }));
    expect(screen.getByRole('heading', { name: 'On now' })).toBeInTheDocument();
    expect(screen.getByText('ON NOW')).toBeInTheDocument();
    expect(screen.getByText('Seniors Heat 1 · race 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('lane 2 · 1st so far, 4 pts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Seniors Heat 1/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=1');
    expect(screen.getByRole('link', { name: /Example Blue/ })).toHaveAttribute('href', '/competitions/1/teams/1');
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow Example Blue' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
  });
  it('shows each team as a card with its age group, bibs and a filled star, grouped by what it is doing', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1},{"competitionId":1,"teamId":2}]');
    mount({}, competition({ teams: [team(1, { displayName: 'Example Blue', bibColour: 'Green' }), team(2, { displayName: 'Example Red' })], sessions: data.sessions }));
    const now = screen.getByRole('heading', { name: 'On now' }).closest('section')!;
    expect(within(now).getByText('Seniors · Green bibs')).toBeInTheDocument();
    expect(within(now).getByRole('button', { name: 'Unfollow Example Blue' })).toHaveAttribute('aria-pressed', 'true');
    // A team with no heat drawn is waiting under Up next.
    const upNext = screen.getByRole('heading', { name: 'Up next' }).closest('section')!;
    expect(within(upNext).getByText('Example Red')).toBeInTheDocument();
    expect(within(upNext).getByText('Not drawn yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Done for today' })).not.toBeInTheDocument();
  });
  it('says a bib description that already mentions bibs as it is', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1},{"competitionId":1,"teamId":2}]');
    mount({}, competition({ teams: [team(1, { displayName: 'Example Blue', bibDescription: '[flag:gb-eng] Red bibs, numbered 1 to 5' }), team(2, { displayName: 'Example Red', bibDescription: 'Red' })], sessions: data.sessions }));
    expect(screen.getByText('Seniors · Red bibs, numbered 1 to 5')).toBeInTheDocument();
    expect(screen.getByText('Seniors · Red bibs')).toBeInTheDocument();
  });
  it('shows the next heat with its time, how soon it is, the arena and the lane', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1},{"competitionId":1,"teamId":2}]');
    const soon = new Date(Date.now() + 25 * 60_000).toISOString();
    const later = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const comp = competition({ teams: data.teams, sessions: [
      session(1, { arenaName: 'Main Arena', scheduledStart: soon, heats: [heat(1, { entries: [{ id: 2, teamId: 2, teamName: 'Example Red', laneIndex: 4 }] })] }),
      session(2, { arenaName: 'Ring 2', scheduledStart: later, heats: [heat(2, { entries: [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }] })] }),
    ] });
    mount({}, comp);
    const cards = within(screen.getByRole('heading', { name: 'Up next' }).closest('section')!).getAllByRole('listitem');
    // The soonest heat comes first, whatever order the teams are listed in.
    expect(cards.map((card) => card.querySelector('a')!.textContent)).toEqual(['Example RedSeniors', 'Example BlueSeniors']);
    expect(within(cards[0]).getByText('Seniors Heat 1 · in 25 min')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Main Arena · lane 4')).toBeInTheDocument();
    // A heat hours away leaves out "in N min".
    expect(within(cards[1]).getByText('Seniors Heat 1')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Ring 2 · lane 2')).toBeInTheDocument();
  });
  it('shows a late heat in amber with its time', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }];
    const slow = competition({ teams: data.teams, sessions: [session(1, { status: 1, scheduledStart: '2026-07-01T09:00:00Z', startedAt: '2026-07-01T09:08:00Z', heats: [
      heat(1, { startedAt: '2026-07-01T09:08:00Z', races: [race(1)] }),
      heat(2, { entries }),
    ] })] });
    mount({}, slow);
    const link = screen.getByRole('link', { name: /lane 2/ });
    expect(link).toHaveAttribute('href', '/competitions/1/session/1?heat=2');
    expect(link.querySelector('time')!.className).toContain('is-late');
  });
  it('never labels a saved running heat as on now and allows refresh', async () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const reload = vi.fn();
    mount({ isStale: true, updatedAt: null, reload });
    expect(screen.queryByText('ON NOW')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'On now' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Last updated earlier. Times may have changed.');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it('puts a team with every heat finished under Done for today, led by its last result', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }, { id: 2, teamId: 2, teamName: 'Example Red', laneIndex: 3 }];
    const comp = competition({ teams: data.teams, sessions: [session(1, { status: 2, heats: [heat(1, { finishedAt: '2026-07-01T09:30:00Z', entries, races: [
      race(1, { isComplete: true, results: [result(1, 2, { points: 3 }), result(2, 1, { points: 4 })] }),
    ] })] })] });
    mount({}, comp);
    const done = screen.getByRole('heading', { name: 'Done for today' }).closest('section')!;
    const last = within(done).getByRole('link', { name: /Last/ });
    expect(last).toHaveTextContent('Seniors Heat 1 · 2nd · 3 pts');
    expect(last).toHaveAttribute('href', '/competitions/1/session/1?heat=1');
  });
  it('shows where the team stands in its age group, with the toplist note, and opens the toplist', async () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    vi.mocked(api.get).mockResolvedValue({ data: [standing(2, 9), standing(1, 8)], headers: {} });
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }, { id: 2, teamId: 2, teamName: 'Example Red', laneIndex: 3 }];
    const comp = competition({ sections: [section({ finalistCount: 1 })], teams: data.teams, sessions: [session(1, { status: 1, heats: [heat(1, { entries, races: [
      race(1, { isComplete: true, results: [result(1, 2, { points: 8 }), result(2, 1, { points: 9 })] }), race(2),
    ] })] })] });
    mount({}, comp);
    const line = await screen.findByRole('link', { name: /Seniors toplist/ });
    expect(line).toHaveTextContent('2nd');
    expect(line).toHaveTextContent('Seniors toplist · 8 pts');
    expect(line).toHaveAttribute('href', '/competitions/1/toplists?section=5');
    expect(api.get).toHaveBeenCalledWith('/competitions/1/standings', { params: { sectionId: 5 } });
    // Level with the cut-off with a race to ride: the toplist's own note about what it needs, in amber.
    expect(within(line).getByText(/needed/).className).toBe('is-need');
  });
  it('shows the last heat in place of the toplist row for a team that has no place yet', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }];
    const comp = competition({ teams: data.teams, sessions: [session(1, { status: 1, heats: [
      heat(1, { finishedAt: '2026-07-01T09:30:00Z', entries, races: [race(1, { isComplete: true, results: [result(1, 1, { points: 5 })] })] }),
      heat(2, { entries }),
    ] })] });
    mount({}, comp);
    expect(screen.getByRole('link', { name: /Last/ })).toHaveTextContent('Seniors Heat 1 · 1st · 5 pts');
    expect(screen.getByRole('link', { name: /lane 2/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=2');
  });
  it('has a round search bar and an outlined Follow club pill', () => {
    const club = (id: number, displayName: string) => team(id, { clubId: 7, clubName: 'Hill Pony Club', displayName });
    mount({}, competition({ teams: [club(1, 'Hill A'), club(2, 'Hill B')] }));
    const bar = screen.getByRole('searchbox').closest('label')!;
    expect(bar.className).toContain('rounded-full');
    const pill = screen.getByRole('button', { name: 'Follow club Hill Pony Club' });
    expect(pill).toHaveTextContent('Follow club');
    expect(pill.className).toMatch(/rounded-full.*border/);
    expect(pill.className).not.toContain('mg-btn-primary');
  });
  it('says nothing about a copy that is stale in flags only, until it is noticeably old', () => {
    mount({ isStale: true, updatedAt: new Date(Date.now() - 2 * 60_000) });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('says when the copy is old and not refreshing', async () => {
    mount({ isStale: true, updatedAt: new Date(Date.now() - 20 * 60_000) });
    expect(await screen.findByRole('status')).toHaveTextContent(/Last updated \d\d:\d\d\. Times may have changed\./);
  });
  it('lets a visitor remove a deleted team without knowing private records', async () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":99}]');
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
  });
  it('keeps an unsuccessful star action visible as an error', async () => {
    mount();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await userEvent.click(screen.getByRole('button', { name: 'Follow Example Blue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('couldn’t be saved');
    expect(screen.getByRole('button', { name: 'Follow Example Blue' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('names the arena on each heat only when the event has more than one', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 3 }];
    const single = competition({ teams: data.teams, sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { entries })] })] });
    const first = mount({}, single);
    expect(screen.getByRole('link', { name: /lane 3/ })).not.toHaveTextContent('Main Arena');
    first.unmount();
    const multi = competition({ teams: data.teams, sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { entries })] }), session(2, { arenaName: 'Ring 2' })] });
    mount({}, multi);
    expect(screen.getByRole('link', { name: /lane 3/ })).toHaveTextContent('Main Arena');
  });
  it('follows and unfollows every entry from a club in one tap', async () => {
    const club = (id: number, clubId: number, clubName: string, displayName: string, sectionName: string) => team(id, { clubId, clubName, displayName, sectionName });
    const multi = competition({ teams: [club(1, 7, 'Hill Pony Club', 'Hill A', 'Seniors'), club(2, 7, 'Hill Pony Club', 'Hill Pair', 'Pairs'), club(3, 7, 'Hill Pony Club', 'Hill Solo', 'Individual'), club(4, 8, 'Vale Pony Club', 'Vale A', 'Seniors')] });
    mount({}, multi);
    expect(screen.getByRole('list', { name: 'Clubs' }).querySelectorAll('li')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Follow club Hill Pony Club' }));
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual([1, 2, 3].map((teamId) => ({ competitionId: 1, teamId })));
    expect(screen.getByRole('button', { name: 'Unfollow Hill Pair' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow club Vale Pony Club' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow club Hill Pony Club' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
    await userEvent.type(screen.getByRole('searchbox'), 'vale');
    expect(screen.queryByRole('button', { name: 'Follow club Hill Pony Club' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow Vale A' })).toBeInTheDocument();
  });
  it('tells the visitor when a club would take them over the follow limit', async () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(Array.from({ length: 99 }, (_, i) => ({ competitionId: 9, teamId: i + 1 }))));
    const multi = competition({ teams: [team(1, { clubName: 'Hill Pony Club' }), team(2, { clubName: 'Hill Pony Club' })] });
    mount({}, multi);
    await userEvent.click(screen.getByRole('button', { name: 'Follow club Hill Pony Club' }));
    expect(screen.getByRole('alert')).toHaveTextContent('over 100 teams');
  });
});
