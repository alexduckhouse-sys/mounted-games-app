import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_TOOLS, type DiagramElement, type DiagramTool } from '../types';
import {
  addContent, allowedSlotKinds, buildSlots, clampPoleCount, contentsOf, contentsSummary, duplicateItem, fillPoles,
  fromLaneModel, inferPoleCount, isContainer, moveToSlot, nearestSlot, parseDiagram, patchItem, placeElements,
  placeTool, poleX, removeContent, removeItem, setPoleCount, slotById, stepSlot, toLaneModel, toolLabel, type LaneModel,
} from './diagramSlots';

const tool = (t: string, kind?: string): DiagramTool => DIAGRAM_TOOLS.find((d) => d.t === t && d.kind === kind)!;
const empty = (poleCount = 5): LaneModel => ({ poleCount, midline: false, items: [] });

describe('slot maths', () => {
  it('spaces five poles evenly between 17 and 83', () => {
    expect([1, 2, 3, 4, 5].map((i) => Math.round(poleX(i, 5)))).toEqual([17, 34, 50, 67, 83]);
    expect([1, 2, 3, 4].map((i) => Math.round(poleX(i, 4)))).toEqual([17, 39, 61, 83]);
  });

  it('clamps the pole count', () => {
    expect(clampPoleCount(1)).toBe(2);
    expect(clampPoleCount(99)).toBe(8);
    expect(clampPoleCount(NaN)).toBe(5);
    expect(clampPoleCount(4.4)).toBe(4);
  });

  it('builds start, gaps, poles, top and beyond in order', () => {
    const slots = buildSlots(5);
    expect(slots.map((s) => s.id)).toEqual([
      'start', 'gap0', 'pole1', 'gap1', 'pole2', 'gap2', 'pole3', 'gap3', 'pole4', 'gap4', 'pole5', 'gap5', 'top', 'beyond',
    ]);
    expect(slots.map((s) => s.x)).toEqual([...slots.map((s) => s.x)].sort((a, b) => a - b));
    expect(slotById(slots, 'gap0')!.description).toBe('Between the start line and pole 1');
    expect(slotById(slots, 'gap2')!.description).toBe('Between pole 2 and pole 3');
    expect(slotById(slots, 'gap5')!.description).toBe('Between pole 5 and the top line');
    expect(slotById(slots, 'gap5')!.label).toBe('5–Top');
    expect(slotById(slots, 'pole3')!.label).toBe('Pole 3');
    expect(slotById(slots, 'nope')).toBeUndefined();
    expect(slotById(slots, undefined)).toBeUndefined();
  });

  it('finds the nearest slot, optionally by kind', () => {
    const slots = buildSlots(5);
    expect(nearestSlot(slots, 1).id).toBe('start');
    expect(nearestSlot(slots, 51).id).toBe('pole3');
    expect(nearestSlot(slots, 99).id).toBe('top');
    expect(nearestSlot(slots, 25, ['pole']).kind).toBe('pole');
    expect(nearestSlot(slots, 27, ['pole']).id).toBe('pole2');
    expect(nearestSlot(slots, 5, ['pole']).id).toBe('pole1');
  });

  it('only lets poles stand on poles', () => {
    expect(allowedSlotKinds({ t: 'pole' })).toEqual(['pole']);
    expect(allowedSlotKinds({ t: 'cone' })).toBeUndefined();
  });
});

