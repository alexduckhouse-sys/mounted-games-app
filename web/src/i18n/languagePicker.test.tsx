import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { AgeGroupsProvider } from '../components/AgeGroupsContext';
import { CompactPageBarProvider } from '../components/CompactPageBarContext';
import { CompetitionMetaProvider } from '../components/CompetitionMetaContext';
import { NavExtrasProvider } from '../components/NavExtrasContext';
import { NavigationDrawer } from '../components/NavigationDrawer';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { useTeamNotifications } from '../hooks/useTeamNotifications';
import { LiteModeProvider } from '../lite/LiteModeContext';
import { SettingsPage } from '../pages/SettingsPage';
import { ThemeProvider } from '../theme/ThemeContext';
import { LanguageProvider } from './LanguageContext';
import { LANG_KEY } from './translate';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));
vi.mock('../hooks/useTeamNotifications', () => ({ useTeamNotifications: vi.fn() }));
vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: {} });
  vi.mocked(useTeamNotifications).mockReturnValue({ enabled: false, setEnabled: vi.fn(), permission: 'default', problem: null, needsInstall: false, installGuide: false, closeInstallGuide: vi.fn() });
});

describe('the menu and language', () => {
  const mountMenu = () => render(
    <LanguageProvider>
      <MotionConfig reducedMotion="always"><MemoryRouter>
        <AuthProvider><ThemeProvider><CurrentCompetitionProvider><NavExtrasProvider><AgeGroupsProvider><CompetitionMetaProvider>
          <NavigationDrawer onClose={() => {}} />
        </CompetitionMetaProvider></AgeGroupsProvider></NavExtrasProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider>
      </MemoryRouter></MotionConfig>
    </LanguageProvider>,
  );

  it('has no language buttons (Language lives in Settings, under Look)', () => {
    mountMenu();
    expect(screen.queryByRole('group', { name: 'Language' })).not.toBeInTheDocument();
    for (const name of ['English', 'Cymraeg', 'Français']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('is worded in the chosen language', () => {
    localStorage.setItem(LANG_KEY, 'fr');
    mountMenu();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Général' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Réglages' })).toHaveAttribute('href', '/settings');
    expect(document.documentElement.lang).toBe('fr');
  });
});

describe('language picker in Settings', () => {
  it('picks a language from the Look card and translates the page', async () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <LiteModeProvider><ThemeProvider><CurrentCompetitionProvider><CompactPageBarProvider>
            <SettingsPage />
          </CompactPageBarProvider></CurrentCompetitionProvider></ThemeProvider></LiteModeProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );
    const row = screen.getByRole('combobox', { name: /Language/ });
    expect(row).toHaveTextContent('English');
    await userEvent.click(row);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['English', 'Cymraeg', 'Français']);
    await userEvent.click(screen.getByRole('option', { name: 'Cymraeg' }));

    expect(screen.getByRole('heading', { name: 'Gosodiadau' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Iaith/ })).toHaveTextContent('Cymraeg');
    // Names of the bottom bar tabs follow the language, and the policy links too.
    expect(screen.getByText('Amserlen')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Preifatrwydd' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('switch', { name: 'Dangos Amserlen yn y bar gwaelod' })).toBeInTheDocument();
  });
});
