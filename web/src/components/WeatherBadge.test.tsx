import { act, render, screen } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrentCompetitionProvider, useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { getWeather } from '../weather/weather';
import { WEATHER_REFRESH_MS } from '../weather/requestCache';
import { WeatherBadge } from './WeatherBadge';

vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));
const weather = vi.mocked(getWeather);

const icon = (container: HTMLElement) => /lucide-([a-z-]+)/.exec(container.querySelector('svg')?.getAttribute('class') ?? '')?.[1];
const settled = () => act(async () => { await Promise.resolve(); });
const now = (temperature_2m?: number, weather_code?: number) => ({ current: { temperature_2m, weather_code } });

function WithVenue({ children, venue }: { children: ReactNode; venue?: { lat: number; lon: number } }) {
  return <CurrentCompetitionProvider><SetVenue venue={venue} />{children}</CurrentCompetitionProvider>;
}
function SetVenue({ venue }: { venue?: { lat: number; lon: number } }) {
  const { setCurrent, setVenue } = useCurrentCompetition();
  useEffect(() => {
    if (!venue) return;
    setCurrent({ id: 1, name: 'Spring' });
    setVenue({ competitionId: 1, ...venue });
  }, [venue, setCurrent, setVenue]);
  return null;
}

beforeEach(() => {
  weather.mockResolvedValue(now(18.4, 0));
});
afterEach(() => { vi.useRealTimers(); });

describe('WeatherBadge', () => {
  it('shows a dash and asks for nothing without a venue', () => {
    render(<WithVenue><WeatherBadge /></WithVenue>);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByTitle('Venue weather unavailable')).toBeInTheDocument();
    expect(weather).not.toHaveBeenCalled();
  });

  it('shows the temperature at the coordinates it is given', async () => {
    const { container } = render(<WithVenue><WeatherBadge lat={51.5} lon={-1.2} /></WithVenue>);
    await settled();
    expect(weather).toHaveBeenCalledWith('/weather/current', { lat: 51.5, lon: -1.2 });
    expect(screen.getByText('18°C')).toBeInTheDocument();
    expect(screen.getByTitle('Venue weather · updated every 30 minutes')).toBeInTheDocument();
    expect(icon(container)).toBe('sun');
  });

  it('uses the open competition’s venue when none is given', async () => {
    render(<WithVenue venue={{ lat: 52, lon: 0.5 }}><WeatherBadge /></WithVenue>);
    await settled();
    expect(weather).toHaveBeenCalledWith('/weather/current', { lat: 52, lon: 0.5 });
  });

  it('prefers the coordinates it is given over the venue', async () => {
    render(<WithVenue venue={{ lat: 52, lon: 0.5 }}><WeatherBadge lat={1} lon={2} /></WithVenue>);
    await settled();
    expect(weather).toHaveBeenCalledWith('/weather/current', { lat: 1, lon: 2 });
    expect(weather).not.toHaveBeenCalledWith('/weather/current', { lat: 52, lon: 0.5 });
  });

  it('shows a cloud icon and a dash when the response has no reading', async () => {
    weather.mockResolvedValue({});
    const { container } = render(<WithVenue><WeatherBadge lat={1} lon={2} /></WithVenue>);
    await settled();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(icon(container)).toBe('cloud');
  });

  it.each([
    [1, 'cloud'], [3, 'cloud'], [45, 'cloud-fog'], [63, 'cloud-rain'], [73, 'cloud-snow'], [95, 'cloud-lightning'], [120, 'cloud'],
  ])('picks the icon for weather code %i', async (code, expected) => {
    weather.mockResolvedValue(now(10, code));
    const { container } = render(<WithVenue><WeatherBadge lat={1} lon={2} /></WithVenue>);
    await settled();
    expect(icon(container)).toBe(expected);
  });

  it('falls back to a dash when the weather is unavailable', async () => {
    weather.mockRejectedValue(new Error('Weather is unavailable'));
    render(<WithVenue><WeatherBadge lat={1} lon={2} /></WithVenue>);
    await settled();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('refreshes every thirty minutes, when the phone comes online and when the page is shown again', async () => {
    vi.useFakeTimers();
    render(<WithVenue><WeatherBadge lat={1} lon={2} /></WithVenue>);
    expect(weather).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS); });
    expect(weather).toHaveBeenCalledTimes(2);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(weather).toHaveBeenCalledTimes(3);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(weather).toHaveBeenCalledTimes(4);
  });

  it('does not refresh while offline or hidden', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<WithVenue><WeatherBadge lat={1} lon={2} /></WithVenue>);
    expect(weather).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(weather).not.toHaveBeenCalled();
  });

  it('stops refreshing and ignores late answers after it has gone', async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof now>) => void;
    weather.mockReturnValue(new Promise((resolve) => { finish = resolve as typeof finish; }));
    const { unmount } = render(<WithVenue><WeatherBadge lat={1} lon={2} /></WithVenue>);
    unmount();
    await act(async () => { finish(now(1, 1)); await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS * 2); });
    expect(weather).toHaveBeenCalledTimes(1);

    weather.mockReset();
    let fail!: (reason: Error) => void;
    weather.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    render(<WithVenue><WeatherBadge lat={3} lon={4} /></WithVenue>).unmount();
    await act(async () => { fail(new Error('late')); });
  });

  it('clears the old reading while a new venue loads', async () => {
    const { rerender } = render(<WithVenue><WeatherBadge lat={1} lon={2} /></WithVenue>);
    await settled();
    expect(screen.getByText('18°C')).toBeInTheDocument();
    weather.mockReturnValue(new Promise(() => {}));
    rerender(<WithVenue><WeatherBadge lat={3} lon={4} /></WithVenue>);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