describe('old JSON mapping', () => {
  it('maps free x positions to the nearest slot', () => {
    const m = toLaneModel([{ t: 'pole', x: 17 }, { t: 'pole', x: 33 }, { t: 'item', x: 88, kind: 'bin' }, { t: 'cone', x: 4 }]);
    expect(m.poleCount).toBe(5);
    expect(m.items.map((i) => i.slot)).toEqual(['pole1', 'pole2', 'gap5', 'start']);
  });

  it('maps anchor plus offset by resolving the position first', () => {
    const els: DiagramElement[] = [{ t: 'pole', x: 17 }, { t: 'pole', x: 50 }, { t: 'cone', anchor: 'pole2', offset: 8 }, { t: 'cone', anchor: 'top', offset: 12 }];
    const m = toLaneModel(els);
    expect(m.items[2].slot).toBe('gap3'); // 50 + 8 = 58, nearest gap
    expect(m.items[3].slot).toBe('beyond');
  });

  it('keeps named anchors that are already slots, and understands finish and changeover', () => {
    const m = toLaneModel([
      { t: 'cone', anchor: 'pole4' }, { t: 'cone', anchor: 'FINISH' }, { t: 'item', anchor: 'changeover' }, { t: 'pole', anchor: 'changeover' }, { t: 'cone', anchor: 'start' }, { t: 'cone', anchor: 'midline' },
    ]);
    expect(m.items.map((i) => i.slot)).toEqual(['pole4', 'top', 'gap5', 'pole5', 'start', 'pole3']);
  });

  it('keeps poles on pole slots even when an anchor names a gap', () => {
    const m = toLaneModel([{ t: 'pole', anchor: 'gap2' }]);
    expect(m.items[0].slot.startsWith('pole')).toBe(true);
  });

  it('reads a midline and the stored pole count', () => {
    const m = toLaneModel([{ t: 'lane', poles: 4 }, { t: 'midline' }, { t: 'cone', x: 39 }]);
    expect(m).toMatchObject({ poleCount: 4, midline: true });
    expect(m.items[0].slot).toBe('pole2');
  });

  it('infers four poles from a four-pole layout, five otherwise', () => {
    expect(inferPoleCount([{ t: 'pole', x: 17 }, { t: 'pole', x: 39 }, { t: 'pole', x: 61 }, { t: 'pole', x: 83 }])).toBe(4);
    expect(inferPoleCount([{ t: 'pole', x: 17 }, { t: 'pole', x: 33 }, { t: 'pole', x: 50 }])).toBe(5);
    expect(inferPoleCount([])).toBe(5);
  });

  it('drops junk in contents and tolerates bad input', () => {
    const m = toLaneModel([{ t: 'pole', x: 17, on: [{ t: 'item', kind: 'mug' }, { t: 'midline' }, null as never, 3 as never] }]);
    expect((m.items[0].el as { on: unknown[] }).on).toHaveLength(1);
    expect(parseDiagram('not json')).toEqual([]);
    expect(parseDiagram('{"a":1}')).toEqual([]);
    expect(parseDiagram(null)).toEqual([]);
    expect(parseDiagram('[1,{"t":"cone"},null]')).toEqual([{ t: 'cone' }]);
    expect(toLaneModel([{ t: 'cone', on: 'nope' as never }]).items).toHaveLength(1);
  });

  it('maps every seeded diagram onto slots without losing an element', () => {
    const source = readFileSync(resolve(process.cwd(), '../api/Services/RaceLibrarySeed.cs'), 'utf8');
    const diagrams = [...source.matchAll(/"""(\[[\s\S]*?\])"""/g)].map((m) => m[1]);
    expect(diagrams.length).toBeGreaterThan(10);
    for (const json of diagrams) {
      const parsed = parseDiagram(json);
      const model = toLaneModel(parsed);
      const slotIds = new Set(buildSlots(model.poleCount).map((s) => s.id));
      expect(model.items).toHaveLength(parsed.filter((e) => e.t !== 'midline' && e.t !== 'lane').length);
      for (const it of model.items) expect(slotIds.has(it.slot)).toBe(true);
      expect(model.midline).toBe(parsed.some((e) => e.t === 'midline'));
      // Poles stay on pole positions, and the result survives a round trip unchanged.
      for (const it of model.items) if (it.el.t === 'pole') expect(it.slot).toMatch(/^pole\d+$/);
      const again = toLaneModel(fromLaneModel(model));
      expect(again.poleCount).toBe(model.poleCount);
      expect(again.midline).toBe(model.midline);
      expect(again.items.map((i) => i.slot)).toEqual(model.items.map((i) => i.slot));
    }
  });

  it('maps the standard four-cone and five-pole seeds to the expected slots', () => {
    const five = toLaneModel(parseDiagram('[{"t":"pole","x":17,"label":"1"},{"t":"pole","x":33,"label":"2"},{"t":"pole","x":50,"label":"3"},{"t":"pole","x":67,"label":"4"},{"t":"pole","x":83,"label":"5"}]'));
    expect(five.items.map((i) => i.slot)).toEqual(['pole1', 'pole2', 'pole3', 'pole4', 'pole5']);
    const four = toLaneModel(parseDiagram('[{"t":"cone","x":17},{"t":"cone","x":39},{"t":"cone","x":61},{"t":"cone","x":83}]'));
    expect(four.poleCount).toBe(4);
    expect(four.items.map((i) => i.slot)).toEqual(['pole1', 'pole2', 'pole3', 'pole4']);
  });
});

