import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { FAVOURITES_KEY } from '../lib/favourites';
import { FOLLOWED_PROFILES_KEY } from '../lib/followedProfiles';
import { competition, team } from '../test/factories';
import { FollowingPage } from './FollowingPage';
import { TickerProvider, useDockHost, useTicker } from '../components/TickerContext';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
const get = vi.mocked(api.get);

const winter = competition({
  id: 2, name: 'Northern Winter League R1', startDate: '2030-11-07T09:00:00Z', endDate: null,
  teams: [team(3, { displayName: 'Wirral Pairs 2', sectionName: 'Pairs' })], sessions: [],
});
const profile = (id: string, displayName: string, clubName: string, clubId: number, suffix = '') => ({ id, clubId, clubName, suffix, displayName, createdAt: '', updatedAt: '', canManage: false });
const atherstone = profile('p1', 'Atherstone U14', 'Atherstone', 1, 'U14');
const berwyn = profile('p2', 'Berwyn & Dee U14', 'Berwyn & Dee', 2, 'U14');
const leicester = profile('p3', 'Leicester Forest', 'Leicester Forest', 3);
const everyone = [atherstone, berwyn, leicester, profile('p4', 'Leicester Forest U12', 'Leicester Forest', 3, 'U12'), profile('p5', 'Leicester Forest U14', 'Leicester Forest', 3, 'U14')];
const histories: Record<string, unknown> = {
  p1: { profile: atherstone, publishedResults: [], eventTeams: [{ id: 1, teamProfileId: 'p1', competitionId: 7, competitionName: 'Midlands Series', teamId: 70, teamName: 'Atherstone U14', linkedAt: '' }] },
  p2: { profile: berwyn, eventTeams: [], publishedResults: [{ competitionName: 'Welsh Open', competitionDate: '2031-01-05T00:00:00Z', eventRank: 5, publicationVersion: 1 }] },
  p3: { profile: leicester, eventTeams: [], publishedResults: [] },
};
const followProfiles = (...ids: string[]) => localStorage.setItem(FOLLOWED_PROFILES_KEY, JSON.stringify(ids.map((id) => {
  const found = everyone.find((item) => item.id === id)!;
  return { id, name: found.displayName, clubName: found.clubName };
})));
const mount = () => render(<MemoryRouter><FollowingPage /></MemoryRouter>);

beforeEach(() => {
  get.mockImplementation(async (url) => {
    if (url === '/team-profiles') return { data: everyone, headers: {} } as never;
    if (url === '/competitions') return { data: [{ id: 7, name: 'Midlands Series', startDate: '2031-10-29T09:00:00Z', endDate: null, isArchived: false }], headers: {} } as never;
    const history = /^\/team-profiles\/(\w+)\/history$/.exec(url)?.[1];
    if (history) return { data: histories[history], headers: {} } as never;
    return { data: winter, headers: {} } as never;
  });
});

