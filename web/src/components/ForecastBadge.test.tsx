import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWeather } from '../weather/weather';
import { ForecastBadge } from './ForecastBadge';

vi.mock('../weather/weather', () => ({ getWeather: vi.fn() }));
const weather = vi.mocked(getWeather);

const icon = (container: HTMLElement) => /lucide-([a-z-]+)/.exec(container.querySelector('svg')?.getAttribute('class') ?? '')?.[1];
const settled = () => act(async () => { await Promise.resolve(); });
const daily = (extra: Record<string, number[]>) => ({ daily: { weather_code: [0], temperature_2m_max: [21.6], temperature_2m_min: [9.2], ...extra } });

beforeEach(() => { weather.mockResolvedValue(daily({})); });

describe('ForecastBadge', () => {
  it.each([
    ['no latitude', { lat: null, lon: 1, date: '2026-06-01' }],
    ['no longitude', { lat: 1, lon: undefined, date: '2026-06-01' }],
    ['no date', { lat: 1, lon: 1, date: null }],
    ['an empty date', { lat: 1, lon: 1, date: '' }],
  ])('shows nothing and asks for nothing with %s', (_label, props) => {
    const { container } = render(<ForecastBadge {...props} />);
    expect(container).toBeEmptyDOMElement();
    expect(weather).not.toHaveBeenCalled();
  });

  it('asks for the forecast for the venue on that day', () => {
    render(<ForecastBadge lat={51.5} lon={-1.2} date="2026-06-01T15:30:00Z" />);
    expect(weather).toHaveBeenCalledWith('/weather/forecast', { lat: 51.5, lon: -1.2, date: '2026-06-01' });
  });

  it('shows a dash until the forecast arrives, then rounded high and low', async () => {
    render(<ForecastBadge lat={1} lon={2} date="2026-06-01" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    await settled();
    expect(screen.getByText('22°')).toBeInTheDocument();
    expect(screen.getByText(/\/ 9°/)).toBeInTheDocument();
  });

  it('puts the date in the tooltip and accepts extra classes', () => {
    const { container } = render(<ForecastBadge lat={1} lon={2} date="2026-06-01" className="extra" />);
    const badge = container.firstElementChild!;
    expect(badge.getAttribute('title')).toBe(`Forecast for ${new Date('2026-06-01').toLocaleDateString()}`);
    expect(badge).toHaveClass('extra');
  });

  it('uses the fallback forecast when there is no daily one', async () => {
    weather.mockResolvedValue({ fallback: { weather_code: [61], temperature_2m_max: [14], temperature_2m_min: [8] } });
    const { container } = render(<ForecastBadge lat={1} lon={2} date="2026-06-01" />);
    await settled();
    expect(screen.getByText('14°')).toBeInTheDocument();
    expect(icon(container)).toBe('cloud-rain');
  });

  it.each([
    [undefined, 'cloud'], [0, 'sun'], [2, 'cloud'], [3, 'cloud'], [45, 'cloud-fog'], [49, 'cloud-fog'],
    [61, 'cloud-rain'], [69, 'cloud-rain'], [71, 'cloud-snow'], [79, 'cloud-snow'], [95, 'cloud-lightning'], [99, 'cloud-lightning'], [120, 'cloud'],
  ])('picks the icon for weather code %s', async (code, expected) => {
    weather.mockResolvedValue(daily({ weather_code: code === undefined ? [] : [code] }));
    const { container } = render(<ForecastBadge lat={1} lon={2} date="2026-06-01" />);
    await settled();
    expect(icon(container)).toBe(expected);
  });

  it('shows a dash when only one of the temperatures is known', async () => {
    weather.mockResolvedValue({ daily: { weather_code: [0], temperature_2m_max: [20] } });
    render(<ForecastBadge lat={1} lon={2} date="2026-06-01" />);
    await settled();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('goes back to a dash when the forecast is unavailable', async () => {
    weather.mockRejectedValue(new Error('Weather is unavailable'));
    render(<ForecastBadge lat={1} lon={2} date="2026-06-01" />);
    await settled();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('asks again and clears the old forecast when the day changes', async () => {
    const { rerender } = render(<ForecastBadge lat={1} lon={2} date="2026-06-01" />);
    await settled();
    expect(screen.getByText('22°')).toBeInTheDocument();
    let finish!: (value: ReturnType<typeof daily>) => void;
    weather.mockReturnValue(new Promise((resolve) => { finish = resolve as typeof finish; }));
    rerender(<ForecastBadge lat={1} lon={2} date="2026-06-02" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    await act(async () => { finish(daily({ temperature_2m_max: [10] })); });
    expect(screen.getByText('10°')).toBeInTheDocument();
  });

  it('ignores a forecast that arrives after the badge has gone', async () => {
    let finish!: (value: ReturnType<typeof daily>) => void;
    weather.mockReturnValue(new Promise((resolve) => { finish = resolve as typeof finish; }));
    const { unmount } = render(<ForecastBadge lat={1} lon={2} date="2026-06-01" />);
    unmount();
    await act(async () => { finish(daily({})); });
    let fail!: (reason: Error) => void;
    weather.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    const second = render(<ForecastBadge lat={1} lon={2} date="2026-06-03" />);
    second.unmount();
    await act(async () => { fail(new Error('late')); });
  });
});
