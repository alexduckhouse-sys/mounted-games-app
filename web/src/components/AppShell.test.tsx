import { render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, Link, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { LiteModeProvider } from '../lite/LiteModeContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { api } from '../api';
import { AgeGroupsProvider } from './AgeGroupsContext';
import { AppShell } from './AppShell';
import { CompactPageBarProvider } from './CompactPageBarContext';
import { CompetitionMetaProvider } from './CompetitionMetaContext';
import { NavExtrasProvider } from './NavExtrasContext';
import { useSetWeatherLine, WeatherLineProvider, type WeatherLineModel } from './WeatherLineContext';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));
vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));
vi.mock('./ConnectionPill', () => ({ ConnectionPill: () => null }));
vi.mock('./TopBarTicker', () => ({ TopBarTicker: () => null }));

const spring = { id: 4, name: 'Spring Games' };
const remembered = () => { document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify(spring))}; Path=/`; };

let weatherLine: WeatherLineModel | null = null;
function Probe() {
  const { pathname, hash } = useLocation();
  const setWeatherLine = useSetWeatherLine();
  useEffect(() => { setWeatherLine(weatherLine); }, [setWeatherLine]);
  return <><span data-testid="probe">{pathname}{hash}</span><Link to="/competitions/4/broadcast">Film test</Link><Link to="/events">Leave filming test</Link></>;
}
function mount(path: string) {
  return render(
    <MotionConfig reducedMotion="always"><MemoryRouter initialEntries={[path]}>
      <LiteModeProvider><WeatherLineProvider><AuthProvider><ThemeProvider><CurrentCompetitionProvider><NavExtrasProvider><AgeGroupsProvider><CompetitionMetaProvider><CompactPageBarProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<Probe />} />
          </Route>
        </Routes>
      </CompactPageBarProvider></CompetitionMetaProvider></AgeGroupsProvider></NavExtrasProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider></WeatherLineProvider></LiteModeProvider>
    </MemoryRouter></MotionConfig>,
  );
}

beforeEach(() => {
  weatherLine = null;
  vi.mocked(api.get).mockResolvedValue({ data: {} });
});

describe('AppShell: choosing a competition', () => {
  it('sends the MG logo to the events list, not back into the competition', () => {
    remembered();
    mount('/following');
    expect(screen.getByRole('link', { name: 'Mounted Games home' })).toHaveAttribute('href', '/events');
  });

  it('opens the events list from the header title, with no dialog', async () => {
    remembered();
    mount('/competitions/4');
    await userEvent.click(screen.getByRole('link', { name: /Spring Games.*Events/ }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/events');
    expect(screen.queryByRole('dialog', { name: 'Select a competition' })).not.toBeInTheDocument();
  });

  it('opens the events list from the menu', async () => {
    remembered();
    mount('/competitions/4');
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('link', { name: 'Competitions' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/events');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the Settings page from the menu and closes the drawer', async () => {
    remembered();
    mount('/competitions/4');
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/settings');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes the user to the Lite mode section of Settings when the Lite mode header icon is clicked', async () => {
    localStorage.setItem('mg.liteMode', 'on');
    mount('/events');
    const liteButton = screen.getByRole('button', { name: 'Lite mode is on. Open the setting' });
    await userEvent.click(liteButton);
    expect(screen.getByTestId('probe')).toHaveTextContent('/settings#lite-mode');
  });

  it('does not ask to remember a competition on the events list', () => {
    mount('/events');
    expect(screen.queryByRole('region', { name: 'Save quick access on this device?' })).not.toBeInTheDocument();
  });
});

describe('AppShell: pages outside a competition', () => {
  it.each(['/events', '/following', '/dashboard', '/shop'])('shows the Events, Following and Me tabs at %s, with a competition selected', (path) => {
    remembered();
    mount(path);
    const tabs = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link').map((link) => link.textContent);
    expect(tabs).toEqual(['Events', 'Following', 'Me']);
  });

  it('has no Live tab', () => {
    mount('/events');
    expect(screen.queryByRole('link', { name: 'Live' })).not.toBeInTheDocument();
  });

  it('hides the header bar and bottom tabs in filming mode (/broadcast)', () => {
    remembered();
    mount('/competitions/4/broadcast');
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});


it('resumes observing the header after leaving filming mode', async () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  class Observer { observe = observe; disconnect = disconnect; }
  vi.stubGlobal('ResizeObserver', Observer);
  try {
    mount('/events');
    const initial = observe.mock.calls.length;
    expect(initial).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('link', { name: 'Film test' }));
    expect(document.documentElement.style.getPropertyValue('--mg-shell-h')).toBe('0px');
    expect(disconnect).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('link', { name: 'Leave filming test' }));
    expect(observe.mock.calls.length).toBeGreaterThan(initial);
  } finally { vi.unstubAllGlobals(); }
});

describe('AppShell: the weather line', () => {
  it('shows the organiser’s weather line under the ticker on an event page, and not elsewhere', () => {
    weatherLine = { tone: 'warn', icon: 'thunder', text: 'Thunder likely from about 14:00', actionLabel: 'What to do', onOpen: vi.fn() };
    remembered();
    const view = mount('/competitions/4');
    expect(screen.getByRole('button', { name: /Thunder likely from about 14:00/ })).toBeInTheDocument();
    view.unmount();
    mount('/events');
    expect(screen.queryByRole('button', { name: /Thunder likely/ })).toBeNull();
  });
});
