import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Clock } from 'lucide-react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider, useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { getWeather } from '../weather/weather';
import { AgeGroupsProvider, useAgeGroups, type AgeGroupLink } from './AgeGroupsContext';
import { CompetitionMetaProvider } from './CompetitionMetaContext';
import { useCompetitionMeta, type CompetitionMeta } from './competitionMeta';
import { NavExtrasProvider, useNavExtras, type NavExtra } from './NavExtrasContext';
import { NavigationDrawer } from './NavigationDrawer';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));
vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));

interface Options {
  path?: string;
  roles?: string[];
  fullName?: string;
  clubName?: string;
  competition?: boolean;
  meta?: Partial<CompetitionMeta>;
  groups?: AgeGroupLink[];
  extras?: NavExtra[];
}

function Seed({ meta, groups, extras }: Pick<Options, 'meta' | 'groups' | 'extras'>) {
  const { setMeta } = useCompetitionMeta();
  const { setGroups } = useAgeGroups();
  const { setExtras } = useNavExtras();
  useEffect(() => {
    if (meta) setMeta({ id: 4, name: 'Spring Games', startDate: '2026-10-17T09:00:00', live: false, ...meta });
    if (groups) setGroups(4, groups);
    if (extras) setExtras(extras);
  }, [meta, groups, extras, setMeta, setGroups, setExtras]);
  return null;
}
function Probe() {
  const { pathname, search } = useLocation();
  const { rememberChoice } = useCurrentCompetition();
  return <span data-testid="probe">{pathname}{search}|{rememberChoice}</span>;
}

const onClose = vi.fn();

