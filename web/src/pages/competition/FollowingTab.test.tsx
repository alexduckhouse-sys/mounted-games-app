import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => { vi.useRealTimers(); });

describe('FollowingTab', () => {
  it('lets a signed-out visitor search, star and unstar a team', async () => {
    mount();
    // Nothing followed yet means no cards, only the finder.
    expect(screen.queryByRole('heading', { name: 'On now' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'Blue');
    expect(screen.queryByRole('button', { name: 'Follow Example Red' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Follow Example Blue' }));
    expect(screen.getByRole('heading', { name: 'On now' })).toBeInTheDocument();
    // The group heading says "On now" in words; the heat line keeps a red dot and the words only for screen readers.
    expect(screen.getByText('On now', { selector: '.fc-lead .sr-only' })).toBeInTheDocument();
    expect(document.querySelector('.fc-lead.is-now .fc-dot')).not.toBeNull();
    expect(screen.getByText('Seniors Heat 1 · race 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('lane 2 · 1st so far, 4 pts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Seniors Heat 1/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=1');
    // The team is linked from its card and from the search result still showing under the box.
    const teamLinks = screen.getAllByRole('link', { name: /Example Blue/ });
    expect(teamLinks).toHaveLength(2);
    for (const link of teamLinks) expect(link).toHaveAttribute('href', '/competitions/1/teams/1');
    // Both stars (the card's and the result's) are filled; either one unfollows.
    expect(screen.getAllByRole('button', { name: 'Unfollow Example Blue' })).toHaveLength(2);
    await userEvent.click(within(screen.getByRole('search')).getByRole('button', { name: 'Unfollow Example Blue' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'On now' })).not.toBeInTheDocument();
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
    expect(screen.queryByText('On now', { selector: '.fc-lead' })).not.toBeInTheDocument();
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
    // The place sits beside the name, in the same row as the star.
    expect(line.closest('.fc-top')).not.toBeNull();
    expect(line.querySelector('b')).toHaveTextContent('2nd');
    expect(line).toHaveTextContent('8 pts');
    expect(line).toHaveAttribute('href', '/competitions/1/toplists?section=5');
    expect(api.get).toHaveBeenCalledWith('/competitions/1/standings', { params: { sectionId: 5 } });
    // Level with the cut-off with a race to ride: the place turns amber and the toplist's note is read out with it.
    expect(line.querySelector('b')!.className).toBe('is-need');
    expect(line).toHaveTextContent(/needed/);
  });
  it('shows the last heat in place of the toplist row for a team that has no place yet', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }];
    const comp = competition({ teams: data.teams, sessions: [session(1, { status: 1, heats: [
      heat(1, { finishedAt: '2026-07-01T09:30:00Z', entries, races: [race(1, { isComplete: true, results: [result(1, 1, { points: 5 })] })] }),
      heat(2, { entries }),
    ] })] });
    mount({}, comp);
    const last = screen.getByRole('link', { name: /Last/ });
    expect(last).toHaveTextContent(/Seniors Heat 1.*1st.*Last · 5 pts/);
    expect(last).toHaveAttribute('href', '/competitions/1/session/1?heat=1');
    expect(screen.getByRole('link', { name: /lane 2/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=2');
  });
  it('keeps each team to two rows, with a red dot rather than a red band for a heat on now', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    mount();
    const card = screen.getByRole('heading', { name: 'On now' }).closest('section')!.querySelector('li')!;
    expect(card.className).toBe('fc-card');
    expect([...card.children].filter((child) => child.matches('.fc-top, .fc-line'))).toHaveLength(2);
    expect(card.querySelector('.fc-lead.is-now .fc-dot')).not.toBeNull();
    // No link sits inside another.
    expect(card.querySelector('a a')).toBeNull();
  });
  it('shows a joint place without an equals sign and says it is joint', async () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    vi.mocked(api.get).mockResolvedValue({ data: [standing(1, 8), standing(2, 8)], headers: {} });
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }, { id: 2, teamId: 2, teamName: 'Example Red', laneIndex: 3 }];
    const comp = competition({ sections: [section()], teams: data.teams, sessions: [session(1, { status: 1, heats: [heat(1, { entries, races: [
      race(1, { isComplete: true, results: [result(1, 1, { points: 8 }), result(2, 1, { points: 8 })] }), race(2),
    ] })] })] });
    mount({}, comp);
    const line = await screen.findByRole('link', { name: /Seniors toplist/ });
    expect(line.querySelector('b')).toHaveTextContent(/^1st$/);
    expect(line).not.toHaveTextContent('=');
    expect(line).toHaveTextContent('(joint)');
  });
  it('has a round search bar and an outlined Follow club pill', async () => {
    const club = (id: number, displayName: string) => team(id, { clubId: 7, clubName: 'Hill Pony Club', displayName });
    mount({}, competition({ teams: [club(1, 'Hill A'), club(2, 'Hill B')] }));
    const bar = screen.getByRole('searchbox').closest('label')!;
    // The round shape is drawn by following.css on this class.
    expect(bar).toHaveClass('fw-bar-field');
    // The club pill only appears once there is a search.
    expect(screen.queryByRole('button', { name: 'Follow club Hill Pony Club' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'Hill');
    const pill = screen.getByRole('button', { name: 'Follow club Hill Pony Club' });
    expect(pill).toHaveTextContent('Follow club');
    // The outlined pill is drawn by following.css.
    expect(pill).toHaveClass('fw-club-btn');
    expect(pill.className).not.toContain('mg-btn-primary');
  });
  it('says nothing about a copy that is stale in flags only, until it is noticeably old', () => {
    mount({ isStale: true, updatedAt: new Date(Date.now() - 2 * 60_000) });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('says when the copy is old and not refreshing', async () => {
    // At midday, so the saved time is never yesterday's (the notice then adds the date).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 5, 15, 12, 0) });
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
    await userEvent.type(screen.getByRole('searchbox'), 'Blue');
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
    // Clubs are listed only while searching: a search for "pony club" finds both.
    expect(screen.queryByRole('button', { name: /^Follow club/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'pony club');
    const finder = within(screen.getByRole('search'));
    expect(finder.getAllByRole('button', { name: /^(Un)?[Ff]ollow club / })).toHaveLength(2);
    await userEvent.click(finder.getByRole('button', { name: 'Follow club Hill Pony Club' }));
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual([1, 2, 3].map((teamId) => ({ competitionId: 1, teamId })));
    expect(finder.getByRole('button', { name: 'Unfollow Hill Pair' })).toBeInTheDocument();
    expect(finder.getByRole('button', { name: 'Follow club Vale Pony Club' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(finder.getByRole('button', { name: 'Unfollow club Hill Pony Club' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'vale');
    expect(screen.queryByRole('button', { name: 'Follow club Hill Pony Club' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow Vale A' })).toBeInTheDocument();
  });
  it('tells the visitor when a club would take them over the follow limit', async () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(Array.from({ length: 99 }, (_, i) => ({ competitionId: 9, teamId: i + 1 }))));
    const multi = competition({ teams: [team(1, { clubName: 'Hill Pony Club' }), team(2, { clubName: 'Hill Pony Club' })] });
    mount({}, multi);
    await userEvent.type(screen.getByRole('searchbox'), 'Hill');
    await userEvent.click(screen.getByRole('button', { name: 'Follow club Hill Pony Club' }));
    expect(screen.getByRole('alert')).toHaveTextContent('over 100 teams');
  });
});

// Live call-up delivery is exercised by reliability tests; keep these page checks deterministic.
vi.mock('./reliability/heatCalls', async (original) => ({ ...(await original<typeof import('./reliability/heatCalls')>()), useHeatCalls: () => ({ calls: [], error: '', reload: vi.fn() }) }));