describe('writing the slot shape', () => {
  it('stores the lane, the slot as anchor and a derived x, with no offset', () => {
    const out = fromLaneModel({ poleCount: 5, midline: true, items: [{ el: { t: 'cone', kind: 'flag', offset: 9 } as never, slot: 'gap2' }] });
    expect(out).toEqual([
      { t: 'lane', poles: 5 },
      { t: 'cone', kind: 'flag', anchor: 'gap2', x: 41.8 },
      { t: 'midline' },
    ]);
  });

  it('falls back to the start line for an unknown slot', () => {
    const out = fromLaneModel({ poleCount: 5, midline: false, items: [{ el: { t: 'cone' }, slot: 'gone' }] });
    expect(out[1]).toMatchObject({ anchor: 'start', x: 0 });
  });

  it('places elements at their slot x', () => {
    const { placed } = placeElements({ poleCount: 5, midline: false, items: [{ el: { t: 'cone' }, slot: 'pole3' }, { el: { t: 'cone' }, slot: 'gone' }] });
    expect(placed[0].x).toBe(50);
    expect(placed[1].slot.id).toBe('start');
  });
});

describe('placing, moving and deleting', () => {
  it('places a tool on a slot', () => {
    const m = placeTool(empty(), tool('item', 'bin'), 'gap2');
    expect(m.items).toEqual([{ el: { t: 'item', kind: 'bin' }, slot: 'gap2' }]);
    expect(placeTool(empty(), tool('in'), 'top').items[0].el).toEqual({ t: 'in' });
  });

  it('refuses poles off a pole position and unknown slots', () => {
    const m = empty();
    expect(placeTool(m, tool('pole'), 'gap2')).toBe(m);
    expect(placeTool(m, tool('pole'), 'pole2').items).toHaveLength(1);
    expect(placeTool(m, tool('cone', 'flag'), 'nowhere')).toBe(m);
  });

  it('moves slot to slot, skipping non-pole slots for poles', () => {
    let m = placeTool(placeTool(empty(), tool('pole'), 'pole1'), tool('cone', 'flag'), 'start');
    expect(stepSlot(m, 0, 1)).toBe('pole2');
    expect(stepSlot(m, 0, -1)).toBeNull();
    expect(stepSlot(m, 1, 1)).toBe('gap0');
    expect(stepSlot(m, 1, -1)).toBeNull();
    expect(stepSlot(m, 7, 1)).toBeNull();
    m = moveToSlot(m, 1, 'gap0');
    expect(m.items[1].slot).toBe('gap0');
    expect(moveToSlot(m, 0, 'gap1')).toBe(m);
    expect(moveToSlot(m, 1, 'zzz')).toBe(m);
    expect(moveToSlot(m, 9, 'gap1')).toBe(m);
    expect(stepSlot(moveToSlot(m, 1, 'beyond'), 1, 1)).toBeNull();
  });

  it('duplicates, patches and removes', () => {
    let m = placeTool(empty(), tool('item', 'mug'), 'pole2');
    m = patchItem(m, 0, { label: 'Blue' });
    m = duplicateItem(m, 0);
    expect(m.items.map((i) => (i.el as { label?: string }).label)).toEqual(['Blue', 'Blue']);
    (m.items[1].el as { label?: string }).label = 'Changed';
    expect((m.items[0].el as { label?: string }).label).toBe('Blue');
    expect(duplicateItem(m, 5)).toBe(m);
    expect(removeItem(m, 0).items).toHaveLength(1);
  });

  it('re-spaces the grid when the pole count changes', () => {
    let m = placeTool(placeTool(empty(5), tool('cone', 'flag'), 'pole5'), tool('cone', 'flag'), 'gap5');
    m = placeTool(m, tool('cone', 'flag'), 'gap1');
    m = setPoleCount(m, 4);
    expect(m.poleCount).toBe(4);
    expect(m.items.map((i) => i.slot)).toEqual(['pole4', 'gap4', 'gap1']);
    expect(setPoleCount(m, 99).poleCount).toBe(8);
    const odd: LaneModel = { poleCount: 5, midline: false, items: [{ el: { t: 'cone' }, slot: 'weird' }] };
    expect(setPoleCount(odd, 4).items[0].slot).toBe('weird');
  });

  it('puts a pole on every empty pole position', () => {
    const m = fillPoles(placeTool(empty(4), tool('pole'), 'pole2'));
    expect(m.items.filter((i) => i.el.t === 'pole').map((i) => i.slot).sort()).toEqual(['pole1', 'pole2', 'pole3', 'pole4']);
    expect(m.items.find((i) => i.slot === 'pole3')!.el).toEqual({ t: 'pole', label: '3' });
  });
});

