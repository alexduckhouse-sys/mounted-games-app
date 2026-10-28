import { describe, expect, it } from 'vitest';
import { colourToRgb, inkFor, laneFill, luminance } from './laneFill';

describe('laneFill', () => {
  it('reads hex colours and the light and dark shades teamColours makes', () => {
    expect(colourToRgb('#dc2626')).toEqual([220, 38, 38]);
    expect(colourToRgb('#fff')).toEqual([255, 255, 255]);
    expect(colourToRgb('color-mix(in srgb, #2563eb 65%, white)')).toEqual([Math.round(37 * 0.65 + 255 * 0.35), Math.round(99 * 0.65 + 255 * 0.35), Math.round(235 * 0.65 + 255 * 0.35)]);
    expect(colourToRgb('color-mix(in srgb, #ffffff 50%, black)')).toEqual([128, 128, 128]);
    expect(colourToRgb('not a colour')).toBeNull();
    expect(colourToRgb('color-mix(in srgb, nope 65%, white)')).toBeNull();
  });

  it('orders luminance from black to white', () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(luminance([10, 10, 10])).toBeLessThan(luminance([200, 200, 200]));
  });

  it('picks dark text on light colours and white text on dark ones', () => {
    expect(inkFor([250, 204, 21]).dark).toBe(true);
    expect(inkFor([248, 250, 252])).toEqual({ ink: '#111827', dark: true });
    expect(inkFor([30, 58, 138])).toEqual({ ink: '#FFFFFF', dark: false });
    expect(inkFor([31, 41, 55]).dark).toBe(false);
  });

  it('fills from the first colour a bib names, with readable text', () => {
    expect(laneFill('Yellow')).toMatchObject({ colour: '#facc15', ink: '#111827', dark: true });
    expect(laneFill('red')).toMatchObject({ colour: '#dc2626', ink: '#FFFFFF', dark: false });
    expect(laneFill('green/gold')?.colour).toBe('#16a34a');
    expect(laneFill('Light blue')?.colour).toMatch(/^color-mix/);
    expect(laneFill('Light blue')?.dark).toBe(true);
    expect(laneFill('White')?.ink).toBe('#111827');
    expect(laneFill('Black')?.ink).toBe('#FFFFFF');
  });

  it('gives nothing when there is no colour to read', () => {
    expect(laneFill(null)).toBeNull();
    expect(laneFill('')).toBeNull();
    expect(laneFill('Team spirit')).toBeNull();
  });
});
