import { describe, expect, it } from 'vitest';
import { reorderStarts, type SlotItem } from './timetableReorder';

const at = (minutes: number) => new Date(Date.UTC(2031, 4, 4, 9, 0) + minutes * 60_000);
const item = (id: number, start: number | null, minutes: number, fixed = false): SlotItem => ({ id, start: start === null ? null : at(start), minutes, fixed });
const starts = (changes: { id: number; start: Date }[]) => Object.fromEntries(changes.map((c) => [c.id, (c.start.getTime() - at(0).getTime()) / 60_000]));

describe('reorderStarts', () => {
  const list = [item(1, 0, 20), item(2, 20, 30), item(3, 50, 10)];

  it('does nothing when the block stays where it is, is fixed or the place is outside the list', () => {
    expect(reorderStarts(list, 1, 1)).toEqual([]);
    expect(reorderStarts([item(1, 0, 20, true), item(2, 20, 30)], 0, 1)).toEqual([]);
    expect(reorderStarts(list, 0, 5)).toEqual([]);
    expect(reorderStarts(list, 0, -1)).toEqual([]);
    expect(reorderStarts(list, 7, 0)).toEqual([]);
  });

  it('moves a block later and closes up behind it', () => {
    expect(starts(reorderStarts(list, 0, 2))).toEqual({ 2: 0, 3: 30, 1: 40 });
  });

  it('moves a block earlier and pushes the others down', () => {
    expect(starts(reorderStarts(list, 2, 0))).toEqual({ 3: 0, 1: 10, 2: 30 });
  });

  it('keeps the gap each place had', () => {
    const gapped = [item(1, 0, 20), item(2, 30, 10), item(3, 50, 10)];
    // Gaps before the places are 0, 10 and 10 minutes.
    expect(starts(reorderStarts(gapped, 0, 1))).toEqual({ 2: 0, 1: 20 });
  });

  it('leaves a fixed block at its own time and shares the rest out around it', () => {
    const withFinal = [item(1, 0, 20), item(2, 20, 20), item(9, 60, 30, true), item(3, 90, 10)];
    expect(starts(reorderStarts(withFinal, 0, 1))).toEqual({ 2: 0, 1: 20 });
    // Dragging to the end moves it past the others, and the fixed block stays at its own time between them.
    expect(starts(reorderStarts(withFinal, 0, 3))).toEqual({ 2: 0, 3: 20, 1: 90 });
    // Dropping onto the fixed block changes nothing until it passes another movable one.
    expect(reorderStarts(withFinal, 1, 2)).toEqual([]);
  });

  it('does not touch blocks with no start', () => {
    const unset = [item(1, 0, 20), item(2, null, 20, true), item(3, 20, 10)];
    expect(starts(reorderStarts(unset, 0, 2))).toEqual({ 3: 0, 1: 20 });
  });

  it('falls back to the place’s own time when the block before has none', () => {
    const odd = [item(1, null, 20, true), item(2, 20, 10), item(3, 40, 10)];
    expect(starts(reorderStarts(odd, 1, 2))).toEqual({ 3: 20, 2: 40 });
  });

  it('copes with a movable block that has no start yet by leaving the times as they are', () => {
    expect(reorderStarts([item(1, 0, 20), item(2, null, 20), item(3, 20, 10)], 0, 1)).toEqual([]);
  });
});
