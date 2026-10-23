import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { api } from '../api';
import { AgeGroupsProvider } from './AgeGroupsContext';
import { AppShell } from './AppShell';
import { CompactPageBarProvider } from './CompactPageBarContext';
import { CompetitionMetaProvider } from './CompetitionMetaContext';
import { NavExtrasProvider } from './NavExtrasContext';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));
vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));
vi.mock('./ConnectionPill', () => ({ ConnectionPill: () => null }));
vi.mock('./TopBarTicker', () => ({ TopBarTicker: () => null }));

const spring = { id: 4, name: 'Spring Games' };
const remembered = () => { document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify(spring))}; Path=/`; };

function Probe() {
  const { pathname } = useLocation();
  return <span data-testid="probe">{pathname}</span>;
}
function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><ThemeProvider><CurrentCompetitionProvider><NavExtrasProvider><AgeGroupsProvider><CompetitionMetaProvider><CompactPageBarProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<Probe />} />
          </Route>
        </Routes>
      </CompactPageBarProvider></CompetitionMetaProvider></AgeGroupsProvider></NavExtrasProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
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
    await userEvent.click(screen.getByRole('link', { name: /Spring Games.*Change competition/ }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/events');
    expect(screen.queryByRole('dialog', { name: 'Select a competition' })).not.toBeInTheDocument();
  });

  it('opens the events list from the menu', async () => {
    remembered();
    mount('/competitions/4');
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('link', { name: 'Change competition' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/events');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('forgets the competition from the menu without asking to remember anything afterwards', async () => {
    sessionStorage.setItem('mg.competitionVisit', JSON.stringify(spring));
    mount('/competitions/4');
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Forget this competition' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('/events');
    expect(sessionStorage.getItem('mg.competitionVisit')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not ask to remember a competition on the events list', () => {
    mount('/events');
    expect(screen.queryByRole('dialog', { name: 'Remember this competition?' })).not.toBeInTheDocument();
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
});