describe('FollowingPage: teams followed from their profile', () => {
  it('groups followed teams into coming up and not entered yet, each with its line', async () => {
    followProfiles('p1', 'p2', 'p3');
    mount();
    const coming = await screen.findByRole('region', { name: 'Coming up' });
    const row = within(coming).getByRole('link', { name: /Atherstone U14/ });
    expect(row).toHaveAttribute('href', '/competitions/7/teams/70');
    expect(row).toHaveTextContent(/29 Oct · Midlands Series/);
    expect(within(coming).getByText('1 team')).toBeInTheDocument();
    const none = screen.getByRole('region', { name: 'Not entered in anything yet' });
    expect(within(none).getByRole('link', { name: /Berwyn & Dee U14/ })).toHaveTextContent('Last out: 5th · Welsh Open, 5 Jan');
    expect(within(none).getByRole('link', { name: /Leicester Forest/ })).toHaveTextContent('Club · 3 teams');
    expect(within(none).getByRole('link', { name: /Leicester Forest/ })).toHaveAttribute('href', '/team-profiles/p3');
    expect(within(none).getByText('2 teams')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfollow Atherstone U14' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a team once: under coming up, not also under its competition', async () => {
    followProfiles('p1');
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ competitionId: 7, teamId: 70 }, { competitionId: 2, teamId: 3 }]));
    mount();
    await screen.findByRole('region', { name: 'Coming up' });
    expect(await screen.findByRole('region', { name: 'Northern Winter League R1' })).toBeInTheDocument();
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['Coming up', 'Northern Winter League R1']);
    expect(screen.queryByText('Star a team and it shows up here with its next event or heat.')).not.toBeInTheDocument();
  });

  it('counts a profile and its event team once in the header subtitle', async () => {
    followProfiles('p1');
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ competitionId: 7, teamId: 70 }]));
    mount();
    await screen.findByRole('region', { name: 'Coming up' });
    expect(screen.getAllByText('1 team').length).toBeGreaterThan(0);
    expect(screen.queryByText('2 teams')).not.toBeInTheDocument();
  });

  it('unfollows from the star, taking the competition follow with it', async () => {
    followProfiles('p1', 'p3');
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ competitionId: 7, teamId: 70 }]));
    mount();
    // The rows are drawn straight away and then settle into their groups, so wait for that before tapping.
    await screen.findByRole('region', { name: 'Coming up' });
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow Atherstone U14' }));
    expect(JSON.parse(localStorage.getItem(FOLLOWED_PROFILES_KEY) ?? '[]').map((item: { id: string }) => item.id)).toEqual(['p3']);
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
    // The row folds away (it is out of reach while it does) and the toast offers to undo it.
    expect(screen.getByRole('status')).toHaveTextContent('Unfollowed');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Coming up' })).toBeNull());
  });

  it('puts the team back, with its competition follow, when Undo is pressed', async () => {
    followProfiles('p1', 'p3');
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ competitionId: 7, teamId: 70 }]));
    mount();
    await screen.findByRole('region', { name: 'Coming up' });
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow Atherstone U14' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(JSON.parse(localStorage.getItem(FOLLOWED_PROFILES_KEY) ?? '[]').map((item: { id: string }) => item.id).sort()).toEqual(['p1', 'p3']);
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')).toEqual([{ competitionId: 7, teamId: 70 }]);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Unfollow Atherstone U14' })).toBeEnabled();
  });

  it('draws the followed teams at once, before their results arrive, then sorts them into groups', async () => {
    followProfiles('p1', 'p3');
    let release: (value: unknown) => void = () => {};
    const slow = new Promise((resolve) => { release = resolve; });
    get.mockImplementation(async (url) => {
      if (url === '/team-profiles') return { data: everyone, headers: {} } as never;
      await slow;
      if (url === '/competitions') return { data: [{ id: 7, name: 'Midlands Series', startDate: '2031-10-29T09:00:00Z', endDate: null, isArchived: false }], headers: {} } as never;
      const history = /^\/team-profiles\/(\w+)\/history$/.exec(url)?.[1];
      return { data: history ? histories[history] : winter, headers: {} } as never;
    });
    mount();
    expect(screen.getByRole('link', { name: /Atherstone U14/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Leicester Forest/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Coming up' })).toBeNull();
    expect(screen.queryByText('Loading event…')).toBeNull();
    release(undefined);
    expect(await screen.findByRole('region', { name: 'Coming up' })).toBeInTheDocument();
  });

  it('falls back to the club name when the team has no events or results to show', async () => {
    followProfiles('p2');
    get.mockImplementation(async (url) => {
      if (url === '/team-profiles') return { data: everyone, headers: {} } as never;
      throw new Error('offline');
    });
    mount();
    const none = await screen.findByRole('region', { name: 'Not entered in anything yet' });
    expect(within(none).getByRole('link', { name: /Berwyn & Dee U14/ })).toHaveTextContent('Berwyn & Dee');
  });

  it('opens a search from the grey bar, finds a team profile and follows it on this device', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Follow a team or club' }));
    const sheet = screen.getByRole('dialog', { name: 'Follow a team or club' });
    expect(within(sheet).getByText('Type a team or club name.')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByRole('searchbox'), 'berwyn');
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Follow Berwyn & Dee U14' }));
    expect(JSON.parse(localStorage.getItem(FOLLOWED_PROFILES_KEY) ?? '[]')).toEqual([{ id: 'p2', name: 'Berwyn & Dee U14', clubName: 'Berwyn & Dee' }]);
    expect(within(sheet).getByRole('button', { name: 'Unfollow Berwyn & Dee U14' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.clear(within(sheet).getByRole('searchbox'));
    await userEvent.type(within(sheet).getByRole('searchbox'), 'zzz');
    expect(within(sheet).getByText('No team or club matches that search.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('region', { name: 'Not entered in anything yet' })).toBeInTheDocument();
  });

  it('searches from the bar at the top too, and unfollows from the results', async () => {
    mount();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a team or club to follow' }), 'atherstone');
    await userEvent.click(await screen.findByRole('button', { name: 'Follow Atherstone U14' }));
    expect(JSON.parse(localStorage.getItem(FOLLOWED_PROFILES_KEY) ?? '[]')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow Atherstone U14' }));
    expect(localStorage.getItem(FOLLOWED_PROFILES_KEY)).toBeNull();
  });

  it('offers to retry when the team profiles cannot be loaded', async () => {
    get.mockRejectedValue(new Error('offline'));
    mount();
    await userEvent.type(screen.getByRole('searchbox'), 'atherstone');
    expect(await screen.findByRole('alert')).toHaveTextContent('Team profiles couldn’t be loaded');
    get.mockImplementation(async () => ({ data: everyone, headers: {} }) as never);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Follow Atherstone U14' })).toBeInTheDocument();
  });

  it('says so when a followed team cannot be saved on the device', async () => {
    mount();
    await userEvent.type(screen.getByRole('searchbox'), 'atherstone');
    const button = await screen.findByRole('button', { name: 'Follow Atherstone U14' });
    const block = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await userEvent.click(button);
    expect(await screen.findByText(/couldn’t be saved on this device/)).toBeInTheDocument();
    block.mockRestore();
  });
});

describe('FollowingPage: the Follow a team button beside the ticker dock', () => {
  function Probe() {
    useDockHost();
    const { dockAction } = useTicker();
    return dockAction ? <button type="button" data-testid="dock" onClick={dockAction.onClick}>{dockAction.label}</button> : null;
  }

  it('moves the grey bar to the dock, where it opens the follow search', async () => {
    render(<MemoryRouter><TickerProvider><FollowingPage /><Probe /></TickerProvider></MemoryRouter>);
    expect(document.querySelector('.sp-add')).toBeNull();
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('dock'));
    const sheet = screen.getByRole('dialog', { name: 'Follow a team or club' });
    expect(within(sheet).getByRole('searchbox')).toBeInTheDocument();
  });
});