describe('what is on a container', () => {
  it('knows which things hold items', () => {
    expect(isContainer({ t: 'pole' })).toBe(true);
    expect(isContainer({ t: 'cone' })).toBe(true);
    expect(isContainer({ t: 'table' })).toBe(true);
    expect(isContainer({ t: 'item', kind: 'bin' })).toBe(true);
    expect(isContainer({ t: 'item', kind: 'sword' })).toBe(false);
    expect(isContainer({ t: 'midline' })).toBe(false);
    expect(isContainer({ t: 'lane' })).toBe(false);
  });

  it('adds, counts, summarises and removes contents', () => {
    let m = placeTool(empty(), tool('item', 'bin'), 'gap2');
    m = addContent(m, 0, tool('item', 'mug'));
    m = addContent(m, 0, tool('item', 'mug'));
    m = addContent(m, 0, tool('item', 'ball'));
    expect(contentsOf(m.items[0].el).map((c) => [c.label, c.count])).toEqual([['Mug', 2], ['Ball', 1]]);
    expect(contentsSummary(m.items[0].el)).toBe('2 mugs and 1 ball');
    m = addContent(m, 0, tool('item', 'flag'));
    expect(contentsSummary(m.items[0].el)).toBe('2 mugs, 1 ball and 1 flag');
    m = removeContent(m, 0, 'item:mug');
    expect(contentsSummary(m.items[0].el)).toBe('1 mug, 1 ball and 1 flag');
    m = removeContent(removeContent(removeContent(m, 0, 'item:mug'), 0, 'item:ball'), 0, 'item:flag');
    expect(contentsSummary(m.items[0].el)).toBe('');
    expect(removeContent(m, 0, 'item:mug')).toEqual(m);
    expect(removeContent(m, 9, 'x')).toBe(m);
  });

  it('refuses contents on a non-container, poles as contents, and bad indexes', () => {
    const m = placeTool(empty(), tool('item', 'sword'), 'gap1');
    expect(addContent(m, 0, tool('item', 'mug'))).toBe(m);
    const bin = placeTool(empty(), tool('item', 'bin'), 'gap1');
    expect(addContent(bin, 0, tool('pole'))).toBe(bin);
    expect(addContent(bin, 4, tool('item', 'mug'))).toBe(bin);
  });

  it('summarises legacy table contents and names things', () => {
    expect(contentsOf({ t: 'cone', on: [{ t: 'table' }, { t: 'in' }] })[0]).toMatchObject({ key: 'in:', count: 2 });
    expect(contentsOf({ t: 'midline' })).toEqual([]);
    expect(contentsSummary({ t: 'cone', on: [{ t: 'item', kind: 'sock' }, { t: 'item', kind: 'sock' }] })).toBe('2 socks');
    expect(toolLabel({ t: 'table' })).toBe('In / station');
    expect(toolLabel({ t: 'item', kind: 'bin' })).toBe('Bin');
    expect(toolLabel({ t: 'item' })).toBe('Item');
    expect(toolLabel({ t: 'cone', kind: 'ball' })).toBe('Ball cone');
    expect(toolLabel({ t: 'midline' })).toBe('Midline');
    expect(toolLabel({ t: 'lane' })).toBe('Lane');
  });
});
