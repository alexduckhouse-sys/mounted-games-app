import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Clock } from 'lucide-react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { readScorerToken, scorerApi } from '../offline/scorerLink';
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
  const { pathname, search, hash } = useLocation();
  const { rememberChoice } = useCurrentCompetition();
  return <span data-testid="probe">{pathname}{search}{hash}|{rememberChoice}</span>;
}

const onClose = vi.fn();

function mount(options: Options = {}, motion = false) {
  if (options.roles) {
    const auth: StoredAuth = {
      token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'u1', email: 'ann@example.com', fullName: options.fullName ?? 'Ann Smith', clubId: options.clubName ? 3 : null, clubName: options.clubName ?? null, roles: options.roles },
    };
    localStorage.setItem('mg.auth', JSON.stringify(auth));
  }
  if (options.competition) document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 4, name: 'Spring Games' }))}; Path=/`;
  // Most tests check what closes the menu, so motion is stilled as in lite mode; one test covers the slide out.
  return render(
    <MotionConfig reducedMotion={motion ? 'never' : 'always'}><MemoryRouter initialEntries={[options.path ?? '/']}>
      <AuthProvider><ThemeProvider><CurrentCompetitionProvider><NavExtrasProvider><AgeGroupsProvider><CompetitionMetaProvider>
        <Seed meta={options.meta} groups={options.groups} extras={options.extras} />
        <NavigationDrawer onClose={onClose} />
        <Probe />
      </CompetitionMetaProvider></AgeGroupsProvider></NavExtrasProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider>
    </MemoryRouter></MotionConfig>,
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

  it('sends the extra competition links to general pages when no competition is followed', () => {
    mount();
    expect(links('Main navigation')).toEqual([
      ['Following', '/following'], ['Event shop', '/shop'],
    ]);
  });

  it('invites a visitor to sign in at the bottom of the menu without a role caption', () => {
    mount();
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('href', '/login');
    expect(signIn).toHaveClass('mg-btn-primary');
    // Sign-in stays at the bottom, after the navigation links.
    expect(screen.getByRole('navigation', { name: 'Main navigation' }).compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Account and management' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Notifications/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('has no Team history or Privacy link in the drawer and links to Settings', async () => {
    mount();
    expect(screen.queryByRole('link', { name: 'Team history' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument();
    const settingsLink = screen.getByRole('link', { name: 'Settings' });
    expect(settingsLink).toHaveAttribute('href', '/settings');
    await userEvent.click(settingsLink);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/settings');
  });

  it('offers to browse events and see past ones', async () => {
    mount();
    await userEvent.click(screen.getByRole('link', { name: 'Events' }));
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

  it('slides out before it closes when motion is on, and ignores a second close meanwhile', async () => {
    mount({}, true);
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.getByRole('dialog')).toHaveClass('is-closing');
    fireEvent(screen.getByRole('dialog'), new Event('cancel'));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
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

  it('links to the competition’s extra pages (omitting duplicate bottom-tab links)', async () => {
    mount({ competition: true });
    expect(links('Main navigation')).toEqual([
      ['Following', '/competitions/4/following'], ['Event shop', '/competitions/4/shop'],
    ]);
    const communityShop = screen.getByRole('link', { name: 'Tack & kit shop' });
    expect(communityShop).toHaveAttribute('href', '/shop');
    await userEvent.click(communityShop);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/shop');
  });

  it('highlights the page being viewed', () => {
    mount({ competition: true, path: '/competitions/4/shop' });
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(nav.getByRole('link', { name: 'Event shop' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Following' })).not.toHaveAttribute('aria-current');
  });

  it('does not highlight anything when no competition is followed', () => {
    mount({ path: '/events' });
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(nav.getAllByRole('link').some((link) => link.hasAttribute('aria-current'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Rulebooks' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('navigation', { name: 'Account and management' })).not.toBeInTheDocument();
    for (const name of ['Dashboard', 'My account', 'My teams', 'Dec forms', 'My signups', 'My items for sale', 'Orders & sales', /Notifications/]) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('shows an admin the site admin section of the dashboard', () => {
    mount({ roles: ['Admin', 'Trainer'] });
    expect(links('Account and management')).toEqual([['Site admin', '/admin']]);
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

describe('NavigationDrawer: settings, QR scanner and weather', () => {
  it('links to the Settings page and highlights it when active', () => {
    mount({ path: '/settings' });
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the QR permission scanner above Settings and rejects unsupported pairing links', async () => {
    mount();
    const scanBtn = screen.getByRole('button', { name: 'Scan QR code' });
    const settingsLink = screen.getByRole('link', { name: 'Settings' });
    expect(scanBtn.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(scanBtn);
    expect(screen.getByRole('dialog', { name: 'Scan permission QR code' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close QR scanner' }));
    expect(screen.queryByRole('dialog', { name: 'Scan permission QR code' })).not.toBeInTheDocument();

    await userEvent.click(scanBtn);
    fireEvent.change(screen.getByLabelText('Permission link or key'), {
      target: { value: '/competitions/4/broadcast?pair=pair_secret_1234567890' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid permission QR code');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides the weather row by default when no competition is followed', () => {
    mount();
    expect(screen.queryByText('Weather', { selector: 'span.font-medium' })).not.toBeInTheDocument();
  });

  it('shows the weather when it was switched on before or when following a competition', async () => {
    localStorage.setItem('mg.showWeather', '1');
    const first = mount();
    expect(screen.getByText('Weather', { selector: 'span.font-medium' })).toBeInTheDocument();
    first.unmount();

    localStorage.removeItem('mg.showWeather');
    vi.mocked(getWeather).mockClear();
    mount({ competition: true });
    const weatherLink = screen.getByRole('link', { name: /Weather/ });
    expect(weatherLink).toHaveAttribute('href', '/competitions/4/weather');
    expect(getWeather).not.toHaveBeenCalled();
  });

  it('still works when storage is blocked', () => {
    const realGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(this: Storage, key: string) {
      if (key === 'mg.showWeather') throw new Error('blocked');
      return realGet.call(this, key);
    });
    mount();
    expect(screen.queryByText('Weather', { selector: 'span.font-medium' })).not.toBeInTheDocument();
  });
});

describe('NavigationDrawer: the Seasons link', () => {
  const seasonLink = () => screen.queryByRole('link', { name: 'Seasons' });

  it('shows for a competition in one season and goes straight to it', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/seasons/for-competition/4' ? [{ id: 'abc' }] : {} }));
    mount({ competition: true });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Seasons' })).toHaveAttribute('href', '/seasons/abc'));
  });

  it('goes to the season list when the competition is in several', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/seasons/for-competition/4' ? [{ id: 'abc' }, { id: 'def' }] : {} }));
    mount({ competition: true });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Seasons' })).toHaveAttribute('href', '/seasons'));
  });

  it('stays visible and links to the season list when the competition is not in a season, or the lookup fails', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/seasons/for-competition/4' ? [] : {} }));
    const first = mount({ competition: true });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/seasons/for-competition/4'));
    expect(seasonLink()).toHaveAttribute('href', '/seasons');
    first.unmount();
    vi.mocked(api.get).mockImplementation(async (url: string) => { if (url.startsWith('/seasons/')) throw new Error('offline'); return { data: {} }; });
    mount({ competition: true });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/seasons/for-competition/4')).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seasonLink()).toHaveAttribute('href', '/seasons');
  });

  it('stays available before a competition is chosen', () => {
    mount();
    expect(seasonLink()).toHaveAttribute('href', '/seasons');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/seasons/'));
  });
});


describe('NavigationDrawer: permission scanner', () => {
  it('opens and closes the scanner without dismissing or navigating the menu', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Scan QR code' }));
    expect(screen.getByRole('dialog', { name: 'Scan permission QR code' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close QR scanner' }));
    expect(screen.queryByRole('dialog', { name: 'Scan permission QR code' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe')).toHaveTextContent('/|');
  });

  it('verifies through the scoped client before closing the menu and navigating with the permission fragment', async () => {
    const token = 'mgs_fake_drawer_permission';
    const session = { competitionId: 4, competitionName: 'Fake event', label: 'Fake camera', arenaName: 'Main', scope: 1, sessions: [] };
    const verify = vi.spyOn(scorerApi, 'get').mockResolvedValue({ data: session });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Scan QR code' }));
    fireEvent.change(screen.getByLabelText('Permission link or key'), { target: { value: `/score#t=${token}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(`/score#t=${token}`));
    expect(verify).toHaveBeenCalledExactlyOnceWith('/scorer/session', { headers: { 'X-Scorer-Token': token } });
    expect(readScorerToken()).toBe(token);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Scan permission QR code' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/scorer/session', expect.anything());
  });

  it('keeps the drawer and scanner open when verification fails', async () => {
    vi.spyOn(scorerApi, 'get').mockRejectedValue({ response: { status: 410 } });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Scan QR code' }));
    fireEvent.change(screen.getByLabelText('Permission link or key'), { target: { value: 'mgs_fake_expired_permission' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify permission key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired permission key');
    expect(onClose).not.toHaveBeenCalled();
    expect(readScorerToken()).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent('/|');
  });
});

describe('NavigationDrawer: abandoned season requests', () => {
  it.each(['resolve', 'reject'] as const)('ignores a late season %s after the drawer closes', async (outcome) => {
    let resolve!: (value: { data: { id: string }[] }) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<{ data: { id: string }[] }>((yes, no) => { resolve = yes; reject = no; });
    vi.mocked(api.get).mockReturnValue(pending);
    const view = mount({ competition: true });
    expect(api.get).toHaveBeenCalledWith('/seasons/for-competition/4');
    view.unmount();
    await act(async () => {
      if (outcome === 'resolve') resolve({ data: [{ id: 'fake-season' }] });
      else reject(new Error('offline after close'));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
