import { describe, expect, it } from 'vitest';
import { crewGroups, diffRaceEquipment, equipmentFromDiagram } from './raceEquipment';

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

describe('crewGroups', () => {
  const lane = (poles: number, items: object[] = []) => JSON.stringify([
    ...Array.from({ length: poles }, (_, i) => ({ t: 'pole', x: 20 + i * 15 })),
    ...items,
  ]);
  const mugs = (n: number, x = 30) => Array.from({ length: n }, () => ({ t: 'item', kind: 'mug', x }));
  const groups = (prev: string, next: string) => crewGroups(diffRaceEquipment(prev, next));

  it('says what goes out and what comes in, in plain sentences', () => {
    expect(groups(lane(5, mugs(3)), lane(5, mugs(1)))).toEqual([{ place: 'middle', lines: ['Take out 2 × Mug.'] }]);
    expect(groups(lane(5), lane(5, mugs(2)))).toEqual([{ place: 'middle', lines: ['Bring in 2 × Mug.'] }]);
  });

  it('puts the poles first, in the middle', () => {
    expect(groups(lane(5), lane(4))[0]).toEqual({ place: 'middle', lines: ['Take out the 5th pole.'] });
    expect(groups(lane(4), lane(5))[0].lines[0]).toBe('Put in the 5th pole.');
    expect(groups(lane(5), lane(0))[0].lines[0]).toBe('Take out the bending poles.');
    expect(groups(lane(0), lane(4))[0].lines[0]).toBe('Put in 4 poles.');
    expect(groups(lane(0), lane(5))[0].lines[0]).toBe('Put in 5 poles.');
    expect(groups(lane(5, mugs(1)), lane(4, mugs(2)))[0].lines).toEqual(['Take out the 5th pole.', 'Bring in Mug.']);
  });

  it('splits what changes by where it sits: top, then middle, then start line, leaving out places with nothing to do', () => {
    const next = lane(5, [...mugs(1, 95), ...mugs(1, 5), { t: 'item', kind: 'ball', x: 40 }]);
    const found = groups(lane(5, mugs(2, 95)), next);
    expect(found.map((g) => g.place)).toEqual(['top', 'middle', 'start']);
    expect(found[0].lines).toEqual(['Take out Mug.']);
    expect(found[1].lines).toEqual(['Bring in Ball.']);
    expect(found[2].lines).toEqual(['Bring in Mug.']);
    expect(groups(lane(5, mugs(1, 5)), lane(5, mugs(2, 5))).map((g) => g.place)).toEqual(['start']);
  });

  it('has nothing to say when the lane stays as it is', () => {
    expect(groups(lane(5), lane(5))).toEqual([]);
  });
});
