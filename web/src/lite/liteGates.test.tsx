import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider, useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { AgeGroupsProvider } from '../components/AgeGroupsContext';
import { CompactPageBarProvider } from '../components/CompactPageBarContext';
import { CompetitionMetaProvider } from '../components/CompetitionMetaContext';
import { NavExtrasProvider } from '../components/NavExtrasContext';
import { NavigationDrawer } from '../components/NavigationDrawer';
import { LiveVideo } from '../components/stream/LiveVideo';
import { WeatherAt, WeatherNow } from '../components/WeatherChips';
import { WeatherBadge } from '../components/WeatherBadge';
import { SettingsPage } from '../pages/SettingsPage';
import { ThemeProvider } from '../theme/ThemeContext';
import { getWeather } from '../weather/weather';
import { session } from '../test/factories';
import { fakePeerConstructor, fakeStreamConstructor, flush, liveStream, resetMedia } from '../test/streamFakes';
import type { StreamInvoke } from '../live/streamRuntime';
import { liteWrapper } from '../test/lite';

vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), api: { get: vi.fn() } }));
vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: {} });
  vi.mocked(getWeather).mockResolvedValue({ current: { temperature_2m: 16, weather_code: 0 } });
});
afterEach(() => { vi.useRealTimers(); });

const settled = () => act(async () => { await Promise.resolve(); });

describe('weather in lite mode', () => {
  function Venue({ children }: { children: React.ReactNode }) {
    const { setCurrent, setVenue } = useCurrentCompetition();
    useEffect(() => { setCurrent({ id: 1, name: 'Spring' }); setVenue({ competitionId: 1, lat: 54, lon: -2 }); }, [setCurrent, setVenue]);
    return <>{children}</>;
  }

  it('draws nothing and asks for nothing', async () => {
    const Lite = liteWrapper('on');
    const { container } = render(
      <Lite><CurrentCompetitionProvider><Venue>
        <WeatherBadge />
        <WeatherNow lat={54} lon={-2} />
        <WeatherAt lat={54} lon={-2} when="2026-10-24T09:00:00Z" />
      </Venue></CurrentCompetitionProvider></Lite>,
    );
    await settled();
    expect(container).toBeEmptyDOMElement();
    expect(getWeather).not.toHaveBeenCalled();
  });

  it('still loads in normal mode', async () => {
    const Normal = liteWrapper('off');
    render(
      <Normal>
        <WeatherNow lat={54} lon={-2} />
        <WeatherAt lat={54} lon={-2} when="2026-10-24T09:00:00Z" />
      </Normal>,
    );
    await settled();
    expect(getWeather).toHaveBeenCalledTimes(2);
  });
});

describe('live video in lite mode', () => {
  const props = () => ({
    competitionId: 1, streams: [liveStream({ caption: 'The final' })], sessions: [session(1)], ready: 1, messages: [], canBroadcast: false, fallback: null, competitionName: 'Spring Games',
    invoke: vi.fn(async (method: string) => method === 'WatchStream' ? { watchId: 'w', generation: 1, sdpOffer: 'offer', iceServers: [] } : undefined) as StreamInvoke,
  });
  beforeEach(() => {
    vi.useFakeTimers(); resetMedia();
    vi.stubGlobal('RTCPeerConnection', fakePeerConstructor);
    vi.stubGlobal('MediaStream', fakeStreamConstructor);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  });

  it('shows a Tap to watch card and does not connect until it is tapped', async () => {
    const p = props();
    const Lite = liteWrapper('on');
    const { unmount } = render(<MemoryRouter><Lite><LiveVideo {...p} publicLayout /></Lite></MemoryRouter>);
    await act(flush);
    expect(screen.getByRole('button', { name: /Tap to watch/ })).toHaveTextContent('Main Arena · Main camera');
    expect(screen.getByText(/only starts when you tap/)).toBeVisible();
    expect(document.querySelector('video')).toBeNull();
    expect(p.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Tap to watch/ }));
    await act(flush);
    expect(document.querySelector('video')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Tap to watch/ })).toBeNull();
    expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 1);
    unmount();
  });

  it('starts straight away in normal mode', async () => {
    const p = props();
    const Normal = liteWrapper('off');
    const { unmount } = render(<MemoryRouter><Normal><LiveVideo {...p} /></Normal></MemoryRouter>);
    await act(flush);
    expect(screen.queryByRole('button', { name: /Tap to watch/ })).toBeNull();
    expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 1);
    unmount();
  });

  it('keeps the next camera angle going after one tap', async () => {
    const p = props();
    const streams = [liveStream(), liveStream({ id: 2, angleName: 'Finish line' })];
    const Lite = liteWrapper('on');
    const { unmount } = render(<MemoryRouter><Lite><LiveVideo {...p} streams={streams} /></Lite></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Tap to watch/ }));
    await act(flush);
    fireEvent.click(screen.getByRole('button', { name: 'Finish line' }));
    await act(flush);
    expect(screen.queryByRole('button', { name: /Tap to watch/ })).toBeNull();
    expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 2);
    unmount();
  });
});

describe('navigation drawer and settings page', () => {
  function drawer(setting: 'on' | 'off' | undefined) {
    const Lite = liteWrapper(setting);
    return render(
      <MemoryRouter>
        <Lite><AuthProvider><ThemeProvider><CurrentCompetitionProvider><NavExtrasProvider><AgeGroupsProvider><CompetitionMetaProvider>
          <NavigationDrawer onClose={vi.fn()} />
        </CompetitionMetaProvider></AgeGroupsProvider></NavExtrasProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider></Lite>
      </MemoryRouter>,
    );
  }

  function settingsPage(setting: 'on' | 'off' | undefined) {
    const Lite = liteWrapper(setting);
    return render(
      <MemoryRouter initialEntries={['/settings#lite-mode']}>
        <Lite><AuthProvider><ThemeProvider><CurrentCompetitionProvider><CompactPageBarProvider>
          <SettingsPage />
        </CompactPageBarProvider></CurrentCompetitionProvider></ThemeProvider></AuthProvider></Lite>
      </MemoryRouter>,
    );
  }

  it('links to Settings from the drawer and keeps the Lite mode control on the Settings page', async () => {
    const { unmount } = drawer(undefined);
    expect(screen.queryByRole('group', { name: 'Lite mode' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    unmount();

    settingsPage(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(screen.getByRole('status')).toHaveTextContent('On because you chose it');
    expect(localStorage.getItem('mg.liteMode')).toBe('on');
  });

  it('shows the Lite mode section on the Settings page for the header chip anchor', () => {
    settingsPage(undefined);
    expect(screen.getByRole('group', { name: 'Lite mode' })).toBeInTheDocument();
  });

  it('hides the weather row in lite mode even when weather is switched on', async () => {
    localStorage.setItem('mg.showWeather', '1');
    const { unmount } = drawer('off');
    expect(screen.getAllByText('Weather')).not.toHaveLength(0);
    unmount();
    drawer('on');
    await settled();
    expect(screen.queryAllByText('Weather')).toHaveLength(0);
  });
});
