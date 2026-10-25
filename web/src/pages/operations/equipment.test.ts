import { describe, expect, it } from 'vitest';
import { equipmentLines } from './equipment';
import type { EquipmentChecklistItem } from './types';

const item = (key: string, kind: string, bucket: string, count: number): EquipmentChecklistItem => ({ key, kind, bucket, count, acknowledged: false, acknowledgedAt: null });

describe('equipmentLines', () => {
  it('adds the same kit up across the arena and sorts by name', () => {
    const lines = equipmentLines([item('a', 'Pole', 'Lane', 24), item('b', 'Mug', 'Top', 24), item('c', 'Pole', 'Start', 6)]);
    expect(lines.map((l) => l.label)).toEqual(['24 × Mug', '30 × Pole']);
    expect(lines[1].keys).toEqual(['a', 'c']);
  });

  it('counts stepping stones as sets of six', () => {
    const [line] = equipmentLines([item('s', 'Stepping stone', 'Lane', 36)]);
    expect(line.label).toBe('6 × Stepping stone set');
    expect(line.big).toBe(true);
  });

  it('puts bins, boxes, stations and poles in the big group and the rest in the little one', () => {
    const lines = equipmentLines(['Bin', 'Box', 'In / station', 'Pole', 'Baton', 'Flag'].map((kind) => item(kind, kind, 'Lane', 6)));
    expect(lines.filter((l) => l.big).map((l) => l.name)).toEqual(['Bin', 'Box', 'In / station', 'Pole']);
    expect(lines.filter((l) => !l.big).map((l) => l.name)).toEqual(['Baton', 'Flag']);
  });

  it('rounds a part set up to a whole one', () => {
    expect(equipmentLines([item('s', 'Stepping stone', 'Lane', 7)])[0].label).toBe('2 × Stepping stone set');
  });
});
