import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWeather } from '../weather/weather';
import { WEATHER_REFRESH_MS } from '../weather/requestCache';
import { WeatherAt, WeatherNow } from './WeatherChips';

vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));
const weather = vi.mocked(getWeather);

const icon = (container: HTMLElement) => /lucide-([a-z-]+)/.exec(container.querySelector('svg')?.getAttribute('class') ?? '')?.[1];
const settled = () => act(async () => { await Promise.resolve(); });

afterEach(() => { vi.useRealTimers(); });

describe('WeatherAt', () => {
  beforeEach(() => { weather.mockResolvedValue({ temperature_2m: 17.5, weather_code: 0, is_day: 1 }); });

  it.each([
    ['no latitude', { lat: null, lon: 1, when: '2026-06-01T10:00:00Z' }],
    ['no longitude', { lat: 1, lon: undefined, when: '2026-06-01T10:00:00Z' }],
    ['no time', { lat: 1, lon: 1, when: null }],
    ['an unreadable time', { lat: 1, lon: 1, when: 'soon' }],
  ])('shows nothing with %s', (_label, props) => {
    const { container } = render(<WeatherAt {...props} />);
    expect(container).toBeEmptyDOMElement();
    expect(weather).not.toHaveBeenCalled();
  });

  it('asks for the forecast at the start of the hour', async () => {
    render(<WeatherAt lat={51.5} lon={-1.2} when="2026-06-01T10:45:00Z" />);
    await settled();
    expect(weather).toHaveBeenCalledWith('/weather/at', { lat: 51.5, lon: -1.2, when: '2026-06-01T10:00:00.000Z' });
  });

  it('shows the temperature once it arrives, with the time in the tooltip', async () => {
    const { container } = render(<WeatherAt lat={1} lon={2} when={new Date('2026-06-01T10:45:00Z')} className="mine" />);
    expect(container.firstElementChild).toHaveClass('mine');
    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
    await settled();
    expect(screen.getByText('18°')).toBeInTheDocument();
    expect(container.firstElementChild!.getAttribute('title')).toBe(`Forecast for ${new Date('2026-06-01T10:00:00.000Z').toLocaleString('en-GB')}`);
  });

  it('uses the fallback forecast when there is no live one', async () => {
    weather.mockResolvedValue({ fallback: { temperature_2m: 9, weather_code: 63, is_day: 1 } });
    const { container } = render(<WeatherAt lat={1} lon={2} when="2026-06-01T10:00:00Z" />);
    await settled();
    expect(screen.getByText('9°')).toBeInTheDocument();
    expect(icon(container)).toBe('cloud-rain');
  });

  it.each([
    [undefined, undefined, 'cloud'], [0, 1, 'sun'], [1, 1, 'sun'], [0, 0, 'moon'], [1, 0, 'moon'], [0, undefined, 'sun'],
    [2, 0, 'cloud'], [3, 1, 'cloud'], [48, 1, 'cloud-fog'], [55, 1, 'cloud-rain'], [75, 1, 'cloud-snow'], [96, 1, 'cloud-lightning'], [150, 1, 'cloud'],
  ])('picks the icon for code %s, is_day %s', async (code, isDay, expected) => {
    weather.mockResolvedValue({ weather_code: code, is_day: isDay });
    const { container } = render(<WeatherAt lat={1} lon={2} when="2026-06-01T10:00:00Z" />);
    await settled();
    expect(icon(container)).toBe(expected);
  });

  it('shows just the icon when the forecast has no temperature, and after a failure', async () => {
    weather.mockRejectedValue(new Error('Weather is unavailable'));
    const { container } = render(<WeatherAt lat={1} lon={2} when="2026-06-01T10:00:00Z" />);
    await settled();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
  });

  it('clears the old temperature and asks again when the time changes', async () => {
    const { rerender } = render(<WeatherAt lat={1} lon={2} when="2026-06-01T10:00:00Z" />);
    await settled();
    expect(screen.getByText('18°')).toBeInTheDocument();
    weather.mockReturnValue(new Promise(() => {}));
    rerender(<WeatherAt lat={1} lon={2} when="2026-06-01T14:00:00Z" />);
    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
  });

  it('ignores answers that arrive after it has gone', async () => {
    let finish!: (value: object) => void;
    weather.mockReturnValue(new Promise((resolve) => { finish = resolve as typeof finish; }));
    render(<WeatherAt lat={1} lon={2} when="2026-06-01T10:00:00Z" />).unmount();
    await act(async () => { finish({ temperature_2m: 5 }); });
    let fail!: (reason: Error) => void;
    weather.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    render(<WeatherAt lat={1} lon={2} when="2026-06-01T11:00:00Z" />).unmount();
    await act(async () => { fail(new Error('late')); });
  });
});

