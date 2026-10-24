import { describe, expect, it } from 'vitest';
import { diffRaceEquipment, equipmentFromDiagram } from './raceEquipment';

describe('equipmentFromDiagram', () => {
  it('counts equipment by name, including things stacked on other things at arbitrary depth', () => {
    const json = JSON.stringify([
      { t: 'lane', poles: 5 },
      { t: 'pole', x: 20, label: '1', on: [{ t: 'item', kind: 'mug' }] },
      { t: 'pole', x: 40, label: 'P2', on: [{ t: 'item', kind: 'mug', on: [{ t: 'item', kind: 'ball', label: 'Tennis ball' }] }] },
      { t: 'pole', x: 60, label: 'Pole 3' },
      { t: 'cone', kind: 'flag', x: 60, label: 'Cone 1' },
      { t: 'item', kind: 'bucket', label: ' Red bucket ', x: 90 },
      { t: 'table', x: 95 },
      { t: 'midline' },
    ]);
    expect(equipmentFromDiagram(json)).toEqual([
      { label: 'Pole', count: 3 },
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

describe('diffRaceEquipment', () => {
  const fourPoleMug = JSON.stringify([
    { t: 'lane', poles: 4 },
    { t: 'item', kind: 'mug', anchor: 'start', x: 0 },
    { t: 'pole', anchor: 'pole1', x: 17 },
    { t: 'pole', anchor: 'pole2', x: 39, on: [{ t: 'item', kind: 'mug' }] },
    { t: 'pole', anchor: 'pole3', x: 61 },
    { t: 'pole', anchor: 'pole4', x: 83, on: [{ t: 'item', kind: 'mug' }] },
  ]);

  const fivePoleMug = JSON.stringify([
    { t: 'lane', poles: 5 },
    { t: 'item', kind: 'mug', anchor: 'start', x: 0 },
    { t: 'pole', anchor: 'pole1', x: 17 },
    { t: 'pole', anchor: 'pole2', x: 39 },
    { t: 'pole', anchor: 'pole3', x: 61 },
    { t: 'pole', anchor: 'pole4', x: 83 },
    { t: 'pole', anchor: 'pole5', x: 91 },
    { t: 'in', anchor: 'beyond', x: 96, on: [{ t: 'item', kind: 'mug' }, { t: 'item', kind: 'mug' }] },
  ]);

  const coneRace = JSON.stringify([
    { t: 'lane', poles: 4 },
    { t: 'item', kind: 'flag', x: 5 },
    { t: 'cone', kind: 'flag', x: 50, on: [{ t: 'item', kind: 'flag' }] },
    { t: 'cone', kind: 'flag', x: 96 },
    { t: 'midline' },
  ]);

  it('reports keep-4 when moving between two 4-pole races', () => {
    const twoMug = JSON.stringify([
      { t: 'pole', anchor: 'pole1', x: 17, on: [{ t: 'item', kind: 'mug' }] },
      { t: 'pole', anchor: 'pole2', x: 39 },
      { t: 'pole', anchor: 'pole3', x: 61, on: [{ t: 'item', kind: 'mug' }] },
      { t: 'pole', anchor: 'pole4', x: 83 },
    ]);
    const diff = diffRaceEquipment(fourPoleMug, twoMug);
    expect(diff.poleAction).toBe('keep-4');
    expect(diff.poleLabel).toBe('4 poles stay out');
    expect(diff.removeItems).toEqual([{ label: 'Mug', count: 1, zone: 'Start / Changeover' }]);
    expect(diff.addItems).toEqual([]);
  });

  it('reports add-5th and remove-5th when switching between 4-pole and 5-pole races', () => {
    const toFive = diffRaceEquipment(fourPoleMug, fivePoleMug);
    expect(toFive.poleAction).toBe('add-5th');
    expect(toFive.poleLabel).toContain('Bring in 5th pole (P5)');
    expect(toFive.removeItems).toEqual([{ label: 'Mug', count: 2, zone: 'Poles P1–P5' }]);
    expect(toFive.addItems).toEqual([
      { label: 'In / station', count: 1, zone: '2m Beyond / Top' },
      { label: 'Mug', count: 2, zone: '2m Beyond / Top' },
    ]);

    const toFour = diffRaceEquipment(fivePoleMug, fourPoleMug);
    expect(toFour.poleAction).toBe('remove-5th');
    expect(toFour.poleLabel).toContain('Remove 5th pole (P5)');
  });

  it('reports keep-5, set-4, set-5, clear-poles and no-poles accurately', () => {
    expect(diffRaceEquipment(fivePoleMug, fivePoleMug).poleAction).toBe('keep-5');
    expect(diffRaceEquipment(null, fourPoleMug).poleAction).toBe('set-4');
    expect(diffRaceEquipment(null, fivePoleMug).poleAction).toBe('set-5');
    expect(diffRaceEquipment(fourPoleMug, coneRace).poleAction).toBe('clear-poles');
    expect(diffRaceEquipment(coneRace, null).poleAction).toBe('no-poles');
  });
});
