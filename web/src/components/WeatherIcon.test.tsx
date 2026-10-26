import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { weatherKind } from '../lib/weatherKind';
import { WeatherIcon } from './WeatherIcon';

describe('weatherKind', () => {
  it.each([
    [undefined, true, 'cloud'], [3, true, 'cloud'],
    [0, true, 'sun'], [1, true, 'sun'], [0, false, 'moon'],
    [2, true, 'part'], [45, true, 'fog'],
    [53, true, 'rain'], [65, true, 'rain'], [80, true, 'rain'],
    [71, true, 'snow'], [85, true, 'snow'],
    [95, true, 'storm'],
  ])('maps code %s (day %s) to %s', (code, isDay, kind) => {
    expect(weatherKind(code, isDay)).toBe(kind);
  });
});

describe('WeatherIcon', () => {
  it.each(['sun', 'moon', 'part', 'cloud', 'fog', 'rain', 'snow', 'storm'] as const)('draws a decorative %s picture', (kind) => {
    const code = { sun: 0, moon: 0, part: 2, cloud: 3, fog: 45, rain: 61, snow: 73, storm: 95 }[kind];
    const { container } = render(<WeatherIcon code={code} isDay={kind !== 'moon'} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-kind', kind);
  });
});