describe('WeatherNow', () => {
  const reading = { temperature_2m: 12.4, weather_code: 3, wind_speed_10m: 19.6, is_day: 1 };
  beforeEach(() => { weather.mockResolvedValue({ current: reading }); });

  it.each([
    ['no latitude', { lat: null, lon: 1 }],
    ['no longitude', { lat: 1, lon: undefined }],
  ])('shows nothing with %s', (_label, props) => {
    const { container } = render(<WeatherNow {...props} />);
    expect(container).toBeEmptyDOMElement();
    expect(weather).not.toHaveBeenCalled();
  });

  it('shows the temperature and wind speed', async () => {
    const { container } = render(<WeatherNow lat={51.5} lon={-1.2} className="mine" />);
    expect(weather).toHaveBeenCalledWith('/weather/current', { lat: 51.5, lon: -1.2 });
    await settled();
    expect(screen.getByText('12°')).toBeInTheDocument();
    expect(screen.getByText('20 km/h')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('mine');
    expect(container.firstElementChild).toHaveAttribute('title', 'Current weather at the venue');
    expect(icon(container)).toBe('cloud');
  });

  it('uses the fallback reading when there is no current one', async () => {
    weather.mockResolvedValue({ fallback: { temperature_2m: 3, weather_code: 73, is_day: 0 } });
    const { container } = render(<WeatherNow lat={1} lon={2} />);
    await settled();
    expect(screen.getByText('3°')).toBeInTheDocument();
    expect(screen.queryByText(/km\/h/)).not.toBeInTheDocument();
    expect(icon(container)).toBe('cloud-snow');
  });

  it('shows only an icon when there is no reading or the weather is unavailable', async () => {
    weather.mockResolvedValue({});
    const first = render(<WeatherNow lat={1} lon={2} />);
    await settled();
    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
    expect(icon(first.container)).toBe('cloud');
    first.unmount();

    weather.mockRejectedValue(new Error('Weather is unavailable'));
    render(<WeatherNow lat={1} lon={2} />);
    await settled();
    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
  });

  it('refreshes every thirty minutes', async () => {
    vi.useFakeTimers();
    render(<WeatherNow lat={1} lon={2} />);
    expect(weather).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS); });
    expect(weather).toHaveBeenCalledTimes(2);
  });

  it('does not ask while offline or with the page hidden', async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<WeatherNow lat={1} lon={2} />);
    online.mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS); });
    expect(weather).not.toHaveBeenCalled();
  });

  it('stops refreshing and ignores late answers once removed', async () => {
    vi.useFakeTimers();
    let finish!: (value: object) => void;
    weather.mockReturnValue(new Promise((resolve) => { finish = resolve as typeof finish; }));
    render(<WeatherNow lat={1} lon={2} />).unmount();
    await act(async () => { finish({ current: reading }); await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS * 2); });
    expect(weather).toHaveBeenCalledTimes(1);
    let fail!: (reason: Error) => void;
    weather.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    render(<WeatherNow lat={3} lon={4} />).unmount();
    await act(async () => { fail(new Error('late')); });
  });

  it('clears the old reading when the venue changes', async () => {
    const { rerender } = render(<WeatherNow lat={1} lon={2} />);
    await settled();
    expect(screen.getByText('12°')).toBeInTheDocument();
    weather.mockReturnValue(new Promise(() => {}));
    rerender(<WeatherNow lat={3} lon={4} />);
    expect(screen.queryByText('12°')).not.toBeInTheDocument();
  });
});
