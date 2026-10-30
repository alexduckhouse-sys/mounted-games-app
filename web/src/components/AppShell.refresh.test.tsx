import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { LiteModeProvider } from '../lite/LiteModeContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { api } from '../api';
import type { RefreshOutcome } from '../lib/refreshOutcome';
import { AgeGroupsProvider } from './AgeGroupsContext';
import { AppShell } from './AppShell';
import { CompactPageBarProvider, usePageHeader } from './CompactPageBarContext';
import { CompetitionMetaProvider } from './CompetitionMetaContext';
import { NavExtrasProvider } from './NavExtrasContext';
import { WeatherLineProvider } from './WeatherLineContext';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));
vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));
vi.mock('./ConnectionPill', () => ({ ConnectionPill: () => null }));
vi.mock('./TopBarTicker', () => ({ TopBarTicker: () => <div data-testid="ticker" /> }));

let answer: () => Promise<RefreshOutcome>;
function Timetable({ plain = false }: { plain?: boolean }) {
  usePageHeader({ title: 'Timetable', subtitle: 'Spring Games', subtitleTail: '10:54', plain, onRefresh: () => answer(), refreshLabel: 'Refresh timetable' });
  return null;
}
function mount(plain = false) {
  return render(
    <MotionConfig reducedMotion="always"><MemoryRouter initialEntries={['/competitions/4']}>
      <LiteModeProvider><WeatherLineProvider><AuthProvider><ThemeProvider><CurrentCompetitionProvider><NavExtrasProvider><AgeGroupsProvider><CompetitionMetaProvider><CompactPageBarProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<Timetable plain={plain} />} />
          </Route>
        </Routes>
      </CompactPageBarProvider></CompetitionMetaProvider></AgeGroupsProvider></NavExtrasProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider></WeatherLineProvider></LiteModeProvider>
    </MemoryRouter></MotionConfig>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: {} });
});

it('spins the header refresh until the page answers, then says it is up to date in place of the time', async () => {
  let finish!: (outcome: RefreshOutcome) => void;
  answer = () => new Promise((resolve) => { finish = resolve; });
  const { container } = mount();
  const header = container.querySelector('header')!;
  expect(header).toHaveTextContent('· 10:54');
  const button = screen.getByRole('button', { name: 'Refresh timetable' });
  await userEvent.click(button);
  expect(button).toHaveAttribute('data-phase', 'loading');
  await waitFor(() => expect(header).toHaveTextContent('· Refreshing…'));
  finish('same');
  await waitFor(() => expect(button).toHaveAttribute('data-phase', 'same'));
  await waitFor(() => expect(header).toHaveTextContent('· Up to date'));
  expect(screen.getByRole('status')).toHaveTextContent('Up to date');
});

it('shows the result after the subtitle of a plain header too', async () => {
  answer = () => Promise.resolve('failed');
  const { container } = mount(true);
  await userEvent.click(screen.getByRole('button', { name: 'Refresh timetable' }));
  await waitFor(() => expect(container.querySelector('header')).toHaveTextContent('Spring Games· Couldn’t refresh'));
});