function mount(options: Options = {}) {
  if (options.roles) {
    const auth: StoredAuth = {
      token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'u1', email: 'ann@example.com', fullName: options.fullName ?? 'Ann Smith', clubId: options.clubName ? 3 : null, clubName: options.clubName ?? null, roles: options.roles },
    };
    localStorage.setItem('mg.auth', JSON.stringify(auth));
  }
  if (options.competition) document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 4, name: 'Spring Games' }))}; Path=/`;
  return render(
    <MemoryRouter initialEntries={[options.path ?? '/']}>
      <AuthProvider><ThemeProvider><CurrentCompetitionProvider><NavExtrasProvider><AgeGroupsProvider><CompetitionMetaProvider>
        <Seed meta={options.meta} groups={options.groups} extras={options.extras} />
        <NavigationDrawer onClose={onClose} />
        <Probe />
      </CompetitionMetaProvider></AgeGroupsProvider></NavExtrasProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider>
    </MemoryRouter>,
  );
}
const links = (name: string) => within(screen.getByRole('navigation', { name })).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);

beforeEach(() => {
  onClose.mockClear();
  vi.mocked(api.get).mockResolvedValue({ data: {} });
  vi.mocked(getWeather).mockResolvedValue({ current: { temperature_2m: 16, weather_code: 0 } });
});

describe('NavigationDrawer: when no competition is followed', () => {
  it('opens as a modal menu that stops the page behind it scrolling', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = mount();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toHaveAttribute('open');
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('sends the competition links to the events list, and leaves out live stream', () => {
    mount();
    expect(links('Main navigation')).toEqual([
      ['Following', '/following'], ['Timetable', '/events'], ['Toplists', '/events'], ['Event shop', '/shop'], ['Rulebooks', '/events'], ['Details & entries', '/events'],
    ]);
  });

  it('invites a visitor to sign in', () => {
    mount();
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('href', '/login');
    expect(signIn).toHaveClass('mg-btn-primary');
    // It leads the menu as a button rather than sitting in the list of links.
    expect(screen.getByRole('navigation', { name: 'Main navigation' }).compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getByText('For trainers, organisers and stewards')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Account and management' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Notifications/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('has no Team history link and keeps Privacy inside Settings', async () => {
    mount();
    expect(screen.queryByRole('link', { name: 'Team history' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('link', { name: 'Privacy' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/privacy');
  });

  it('offers to change competition and see past ones', async () => {
    mount();
    await userEvent.click(screen.getByRole('link', { name: 'Change competition' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/events');
    await userEvent.click(screen.getByRole('link', { name: 'Past competitions' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/past');
  });

  it('links to rider and team stats', async () => {
    mount();
    await userEvent.click(screen.getByRole('link', { name: 'Rider and team stats' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/stats');
  });

  it('closes from its close button, Escape and a tap on the backdrop, but not from a tap inside', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByRole('dialog'), new Event('cancel'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);
    await userEvent.click(screen.getByRole('heading', { name: 'Menu' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('NavigationDrawer: following a competition', () => {
  it('shows which competition is being followed, with its dates and venue', () => {
    mount({ competition: true, meta: { endDate: '2026-10-18T17:00:00', location: ' Ashdown ' } });
    expect(screen.getByRole('heading', { name: 'Spring Games' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Following' })).toBeInTheDocument();
    expect(screen.getByText('Sat 17 – Sun 18 Oct · Ashdown')).toBeInTheDocument();
  });

  it('shows just the name when the details are for a different competition', () => {
    mount({ competition: true, meta: { id: 99 } });
    expect(screen.getByRole('heading', { name: 'Spring Games' })).toBeInTheDocument();
    expect(screen.queryByText(/Oct/)).not.toBeInTheDocument();
  });

  it('links to the competition’s own pages', () => {
    mount({ competition: true });
    expect(links('Main navigation')).toEqual([
      ['Following', '/competitions/4/following'], ['Timetable', '/competitions/4'], ['Toplists', '/competitions/4/toplists'],
      ['Live feed & stream', '/competitions/4/chat'], ['Event shop', '/competitions/4/shop'], ['Rulebooks', '/competitions/4/rulebooks'], ['Details & entries', '/competitions/4/details'],
    ]);
  });

  it('flags the live feed while a session is in the arena', () => {
    mount({ competition: true, meta: { live: true } });
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByText('Live')).toBeInTheDocument();
  });

  it('has no live flag otherwise', () => {
    mount({ competition: true, meta: { live: false } });
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).queryByText('Live')).not.toBeInTheDocument();
  });

  it('highlights the page being viewed', () => {
    mount({ competition: true, path: '/competitions/4/toplists' });
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(nav.getByRole('link', { name: 'Toplists' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Timetable' })).not.toHaveAttribute('aria-current');
  });

  it('does not highlight anything when no competition is followed', () => {
    mount({ path: '/competitions' });
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(nav.getByRole('link', { name: 'Timetable' }).className).not.toMatch(/font-semibold/);
  });
});

describe('NavigationDrawer: age groups', () => {
  const groups = [{ id: 11, name: 'Seniors' }, { id: 12, name: 'Juniors' }];

  it('lists the age groups of the followed competition, closing the menu on choice', async () => {
    mount({ competition: true, groups });
    expect(links('Age groups')).toEqual([['Seniors', '/competitions/4/scoring?section=11'], ['Juniors', '/competitions/4/scoring?section=12']]);
    await userEvent.click(screen.getByRole('link', { name: 'Juniors' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows no age groups when there are none, or they belong to another competition', () => {
    mount({ competition: true, groups: [] });
    expect(screen.queryByRole('navigation', { name: 'Age groups' })).not.toBeInTheDocument();
  });

  it('shows no age groups without a followed competition', () => {
    mount({ groups });
    expect(screen.queryByRole('navigation', { name: 'Age groups' })).not.toBeInTheDocument();
  });

  it('marks only the selected age group on the scoring page', () => {
    mount({ competition: true, groups, path: '/competitions/4/scoring?section=12' });
    const nav = within(screen.getByRole('navigation', { name: 'Age groups' }));
    expect(nav.getByRole('link', { name: 'Juniors' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Seniors' })).not.toHaveAttribute('aria-current');
  });

  it('marks only the first age group on the scoring page when none is chosen', () => {
    mount({ competition: true, groups, path: '/competitions/4/scoring' });
    expect(screen.getByRole('link', { name: 'Seniors' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Juniors' })).not.toHaveAttribute('aria-current');
  });

  it('marks no age group away from the scoring page', () => {
    mount({ competition: true, groups, path: '/competitions/4' });
    expect(within(screen.getByRole('navigation', { name: 'Age groups' })).queryAllByRole('link').some((l) => l.hasAttribute('aria-current'))).toBe(false);
  });
});

describe('NavigationDrawer: signed in', () => {
  it('links the avatar block to the profile, with the role and club under the name', async () => {
    mount({ roles: ['Trainer'], clubName: 'Stockport PC' });
    const profile = screen.getByRole('link', { name: /Ann Smith/ });
    expect(profile).toHaveAttribute('href', '/me');
    expect(profile).toHaveTextContent('AS');
    expect(profile).toHaveTextContent('Trainer · Stockport PC');
    await userEvent.click(profile);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/me');
  });

  it('falls back to the email when there is no name', () => {
    mount({ roles: ['Member'], fullName: '' });
    const profile = screen.getByRole('link', { name: /ann@example.com/ });
    expect(profile).toHaveTextContent('AN');
    expect(profile).toHaveTextContent('Member');
  });

  it('leaves account and club links to the profile page', () => {
    mount({ roles: ['Trainer'] });
    expect(links('Account and management')).toEqual([['Dashboard', '/dashboard']]);
    for (const name of ['My account', 'My teams', 'Dec forms', 'My signups', 'My items for sale', 'Orders & sales', /Notifications/]) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows an admin the site admin section of the dashboard too', () => {
    mount({ roles: ['Admin', 'Trainer'] });
    expect(links('Account and management')).toEqual([['Dashboard', '/dashboard'], ['Site admin', '/me#site-admin']]);
  });

  it('shows extra links published by the current page', () => {
    mount({ extras: [{ to: '/admin/rules', label: 'Rules', icon: Clock, end: true }] });
    expect(links('Account and management')).toEqual([['Rules', '/admin/rules']]);
  });

  it('has no profile link for a visitor', () => {
    mount();
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href') === '/me')).toBe(false);
  });
});

describe('NavigationDrawer: settings', () => {
  const openSettings = () => userEvent.click(screen.getByRole('button', { name: 'Settings' }));

  it('keeps settings folded away until asked for', async () => {
    mount();
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'false');
    await openSettings();
    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'true');
    await openSettings();
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('switches the colour theme', async () => {
    mount();
    await openSettings();
    const themes = within(screen.getByRole('group', { name: 'Colour theme' }));
    expect(themes.getByRole('button', { name: 'EGUK Navy' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(themes.getByRole('button', { name: 'Stable Night' }));
    expect(themes.getByRole('button', { name: 'Stable Night' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('shows or hides the weather, remembering the choice', async () => {
    mount();
    expect(screen.queryByText('Weather')).not.toBeInTheDocument();
    await openSettings();
    const toggle = screen.getByRole('switch', { name: 'Show weather' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('mg.showWeather')).toBe('1');
    expect(screen.getByText('Weather', { selector: 'span.font-medium' })).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(localStorage.getItem('mg.showWeather')).toBeNull();
    expect(screen.queryByText('Weather', { selector: 'span.font-medium' })).not.toBeInTheDocument();
  });

  it('shows the weather when it was switched on before', () => {
    localStorage.setItem('mg.showWeather', '1');
    mount();
    expect(screen.getByText('Weather', { selector: 'span.font-medium' })).toBeInTheDocument();
  });

  it('still works when storage is blocked', async () => {
    const realGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(this: Storage, key: string) {
      if (key === 'mg.showWeather') throw new Error('blocked');
      return realGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(this: Storage, key: string) {
      if (key === 'mg.showWeather') throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function removeItem(this: Storage, key: string) {
      if (key === 'mg.showWeather') throw new Error('blocked');
    });
    mount();
    await openSettings();
    const toggle = screen.getByRole('switch', { name: 'Show weather' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('offers to remember the competition only when one is followed, and toggles that choice', async () => {
    mount();
    await openSettings();
    expect(screen.queryByRole('switch', { name: /Remember this competition/ })).not.toBeInTheDocument();
  });

  it('remembers or forgets the followed competition on this device', async () => {
    mount({ competition: true });
    await openSettings();
    const toggle = screen.getByRole('switch', { name: 'Remember this competition on this device' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('probe')).toHaveTextContent('|visit');
    await userEvent.click(toggle);
    expect(screen.getByTestId('probe')).toHaveTextContent('|remember');
  });
});

describe('NavigationDrawer: forgetting the competition', () => {
  const openSettings = () => userEvent.click(screen.getByRole('button', { name: 'Settings' }));

  it('is offered only when a competition is followed', async () => {
    mount();
    await openSettings();
    expect(screen.queryByRole('button', { name: 'Forget this competition' })).not.toBeInTheDocument();
  });

  it('clears the competition and what the device kept, closes the menu and opens the events list', async () => {
    mount({ competition: true, path: '/competitions/4' });
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Forget this competition' }));
    expect(document.cookie).not.toContain('mg.competition');
    expect(sessionStorage.getItem('mg.competitionVisit')).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent('/events|ask');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('switch', { name: /Remember this competition/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
  });
});

describe('NavigationDrawer: the Seasons link', () => {
  const seasonLink = () => screen.queryByRole('link', { name: 'Seasons' });

  it('shows for a competition in one season and goes straight to it', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/seasons/for-competition/4' ? [{ id: 'abc' }] : {} }));
    mount({ competition: true });
    expect(await screen.findByRole('link', { name: 'Seasons' })).toHaveAttribute('href', '/seasons/abc');
  });

  it('goes to the season list when the competition is in several', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/seasons/for-competition/4' ? [{ id: 'abc' }, { id: 'def' }] : {} }));
    mount({ competition: true });
    expect(await screen.findByRole('link', { name: 'Seasons' })).toHaveAttribute('href', '/seasons');
  });

  it('is hidden when the competition is not in a season, or the lookup fails', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/seasons/for-competition/4' ? [] : {} }));
    const first = mount({ competition: true });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/seasons/for-competition/4'));
    expect(seasonLink()).toBeNull();
    first.unmount();
    vi.mocked(api.get).mockImplementation(async (url: string) => { if (url.startsWith('/seasons/')) throw new Error('offline'); return { data: {} }; });
    mount({ competition: true });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/seasons/for-competition/4')).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seasonLink()).toBeNull();
  });

  it('stays available before a competition is chosen', () => {
    mount();
    expect(seasonLink()).toHaveAttribute('href', '/seasons');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/seasons/'));
  });
});

