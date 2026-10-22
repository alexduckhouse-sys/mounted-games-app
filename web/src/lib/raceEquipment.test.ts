import { describe, expect, it } from 'vitest';
import { equipmentFromDiagram } from './raceEquipment';

describe('equipmentFromDiagram', () => {
  it('counts equipment by name, including things stacked on other things', () => {
    const json = JSON.stringify([
      { t: 'pole', x: 20, on: [{ t: 'item', kind: 'mug' }] },
      { t: 'pole', x: 40, on: [{ t: 'item', kind: 'mug', on: [{ t: 'item', kind: 'ball', label: 'Tennis ball' }] }] },
      { t: 'cone', kind: 'flag', x: 60 },
      { t: 'item', kind: 'bucket', label: ' Red bucket ', x: 90 },
      { t: 'table', x: 95 },
      { t: 'midline' },
    ]);
    expect(equipmentFromDiagram(json)).toEqual([
      { label: 'Pole', count: 2 },
      { label: 'Mug', count: 2 },
      { label: 'Tennis ball', count: 1 },
      { label: 'Flag cone', count: 1 },
      { label: 'Red bucket', count: 1 },
      { label: 'In / station', count: 1 },
    ]);
  });

  it('falls back to a generic name for unknown kinds and ignores bad data', () => {
    expect(equipmentFromDiagram(JSON.stringify([{ t: 'item', kind: 'unicorn' }, { t: 'wibble' }, null, 4]))).toEqual([{ label: 'Item', count: 1 }]);
    expect(equipmentFromDiagram('not json')).toEqual([]);
    expect(equipmentFromDiagram('{"t":"pole"}')).toEqual([]);
    expect(equipmentFromDiagram(null)).toEqual([]);
    expect(equipmentFromDiagram(undefined)).toEqual([]);
    expect(equipmentFromDiagram('')).toEqual([]);
  });
});
