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

  it('shows the same General section as a competition menu, without the competition part', () => {
    mount();
    expect(screen.queryByRole('navigation', { name: 'This competition' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Age groups' })).not.toBeInTheDocument();
    const heading = screen.getByRole('heading', { name: 'General' });
    expect(heading).toHaveClass('text-lg', 'font-bold');
    expect(links('General')).toEqual([
      ['Competitions', '/events'], ['Following', '/following'], ['Past competitions', '/competitions/past'], ['Seasons', '/seasons'],
      ['Rider and team stats', '/stats'], ['Team profiles', '/team-profiles'], ['Tack and kit shop', '/shop'], ['Settings', '/settings'],
    ]);
    // Every row, the QR scanner included, has an icon.
    const rows = [...within(screen.getByRole('navigation', { name: 'General' })).getAllByRole('link'), screen.getByRole('button', { name: 'Scan a QR code' })];
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(row.querySelector('svg')).not.toBeNull();
    // The short site menu has bigger rows: 18px text and 24px icons, nothing capping either.
    for (const row of rows) {
      expect(row).toHaveClass('text-lg', 'min-h-14');
      expect(row.querySelector('svg')).toHaveClass('h-6', 'w-6');
    }
  });

  it('invites a visitor to sign in at the bottom of the menu without a role caption', () => {
    mount();
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('href', '/login');
    expect(signIn).toHaveClass('mg-btn-primary');
    // Sign-in stays at the bottom, after the navigation links.
    expect(screen.getByRole('navigation', { name: 'General' }).compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    await userEvent.click(screen.getByRole('link', { name: 'Competitions' }));
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

  it('keeps its compact rows and icons, because it has more to list', () => {
    mount({ competition: true });
    const row = screen.getByRole('link', { name: 'Following' });
    expect(row).toHaveClass('text-base', 'min-h-12');
    expect(row.querySelector('svg')).toHaveClass('h-5', 'w-5');
  });

  it('shows just the name when the details are for a different competition', () => {
    mount({ competition: true, meta: { id: 99 } });
    expect(screen.getByRole('heading', { name: 'Spring Games' })).toBeInTheDocument();
    expect(screen.queryByText(/Oct/)).not.toBeInTheDocument();
  });

  it('links to the competition’s extra pages (omitting duplicate bottom-tab links)', async () => {
    mount({ competition: true });
    expect(links('This competition')).toEqual([
      ['Weather', '/competitions/4/weather'], ['Teams', '/competitions/4/teams'],
      ['Following', '/competitions/4/following'], ['Event shop', '/competitions/4/shop'],
    ]);
    const communityShop = screen.getByRole('link', { name: 'Tack and kit shop' });
    expect(communityShop).toHaveAttribute('href', '/shop');
    await userEvent.click(communityShop);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/shop');
  });

  it('highlights the page being viewed', () => {
    mount({ competition: true, path: '/competitions/4/shop' });
    const nav = within(screen.getByRole('navigation', { name: 'This competition' }));
    expect(nav.getByRole('link', { name: 'Event shop' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Following' })).not.toHaveAttribute('aria-current');
  });

  it('highlights only the site page being viewed when no competition is followed', () => {
    mount({ path: '/events' });
    const nav = within(screen.getByRole('navigation', { name: 'General' }));
    expect(nav.getAllByRole('link').filter((link) => link.hasAttribute('aria-current')).map((link) => link.textContent)).toEqual(['Competitions']);
    expect(screen.queryByRole('link', { name: 'Rulebooks' })).not.toBeInTheDocument();
  });
});

describe('NavigationDrawer: On the day', () => {
  it('gives the organiser the PA desk, TV kiosk and QR codes, first in the menu', async () => {
    mount({ competition: true, roles: ['Trainer'], meta: { createdByUserId: 'u1' } });
    const day = screen.getByRole('navigation', { name: 'On the day' });
    expect(screen.getByRole('heading', { name: 'On the day' })).toBeInTheDocument();
    expect(links('On the day')).toEqual([['PA desk', '/competitions/4/commentary'], ['Race recordings', '/competitions/4/recordings'], ['TV kiosk', '/competitions/4/tv'], ['Prize-giving', '/competitions/4/prize-giving']]);
    // It comes before the competition's own pages.
    expect(day.compareDocumentPosition(screen.getByRole('navigation', { name: 'This competition' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(within(day).getByRole('link', { name: 'TV kiosk' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/4/tv');
  });

  it('gives the organiser a Before the day link, and nobody else', () => {
    const { unmount } = mount({ competition: true, roles: ['Trainer'], meta: { createdByUserId: 'u1' } });
    expect(links('Before the day')).toEqual([['Before the day', '/competitions/4/operations']]);
    unmount();
    mount({ competition: true, roles: ['Member'], meta: { createdByUserId: 'u1' } });
    expect(screen.queryByRole('navigation', { name: 'Before the day' })).toBeNull();
  });

  it('opens the QR codes sheet from Scorer and screen QR codes', async () => {
    mount({ competition: true, roles: ['Admin'], meta: {} });
    expect(screen.queryByRole('dialog', { name: 'Share with QR codes' })).toBeNull();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'On the day' })).getByRole('button', { name: 'Scorer and screen QR codes' }));
    expect(await screen.findByRole('dialog', { name: 'Share with QR codes' })).toBeInTheDocument();
  });

  it('carries the chosen age group to the PA desk and TV kiosk', () => {
    mount({ competition: true, roles: ['Admin'], meta: {}, path: '/competitions/4/scoring?section=7', groups: [{ id: 7, name: 'Under 12' }] });
    expect(links('On the day')).toEqual([['PA desk', '/competitions/4/commentary?section=7'], ['Race recordings', '/competitions/4/recordings'], ['TV kiosk', '/competitions/4/tv?section=7'], ['Prize-giving', '/competitions/4/prize-giving?section=7'], ['Announcements', '/competitions/4/announcements']]);
  });

  it('is not there for a spectator, a signed-out visitor, or a trainer who does not run this competition', () => {
    const { unmount } = mount({ competition: true, roles: ['Member'], meta: { createdByUserId: 'u1' } });
    expect(screen.queryByRole('navigation', { name: 'On the day' })).toBeNull();
    unmount();
    const signedOut = mount({ competition: true, meta: {} });
    expect(screen.queryByRole('navigation', { name: 'On the day' })).toBeNull();
    signedOut.unmount();
    mount({ competition: true, roles: ['Trainer'], meta: { createdByUserId: 'someone-else' } });
    expect(screen.queryByRole('navigation', { name: 'On the day' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scorer and screen QR codes' })).toBeNull();
  });
});

describe('NavigationDrawer: age groups', () => {
  const groups = [{ id: 11, name: 'Seniors', live: true }, { id: 12, name: 'Juniors', next: '09:05' }, { id: 13, name: 'Novices' }];
  const openGroups = () => userEvent.click(screen.getByRole('button', { name: /Age group/ }));

  it('is a closed settings-style row at the top of the menu, Age group beside the current group', () => {
    mount({ competition: true, groups });
    const row = screen.getByRole('button', { name: /Age group/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveTextContent('Age groupSeniors');
    expect(screen.queryByRole('navigation', { name: 'Age groups' })).not.toBeInTheDocument();
    // It sits straight after the header, before the menu sections.
    expect(screen.getByRole('heading', { name: 'Spring Games' }).compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(screen.getByRole('heading', { name: 'This competition' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens downwards listing each group with LIVE or its next time, and closes the menu on choice', async () => {
    mount({ competition: true, groups });
    await openGroups();
    expect(screen.getByRole('button', { name: /Age group/ })).toHaveAttribute('aria-expanded', 'true');
    expect(links('Age groups')).toEqual([['SeniorsLive', '/competitions/4/toplists?section=11'], ['JuniorsNext 09:05', '/competitions/4/toplists?section=12'], ['Novices', '/competitions/4/toplists?section=13']]);
    await userEvent.click(screen.getByRole('link', { name: /Juniors/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows no age groups when there are none, or they belong to another competition', () => {
    mount({ competition: true, groups: [] });
    expect(screen.queryByRole('button', { name: /Age group/ })).not.toBeInTheDocument();
  });

  it('shows no age groups without a followed competition', () => {
    mount({ groups });
    expect(screen.queryByRole('button', { name: /Age group/ })).not.toBeInTheDocument();
  });

  it('shows the selected age group on the age group page and marks it', async () => {
    mount({ competition: true, groups, path: '/competitions/4/scoring?section=12' });
    expect(screen.getByRole('button', { name: /Age group/ })).toHaveTextContent('Juniors');
    await openGroups();
    const nav = within(screen.getByRole('navigation', { name: 'Age groups' }));
    expect(nav.getByRole('link', { name: /Juniors/ })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: /Seniors/ })).not.toHaveAttribute('aria-current');
  });

  it('also follows the age group on the toplists route', () => {
    mount({ competition: true, groups, path: '/competitions/4/toplists?section=13' });
    expect(screen.getByRole('button', { name: /Age group/ })).toHaveTextContent('Novices');
  });

  it('starts on the first age group when none is chosen', () => {
    mount({ competition: true, groups, path: '/competitions/4' });
    expect(screen.getByRole('button', { name: /Age group/ })).toHaveTextContent('Seniors');
  });
});

describe('NavigationDrawer: sections', () => {
  it('has no FOLLOWING label above the competition name', () => {
    mount({ competition: true });
    expect(screen.queryByText('Following', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('puts the competition section before General, under sentence-case headings', () => {
    mount({ competition: true });
    const competitionHeading = screen.getByRole('heading', { name: 'This competition' });
    const generalHeading = screen.getByRole('heading', { name: 'General' });
    expect(competitionHeading.compareDocumentPosition(generalHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(competitionHeading).toHaveClass('text-lg', 'font-bold');
    expect(competitionHeading.className).not.toMatch(/uppercase/);
    expect(links('General').map(([label]) => label)).toEqual([
      'Competitions', 'Seasons', 'Past competitions', 'Rider and team stats', 'Team profiles', 'Tack and kit shop', 'Settings',
    ]);
    expect(screen.getByRole('button', { name: 'Scan a QR code' })).toBeInTheDocument();
  });

  it('no longer lists Dec forms, Rules and arena setup, or Details and entries', () => {
    mount({ competition: true });
    for (const name of ['Dec forms', 'Rules and arena setup', 'Details and entries']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('keeps the account block last: a Sign in pill when signed out', () => {
    mount({ competition: true });
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(screen.getByRole('navigation', { name: 'General' }).compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    const scanBtn = screen.getByRole('button', { name: 'Scan a QR code' });
    const settingsLink = screen.getByRole('link', { name: 'Settings' });
    expect(scanBtn.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(scanBtn);
    expect(screen.getByRole('dialog', { name: 'Scan the QR code' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close QR scanner' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Scan the QR code' })).not.toBeInTheDocument());

    await userEvent.click(scanBtn);
    fireEvent.change(screen.getByLabelText('Scoring or camera link'), {
      target: { value: '/competitions/4/broadcast?pair=pair_secret_1234567890' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That QR code isn’t a scoring or camera code');
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
    // Away from a competition it sits under General, above the other rows.
    expect(screen.getByRole('heading', { name: 'General' }).compareDocumentPosition(screen.getByRole('link', { name: /Weather/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    await userEvent.click(screen.getByRole('button', { name: 'Scan a QR code' }));
    expect(screen.getByRole('dialog', { name: 'Scan the QR code' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close QR scanner' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Scan the QR code' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe')).toHaveTextContent('/|');
  });

  it('verifies through the scoped client before closing the menu and navigating with the permission fragment', async () => {
    const token = 'mgs_fake_drawer_permission';
    const session = { competitionId: 4, competitionName: 'Fake event', label: 'Fake camera', arenaName: 'Main', scope: 1, sessions: [] };
    const verify = vi.spyOn(scorerApi, 'get').mockResolvedValue({ data: session });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Scan a QR code' }));
    fireEvent.change(screen.getByLabelText('Scoring or camera link'), { target: { value: `/score#t=${token}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(`/score#t=${token}`));
    expect(verify).toHaveBeenCalledExactlyOnceWith('/scorer/session', { headers: { 'X-Scorer-Token': token } });
    expect(readScorerToken()).toBe(token);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Scan the QR code' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/scorer/session', expect.anything());
  });

  it('keeps the drawer and scanner open when verification fails', async () => {
    vi.spyOn(scorerApi, 'get').mockRejectedValue({ response: { status: 410 } });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Scan a QR code' }));
    fireEvent.change(screen.getByLabelText('Scoring or camera link'), { target: { value: 'mgs_fake_expired_permission' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That QR code isn’t a scoring or camera code, or it has stopped working');
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
