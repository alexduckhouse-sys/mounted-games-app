import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../components/CompactPageBarContext';
import { CurrentCompetitionProvider, useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { LiteModeProvider } from '../lite/LiteModeContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { SettingsPage } from './SettingsPage';

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

  it('switches the colour theme', async () => {
    mount();
    const themes = within(screen.getByRole('group', { name: 'Colour theme' }));
    expect(themes.getByRole('button', { name: 'EGUK Navy' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(themes.getByRole('button', { name: 'Stable Night' }));
    expect(themes.getByRole('button', { name: 'Stable Night' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('renders the Lite mode section and scrolls to #lite-mode when linked with the hash', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mount({ path: '/settings#lite-mode' });
    expect(scrollIntoView).toHaveBeenCalledOnce();
    const liteGroup = within(screen.getByRole('group', { name: 'Lite mode' }));
    expect(liteGroup.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(liteGroup.getByRole('button', { name: 'On' }));
    expect(liteGroup.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
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
    expect(screen.queryByRole('switch', { name: /Remember this competition/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forget this competition' })).not.toBeInTheDocument();
  });

  it('remembers or forgets the followed competition on this device', async () => {
    mount({ competition: true });
    const toggle = screen.getByRole('switch', { name: 'Remember this competition on this device' });
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
    expect(screen.queryByRole('switch', { name: /Remember this competition/ })).not.toBeInTheDocument();
  });

  it('links to the privacy, terms, refunds, cookies, and safeguarding policies', async () => {
    mount();
    const privacy = screen.getByRole('link', { name: 'Privacy' });
    expect(privacy).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/privacy#terms');
    expect(screen.getByRole('link', { name: 'Refunds & cancellations' })).toHaveAttribute('href', '/privacy#refunds');
    expect(screen.getByRole('link', { name: 'Cookies & offline storage' })).toHaveAttribute('href', '/privacy#cookies');
    expect(screen.getByRole('link', { name: 'Safeguarding & equine welfare' })).toHaveAttribute('href', '/privacy#safeguarding');
    await userEvent.click(privacy);
    expect(screen.getByTestId('probe')).toHaveTextContent('/privacy|ask|');
  });

  it('does not show role presets, explains Lite mode, and allows custom heat reminder timings with notification explanation', async () => {
    mount();
    expect(screen.queryByRole('group', { name: 'Bottom bar role presets' })).not.toBeInTheDocument();
    expect(screen.getByText(/Saves battery and mobile data on busy showgrounds/)).toBeInTheDocument();
    expect(screen.getByText(/This timing applies to in-app reminders/)).toBeInTheDocument();

    const customInput = screen.getByRole('spinbutton', { name: 'Custom heat reminder minutes' });
    expect(customInput).toHaveValue(60);
    await userEvent.clear(customInput);
    await userEvent.type(customInput, '45');
    expect(localStorage.getItem('mg.prefs.notifyLeadMins')).toBe('45');
    for (const value of ['0', '241', '1.5']) {
      fireEvent.change(customInput, { target: { value } });
      expect(localStorage.getItem('mg.prefs.notifyLeadMins')).toBe('45');
    }
    fireEvent.blur(customInput);
    expect(customInput).toHaveValue(45);
    fireEvent.change(customInput, { target: { value: '1e2' } });
    expect(localStorage.getItem('mg.prefs.notifyLeadMins')).toBe('100');
  });
});
