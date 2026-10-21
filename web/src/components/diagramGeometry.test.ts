import { describe, expect, it } from 'vitest';
import type { DiagramElement } from '../types';
import { CENTRE_Y, LANE, clampPct, pctToPx, pxToPct, resolveX } from './diagramGeometry';

describe('lane geometry', () => {
  it('maps 0% to the start line and 100% to the top line', () => {
    expect(pctToPx(0)).toBe(LANE.left);
    expect(pctToPx(100)).toBe(LANE.topLineX);
  });

  it('extrapolates past the top line and converts back again', () => {
    expect(pctToPx(120)).toBeGreaterThan(LANE.topLineX);
    expect(pxToPct(pctToPx(37))).toBeCloseTo(37);
  });

  it('clamps positions to the rendered range', () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(50)).toBe(50);
    expect(clampPct(500)).toBe(LANE.xMax);
  });

  it('centres on the middle of the lane', () => {
    expect(CENTRE_Y).toBe((LANE.top + LANE.bottom) / 2);
  });
});

describe('resolveX', () => {
  const poles: DiagramElement[] = [{ t: 'pole', x: 10 }, { t: 'pole', x: 40 }];

  it('uses the absolute position, clamped', () => {
    expect(resolveX({ x: 30 }, [])).toBe(30);
    expect(resolveX({ x: 999 }, [])).toBe(LANE.xMax);
  });

  it('defaults to the middle when nothing is set', () => {
    expect(resolveX({}, [])).toBe(50);
  });

  it('resolves named anchors with an optional offset', () => {
    expect(resolveX({ anchor: 'start' }, [])).toBe(0);
    expect(resolveX({ anchor: 'finish' }, [])).toBe(100);
    expect(resolveX({ anchor: 'top', offset: 10 }, [])).toBe(110);
    expect(resolveX({ anchor: 'midline' }, [])).toBe(50);
    expect(resolveX({ anchor: 'changeover', offset: -5 }, [])).toBe(80);
  });

  it('resolves poleN anchors against the poles in order', () => {
    expect(resolveX({ anchor: 'pole2', offset: 5 }, poles)).toBe(45);
    expect(resolveX({ anchor: 'POLE1' }, poles)).toBe(10);
  });

  it('falls back to the absolute position when the pole does not exist', () => {
    expect(resolveX({ anchor: 'pole9', x: 20 }, poles)).toBe(20);
    expect(resolveX({ anchor: 'unknown' }, poles)).toBe(50);
  });
});
