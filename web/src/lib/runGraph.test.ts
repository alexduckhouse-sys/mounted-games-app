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

describe('shortLabel', () => {
  it('leaves a short label and cuts a long one with an ellipsis', () => {
    expect(shortLabel('Heat 2')).toBe('Heat 2');
    expect(shortLabel('  A Final  ')).toBe('A Final');
    expect(shortLabel('Quarter Final Two')).toBe('Quarter…');
    expect(shortLabel('Quarter Final Two', 20)).toBe('Quarter Final Two');
  });
});
