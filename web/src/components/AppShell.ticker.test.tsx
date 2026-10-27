import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { LiteModeProvider } from '../lite/LiteModeContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { api } from '../api';
import type { TickerItem } from '../lib/ticker';
import { AgeGroupsProvider } from './AgeGroupsContext';
import { AppShell } from './AppShell';
import { CompactPageBarProvider } from './CompactPageBarContext';
import { CompetitionMetaProvider } from './CompetitionMetaContext';
import { NavExtrasProvider } from './NavExtrasContext';
import { TickerProvider, useTicker } from './TickerContext';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));
vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));
vi.mock('./ConnectionPill', () => ({ ConnectionPill: () => null }));
vi.mock('./TopBarTicker', () => ({ TopBarTicker: ({ low }: { low?: boolean }) => <div data-testid="dock" data-low={String(!!low)} /> }));
vi.mock('./TickerFeed', () => ({ TickerFeed: ({ competitionId }: { competitionId: number }) => <span data-testid="feed">{competitionId}</span> }));

const line: TickerItem = { key: 'live-1', kind: 'live', text: 'Now: Seniors Session 1 · Heat 1' };
const remembered = () => { document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 4, name: 'Spring Games' }))}; Path=/`; };

function Publish({ items, watch = null }: { items: TickerItem[]; watch?: number | null }) {
  const { setItems, setWatchCompetitionId } = useTicker();
  useEffect(() => { setItems(items); }, [items, setItems]);
  useEffect(() => { setWatchCompetitionId(watch); }, [watch, setWatchCompetitionId]);
  return null;
}
function mount(path: string, items: TickerItem[] = [line], watch: number | null = null) {
  return render(
    <MotionConfig reducedMotion="always"><MemoryRouter initialEntries={[path]}>
      <LiteModeProvider><AuthProvider><ThemeProvider><CurrentCompetitionProvider><NavExtrasProvider><AgeGroupsProvider><CompetitionMetaProvider><CompactPageBarProvider><TickerProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<Publish items={items} watch={watch} />} />
          </Route>
        </Routes>
      </TickerProvider></CompactPageBarProvider></CompetitionMetaProvider></AgeGroupsProvider></NavExtrasProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider></LiteModeProvider>
    </MemoryRouter></MotionConfig>,
  );
}
const main = () => screen.getByRole('main');
const dock = () => screen.queryByTestId('dock');

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: {} });
  remembered();
});

describe('AppShell: the ticker on every page', () => {
  it('follows the event last opened on the pages outside it, above the tab bar', () => {
    mount('/events');
    expect(screen.getByTestId('feed')).toHaveTextContent('4');
    expect(dock()).toHaveAttribute('data-low', 'false');
    expect(main()).toHaveClass('pb-44');
  });

  it('leaves an event’s own pages to feed it themselves', () => {
    mount('/competitions/4/teams');
    expect(screen.queryByTestId('feed')).toBeNull();
    expect(dock()).toHaveAttribute('data-low', 'false');
    expect(main()).toHaveClass('pb-44');
  });

  it('shows on the live feed too, with room under the page', () => {
    mount('/competitions/4/chat');
    expect(dock()).toBeInTheDocument();
    expect(main()).toHaveClass('pb-14');
  });

  it('sits at the bottom of pages with no tab bar', () => {
    const { unmount } = mount('/settings');
    expect(dock()).toHaveAttribute('data-low', 'true');
    expect(main()).toHaveClass('pb-24');
    unmount();
    mount('/admin');
    expect(dock()).toHaveAttribute('data-low', 'true');
    expect(main()).toHaveClass('pt-3', 'pb-24');
  });

  it('keeps the usual spacing when there is no news, and shows for live video alone', () => {
    const { unmount } = mount('/events', []);
    expect(main()).toHaveClass('pb-28');
    unmount();
    mount('/admin', []);
    expect(main()).toHaveClass('pb-3');
    expect(main()).not.toHaveClass('pb-24');
    mount('/competitions/4/chat', []);
    expect(screen.getAllByRole('main').at(-1)).toHaveClass('pb-0');
  });

  it('counts live video as something to show', () => {
    mount('/settings', [], 4);
    expect(main()).toHaveClass('pb-24');
  });

  it('stays out of filming mode, and has nothing to follow without a remembered event', () => {
    const { unmount } = mount('/competitions/4/broadcast');
    expect(dock()).toBeNull();
    expect(screen.queryByTestId('feed')).toBeNull();
    unmount();
    document.cookie = 'mg.competition=; Path=/; Max-Age=0';
    sessionStorage.clear();
    mount('/settings');
    expect(screen.queryByTestId('feed')).toBeNull();
    expect(main()).toHaveClass('pb-10');
  });
});
