import { describe, expect, it } from 'vitest';
import { graphScale, layoutRunGraph, shortLabel } from './runGraph';

describe('graphScale', () => {
  it('tops out at a tidy number with up to four gaps between gridlines', () => {
    expect(graphScale(6)).toEqual({ max: 6, ticks: [0, 2, 4, 6] });
    expect(graphScale(8)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(graphScale(11)).toEqual({ max: 12, ticks: [0, 3, 6, 9, 12] });
    expect(graphScale(1)).toEqual({ max: 1, ticks: [0, 1] });
    expect(graphScale(40)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
  });
  it('still gives a 0 to 1 scale when nothing was scored or the value is not a number', () => {
    expect(graphScale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(graphScale(-3).max).toBe(1);
    expect(graphScale(Number.NaN).max).toBe(1);
  });
  it('uses the biggest step for a huge value', () => {
    expect(graphScale(20_000).max).toBe(20_000);
    expect(graphScale(20_000).ticks).toHaveLength(21);
  });
});

describe('layoutRunGraph', () => {
  it('draws a bar a run, taller for more points, standing on the bottom line', () => {
    const layout = layoutRunGraph([2, 6, 4], null);
    expect(layout.bars).toHaveLength(3);
    expect(layout.bars[1].height).toBeGreaterThan(layout.bars[0].height);
    expect(layout.bars[1].height).toBeGreaterThan(layout.bars[2].height);
    for (const bar of layout.bars) expect(bar.y + bar.height).toBeCloseTo(layout.bottom);
    expect(layout.bars[1].height).toBeCloseTo(layout.bottom - layout.top);
    expect(layout.width).toBeGreaterThan(layout.bars[2].x + layout.bars[2].width);
    expect(layout.averageY).toBeNull();
    expect(layout.tickYs).toHaveLength(layout.scale.ticks.length);
  });
  it('puts the average line at its own height, and makes room for it when it is the tallest thing', () => {
    const level = layoutRunGraph([2, 4], 3);
    expect(level.averageY).toBeCloseTo((level.bars[0].y + level.bars[1].y) / 2);
    expect(layoutRunGraph([0, 0], 5).scale.max).toBeGreaterThanOrEqual(5);
  });
  it('lays out an empty graph and a bar of nothing without breaking', () => {
    expect(layoutRunGraph([], null).bars).toEqual([]);
    const flat = layoutRunGraph([0], 0);
    expect(flat.bars[0].height).toBe(0);
    expect(flat.averageY).toBeCloseTo(flat.bottom);
  });
});

describe('layoutRunGraph fitting', () => {
  it('keeps the natural slots for a few runs and narrows them to fit for many', () => {
    expect(layoutRunGraph([1, 2, 3], null, 360).slot).toBe(52);
    const many = layoutRunGraph(Array.from({ length: 20 }, (_, index) => index), null, 360);
    expect(many.slot).toBeLessThan(20);
    expect(many.width).toBeLessThanOrEqual(360);
    expect(many.bars.every((bar) => bar.width >= 3 && bar.width < many.slot)).toBe(true);
    expect(layoutRunGraph([], null, 360).bars).toEqual([]);
  });
});

describe('layoutRunGraph size', () => {
  it('keeps the usual 150 plot and 40 foot when no size is given', () => {
    const usual = layoutRunGraph([2, 6], null);
    expect(usual.bottom - usual.top).toBe(150);
    expect(usual.height).toBe(usual.bottom + 40);
    expect(layoutRunGraph([2, 6], null, undefined, {})).toEqual(usual);
    expect(layoutRunGraph([2, 6], null, 360)).toEqual(layoutRunGraph([2, 6], null, 360, undefined));
  });
  it('draws a shorter plot and foot when asked, with the bars scaled to the shorter plot', () => {
    const compact = layoutRunGraph([2, 6], 4, undefined, { plot: 120, foot: 28 });
    expect(compact.bottom - compact.top).toBe(120);
    expect(compact.height).toBe(compact.bottom + 28);
    expect(compact.bars[1].height).toBeCloseTo(120);
    expect(compact.averageY).toBeCloseTo(compact.bottom - (4 / compact.scale.max) * 120);
    expect(compact.tickYs[compact.tickYs.length - 1]).toBeCloseTo(compact.top);
  });
  it('lets plot and foot be set one at a time', () => {
    const plotOnly = layoutRunGraph([3], null, undefined, { plot: 100 });
    expect(plotOnly.bottom - plotOnly.top).toBe(100);
    expect(plotOnly.height).toBe(plotOnly.bottom + 40);
    const footOnly = layoutRunGraph([3], null, undefined, { foot: 10 });
    expect(footOnly.bottom - footOnly.top).toBe(150);
    expect(footOnly.height).toBe(footOnly.bottom + 10);
  });
  it('fits and sizes together', () => {
    const many = layoutRunGraph(Array.from({ length: 20 }, (_, index) => index), null, 360, { plot: 120, foot: 28 });
    expect(many.width).toBeLessThanOrEqual(360);
    expect(many.height).toBe(many.bottom + 28);
  });
});

describe('shortLabel', () => {
  it('leaves a short label and cuts a long one with an ellipsis', () => {
    expect(shortLabel('Heat 2')).toBe('Heat 2');
    expect(shortLabel('  A Final  ')).toBe('A Final');
    expect(shortLabel('Quarter Final Two')).toBe('Quarter…');
    expect(shortLabel('Quarter Final Two', 20)).toBe('Quarter Final Two');
  });
});
