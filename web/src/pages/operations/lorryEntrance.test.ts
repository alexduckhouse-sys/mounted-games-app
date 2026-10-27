import { describe, expect, it } from 'vitest';
import { horseboxEntrance, isValidWhat3Words, parseCoordinates } from './lorryEntrance';

describe('isValidWhat3Words', () => {
  it('accepts three words with or without the slashes', () => {
    expect(isValidWhat3Words('filled.count.soap')).toBe(true);
    expect(isValidWhat3Words('///filled.count.soap')).toBe(true);
    expect(isValidWhat3Words(' ///café.crème.été ')).toBe(true);
  });
  it('refuses anything else', () => {
    for (const bad of ['', null, undefined, 'one.two', 'one.two.three.four', 'a b c', 'one..three', '1.2.3']) expect(isValidWhat3Words(bad)).toBe(false);
  });
});

describe('parseCoordinates', () => {
  it('reads a pair', () => {
    expect(parseCoordinates('52.1234, -1.5678')).toEqual({ lat: 52.1234, lon: -1.5678 });
    expect(parseCoordinates('52 -1')).toEqual({ lat: 52, lon: -1 });
  });
  it('refuses a pair that is not a place', () => {
    for (const bad of ['', 'north', '91, 0', '0, 181', '52.1']) expect(parseCoordinates(bad)).toBeNull();
  });
});

describe('horseboxEntrance', () => {
  it('is null when nothing is set', () => {
    expect(horseboxEntrance({})).toBeNull();
    expect(horseboxEntrance({ lorryWhat3Words: ' ', lorryDirectionsNote: '' })).toBeNull();
  });
  it('gives every map link when there is a pin', () => {
    const e = horseboxEntrance({ lorryWhat3Words: 'filled.count.soap', lorryLatitude: 52.1, lorryLongitude: -1.5, lorryDirectionsNote: 'Second gate' })!;
    expect(e.googleMapsUrl).toContain('52.1,-1.5');
    expect(e.appleMapsUrl).toContain('ll=52.1,-1.5');
    expect(e.wazeUrl).toBe('https://waze.com/ul?ll=52.1,-1.5&navigate=yes');
    expect(e.what3WordsUrl).toBe('https://what3words.com/filled.count.soap');
    expect(e.directionsNote).toBe('Second gate');
  });
  it('has no map links without a pin', () => {
    const e = horseboxEntrance({ lorryDirectionsNote: 'Follow the signs' })!;
    expect(e.wazeUrl).toBeNull();
    expect(e.googleMapsUrl).toBeNull();
  });
});
