import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../components/CompactPageBarContext';
import { CurrentCompetitionProvider, useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useTeamNotifications } from '../hooks/useTeamNotifications';
import { LiteModeProvider } from '../lite/LiteModeContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { resetInstallState } from '../hooks/usePwaInstall';
import { fakeDevice, installPromptEvent, resetDevice, UA } from '../test/device';
import { SettingsPage } from './SettingsPage';

vi.mock('../hooks/useTeamNotifications', () => ({ useTeamNotifications: vi.fn() }));
const setEnabled = vi.fn();
const closeInstallGuide = vi.fn();
const base = { needsInstall: false, installGuide: false, closeInstallGuide };
beforeEach(() => {
  setEnabled.mockReset();
  vi.mocked(useTeamNotifications).mockReturnValue({ ...base, enabled: false, setEnabled, permission: 'default', problem: null });
});

afterEach(() => {
  resetInstallState();
  resetDevice();
});

function Probe() {
  const { pathname, hash } = useLocation();
  const { rememberChoice } = useCurrentCompetition();
  const { header } = useCompactPageBarState();
  return <span data-testid="probe">{pathname}{hash}|{rememberChoice}|{header?.title ?? ''}</span>;
}

function mount(options: { path?: string; competition?: boolean } = {}) {
  if (options.competition) {
    document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 4, name: 'Spring Games' }))}; Path=/`;
  }
  return render(
    <MemoryRouter initialEntries={[options.path ?? '/settings']}>
      <LiteModeProvider>
        <ThemeProvider>
          <CurrentCompetitionProvider>
            <CompactPageBarProvider>
              <SettingsPage />
              <Probe />
            </CompactPageBarProvider>
          </CurrentCompetitionProvider>
        </ThemeProvider>
      </LiteModeProvider>
    </MemoryRouter>,
  );
}

describe('SettingsPage', () => {
  it('publishes the Settings header and renders the page heading', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('/settings|ask|Settings');
  });

  it('switches the colour theme from a dropdown row that shows a swatch', async () => {
    mount();
    const row = screen.getByRole('combobox', { name: /Colour theme/ });
    expect(row).toHaveTextContent('EGUK Navy');
    expect(row.querySelector('.sp-swatch')).not.toBeNull();
    await userEvent.click(row);
    await userEvent.click(screen.getByRole('option', { name: 'Stable Night' }));
    expect(screen.getByRole('combobox', { name: /Colour theme/ })).toHaveTextContent('Stable Night');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('changes the text size from a dropdown row', async () => {
    mount();
    expect(screen.getByRole('combobox', { name: /Text size/ })).toHaveTextContent('Normal');
    await userEvent.click(screen.getByRole('combobox', { name: /Text size/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Large' }));
    expect(localStorage.getItem('mg.prefs.textSize')).toBe('large');
  });

  it('has the Lite mode row, and scrolls to it when linked with the hash', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mount({ path: '/settings#lite-mode' });
    expect(scrollIntoView).toHaveBeenCalledOnce();
    const row = screen.getByRole('combobox', { name: /Lite mode/ });
    expect(row).toHaveTextContent('Auto');
    expect(row).toHaveTextContent('Saves battery and data on busy showgrounds');
    await userEvent.click(row);
    await userEvent.click(screen.getByRole('option', { name: 'On' }));
    expect(localStorage.getItem('mg.liteMode')).toBe('on');
  });

  it('toggles the weather option and persists it in localStorage', async () => {
    mount();
    const toggle = screen.getByRole('switch', { name: 'Show weather' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('mg.showWeather')).toBe('1');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('mg.showWeather')).toBeNull();
  });

  it('reflects when weather was already switched on', () => {
    localStorage.setItem('mg.showWeather', '1');
    mount();
    expect(screen.getByRole('switch', { name: 'Show weather' })).toHaveAttribute('aria-checked', 'true');
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
    const toggle = screen.getByRole('switch', { name: 'Show weather' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('offers to remember or forget a competition only when one is followed', () => {
    mount();
    expect(screen.queryByRole('switch', { name: /Remember the competition/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forget this competition' })).not.toBeInTheDocument();
  });

  it('remembers or forgets the followed competition on this device', async () => {
    mount({ competition: true });
    const toggle = screen.getByRole('switch', { name: 'Remember the competition I open' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('probe')).toHaveTextContent('|visit|');
    await userEvent.click(toggle);
    expect(screen.getByTestId('probe')).toHaveTextContent('|remember|');
  });

  it('clears the competition and opens the events list when Forget this competition is clicked', async () => {
    mount({ competition: true });
    await userEvent.click(screen.getByRole('button', { name: 'Forget this competition' }));
    expect(document.cookie).not.toContain('mg.competition');
    expect(sessionStorage.getItem('mg.competitionVisit')).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent('/events|ask|');
    expect(screen.queryByRole('switch', { name: /Remember the competition/ })).not.toBeInTheDocument();
  });

  it('links each policy to its own page', async () => {
    mount();
    const privacy = screen.getByRole('link', { name: 'Privacy' });
    expect(privacy).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Refunds and payments' })).toHaveAttribute('href', '/refunds');
    expect(screen.getByRole('link', { name: 'Cookies and storage' })).toHaveAttribute('href', '/cookies');
    expect(screen.getByRole('link', { name: 'Safeguarding and welfare' })).toHaveAttribute('href', '/safeguarding');
    await userEvent.click(privacy);
    expect(screen.getByTestId('probe')).toHaveTextContent('/privacy|ask|');
  });

  it('has switches for the options on competition days, with no capital-letter card labels', async () => {
    mount();
    for (const name of ['Show weather', 'Vibrate when I tap a score', 'Order scoring teams by lane']) {
      expect(screen.getByRole('switch', { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('switch', { name: 'Vibrate when I tap a score' }));
    expect(localStorage.getItem('mg.prefs.scorerHaptics')).toBe('false');
    await userEvent.click(screen.getByRole('switch', { name: 'Order scoring teams by lane' }));
    expect(localStorage.getItem('mg.prefs.sortByLaneOrder')).toBe('false');
    expect(screen.queryByText('Options')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Policies & legal$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Bottom bar shortcuts')).not.toBeInTheDocument();
  });
});

describe('SettingsPage: heat reminder', () => {
  it('is a round minus and plus stepper in 5 minute steps from 5 to 120, with one short note', async () => {
    mount();
    expect(screen.getByText('While the app is open')).toBeInTheDocument();
    expect(screen.queryByText(/This timing applies to in-app reminders/)).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    const stepper = screen.getByRole('group', { name: 'Heat reminder' });
    expect(within(stepper).getByText('60 min')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '5 minutes more' }));
    expect(localStorage.getItem('mg.prefs.notifyLeadMins')).toBe('65');
    await userEvent.click(screen.getByRole('button', { name: '5 minutes less' }));
    await userEvent.click(screen.getByRole('button', { name: '5 minutes less' }));
    expect(localStorage.getItem('mg.prefs.notifyLeadMins')).toBe('55');
    expect(within(stepper).getByText('55 min')).toBeInTheDocument();
  });

  it('stops at 5 and 120 minutes', () => {
    localStorage.setItem('mg.prefs.notifyLeadMins', '5');
    const first = mount();
    expect(screen.getByRole('button', { name: '5 minutes less' })).toBeDisabled();
    first.unmount();
    localStorage.setItem('mg.prefs.notifyLeadMins', '120');
    mount();
    expect(screen.getByRole('button', { name: '5 minutes more' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '5 minutes less' })).toBeEnabled();
  });

  it('moves an older value that is not a multiple of 5 to the next step', async () => {
    localStorage.setItem('mg.prefs.notifyLeadMins', '47');
    mount();
    await userEvent.click(screen.getByRole('button', { name: '5 minutes more' }));
    expect(localStorage.getItem('mg.prefs.notifyLeadMins')).toBe('50');
  });
});

describe('SettingsPage: bottom bar', () => {
  const rows = () => within(screen.getByRole('list', { name: 'Bottom bar tabs' })).getAllByRole('listitem');
  const names = () => rows().map((row) => row.querySelector('.sp-t1')?.textContent);
  const saved = () => JSON.parse(localStorage.getItem('mg.prefs.bottomTabs') ?? 'null');

  it('lists the tabs that are on first, each with a six-dot grip and a switch, and no arrows or tick boxes', () => {
    mount();
    expect(names().slice(0, 4)).toEqual(['Timetable', 'Toplists', 'Live stream', 'Details']);
    expect(names()).toHaveLength(10);
    expect(screen.getByText('2 to 6 tabs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Move Timetable/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show Timetable in the bottom bar' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Show Shop in the bottom bar' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /earlier|later/ })).not.toBeInTheDocument();
    expect(within(rows()[9]).getByText('Organisers')).toBeInTheDocument();
  });

  it('reorders with ArrowUp and ArrowDown on the focused grip, and saves the order', async () => {
    mount();
    const grip = screen.getByRole('button', { name: /Move Toplists/ });
    grip.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(names().slice(0, 3)).toEqual(['Toplists', 'Timetable', 'Live stream']);
    expect(saved()).toEqual(['toplists', 'timetable', 'chat', 'details']);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(names().slice(0, 3)).toEqual(['Timetable', 'Live stream', 'Toplists']);
    expect(saved()).toEqual(['timetable', 'chat', 'toplists', 'details']);
    // The top row can't go further up.
    screen.getByRole('button', { name: /Move Timetable/ }).focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(names()[0]).toBe('Timetable');
  });

  it('turns a tab on or off with its switch', async () => {
    mount();
    await userEvent.click(screen.getByRole('switch', { name: 'Show Shop in the bottom bar' }));
    expect(screen.getByRole('switch', { name: 'Show Shop in the bottom bar' })).toHaveAttribute('aria-checked', 'true');
    expect(saved()).toEqual(['timetable', 'toplists', 'chat', 'details', 'shop']);
    await userEvent.click(screen.getByRole('switch', { name: 'Show Toplists in the bottom bar' }));
    expect(saved()).toEqual(['timetable', 'chat', 'details', 'shop']);
  });

  it('flags fewer than 2 tabs and more than 6 without blocking either', async () => {
    mount();
    expect(screen.queryByText(/Pick at least 2 tabs/)).not.toBeInTheDocument();
    for (const name of ['Toplists', 'Live stream', 'Details']) await userEvent.click(screen.getByRole('switch', { name: `Show ${name} in the bottom bar` }));
    // One tab is left on, which is allowed; the flag says what the bar will show instead.
    expect(screen.getByRole('switch', { name: 'Show Timetable in the bottom bar' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/^Pick at least 2 tabs/)).toHaveTextContent('Pick at least 2 tabs. With fewer, the bottom bar shows Timetable, Toplists, Live stream and Details.');
    await userEvent.click(screen.getByRole('switch', { name: 'Show Shop in the bottom bar' }));
    expect(screen.queryByText(/Pick at least 2 tabs/)).not.toBeInTheDocument();

    for (const name of ['Following', 'Teams', 'Arena', 'Dec forms', 'Details', 'Toplists']) await userEvent.click(screen.getByRole('switch', { name: `Show ${name} in the bottom bar` }));
    expect(screen.getByText(/^Only the first 6 tabs/)).toHaveTextContent('Only the first 6 tabs that are on will fit.');
    expect(screen.getByRole('switch', { name: 'Show Toplists in the bottom bar' })).toHaveAttribute('aria-checked', 'true');
    expect(saved()).toHaveLength(6);
  });

  it('puts the usual tabs back with Reset to default', async () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Show Shop in the bottom bar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(names().slice(0, 4)).toEqual(['Timetable', 'Toplists', 'Live stream', 'Details']);
    expect(screen.getByRole('switch', { name: 'Show Shop in the bottom bar' })).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('mg.prefs.bottomTabs')).toBeNull();
  });
});

describe('SettingsPage: notifications', () => {
  const card = () => within(screen.getByRole('heading', { name: 'On competition days' }).nextElementSibling as HTMLElement);

  it('puts a Notifications switch first in On competition days, with its sub-line', () => {
    mount();
    const first = card().getAllByRole('switch')[0];
    expect(first).toHaveAccessibleName('Notifications');
    expect(first).toHaveAttribute('aria-checked', 'false');
    expect(card().getByText('Heat calls and announcements on this phone')).toBeInTheDocument();
  });

  it('turns notifications on', async () => {
    mount();
    await userEvent.click(card().getByRole('switch', { name: 'Notifications' }));
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it('turns them off again when they are on', async () => {
    vi.mocked(useTeamNotifications).mockReturnValue({ ...base, enabled: true, setEnabled, permission: 'granted', problem: null });
    mount();
    const on = card().getByRole('switch', { name: 'Notifications' });
    expect(on).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(on);
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it('switches it off, and says why, when the browser has blocked notifications', () => {
    vi.mocked(useTeamNotifications).mockReturnValue({ ...base, enabled: false, setEnabled, permission: 'denied', problem: null });
    mount();
    expect(card().getByRole('switch', { name: 'Notifications' })).toBeDisabled();
    expect(card().getByText('Blocked in your browser’s settings')).toBeInTheDocument();
  });

  it('switches it off, and says why, when the browser can’t show notifications', () => {
    vi.mocked(useTeamNotifications).mockReturnValue({ ...base, enabled: false, setEnabled, permission: 'unsupported', problem: null });
    mount();
    expect(card().getByRole('switch', { name: 'Notifications' })).toBeDisabled();
    expect(card().getByText('This browser can’t show notifications')).toBeInTheDocument();
  });

  it('shows the problem strip when turning them on failed', () => {
    vi.mocked(useTeamNotifications).mockReturnValue({ ...base, enabled: false, setEnabled, permission: 'default', problem: 'This browser can’t show notifications. Try Chrome or Safari.' });
    mount();
    expect(card().getByRole('alert')).toHaveTextContent('Try Chrome or Safari.');
  });

  it('offers to install the app on an iPhone, with the Home Screen steps', async () => {
    fakeDevice({ userAgent: UA.iphoneSafari });
    mount();
    await userEvent.click(card().getByRole('button', { name: /Install the app/ }));
    expect(screen.getByRole('heading', { name: 'Add to your Home Screen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers Chromium’s install prompt once the browser has sent one', () => {
    fakeDevice({ userAgent: UA.desktopChrome });
    mount();
    expect(screen.queryByRole('button', { name: /Install the app/ })).toBeNull();
    act(() => { window.dispatchEvent(installPromptEvent()); });
    expect(card().getByRole('button', { name: /Install the app/ })).toBeInTheDocument();
  });

  it('hides the install row once the app is on the Home Screen', () => {
    fakeDevice({ userAgent: UA.iphoneSafari, iosStandalone: true });
    mount();
    expect(screen.queryByRole('button', { name: /Install the app/ })).toBeNull();
  });

  it('keeps the notifications switch live on an iPhone that needs the app on its Home Screen, and shows how', () => {
    vi.mocked(useTeamNotifications).mockReturnValue({ ...base, needsInstall: true, installGuide: true, enabled: false, setEnabled, permission: 'unsupported', problem: null });
    fakeDevice({ userAgent: UA.iphoneSafari });
    mount();
    expect(card().getByRole('switch', { name: 'Notifications' })).toBeEnabled();
    expect(card().getByText('Add the app to your Home Screen first')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Notifications only reach an iPhone once the app is on its Home Screen.');
  });
});
