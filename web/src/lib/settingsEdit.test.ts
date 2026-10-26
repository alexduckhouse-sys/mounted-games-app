import { describe, expect, it } from 'vitest';
import { itemsFromTabs, stepReminder, tabCountFlag, tabsFromItems } from './settingsEdit';
import { ALL_BOTTOM_TAB_OPTIONS, DEFAULT_BOTTOM_TABS } from './userPrefs';

describe('stepReminder', () => {
  it('goes up and down in 5 minute steps', () => {
    expect(stepReminder(60, 1)).toBe(65);
    expect(stepReminder(60, -1)).toBe(55);
    expect(stepReminder(5, 1)).toBe(10);
    expect(stepReminder(120, -1)).toBe(115);
  });

  it('stops at 5 and 120', () => {
    expect(stepReminder(5, -1)).toBe(5);
    expect(stepReminder(120, 1)).toBe(120);
  });

  it('moves a value that is not a multiple of 5 to the next multiple in that direction', () => {
    expect(stepReminder(7, 1)).toBe(10);
    expect(stepReminder(7, -1)).toBe(5);
    expect(stepReminder(62, -1)).toBe(60);
    expect(stepReminder(62, 1)).toBe(65);
    expect(stepReminder(1, -1)).toBe(5);
  });

  it('brings an old value outside the range back into it', () => {
    expect(stepReminder(240, -1)).toBe(120);
    expect(stepReminder(240, 1)).toBe(120);
    expect(stepReminder(121, 1)).toBe(120);
  });
});

describe('the bottom bar list', () => {
  it('lists the tabs that are on first, in order, then the rest switched off', () => {
    const items = itemsFromTabs(['details', 'timetable']);
    expect(items.slice(0, 2)).toEqual([{ id: 'details', on: true }, { id: 'timetable', on: true }]);
    expect(items).toHaveLength(ALL_BOTTOM_TAB_OPTIONS.length);
    expect(items.slice(2).every((item) => !item.on)).toBe(true);
    expect(new Set(items.map((item) => item.id)).size).toBe(ALL_BOTTOM_TAB_OPTIONS.length);
  });

  it('gives back the tabs that are on, in list order, wherever they have been dragged', () => {
    const items = itemsFromTabs(['timetable', 'toplists']);
    const moved = [items[2], items[0], items[1], ...items.slice(3)].map((item, index) => (index === 0 ? { ...item, on: true } : item));
    expect(tabsFromItems(moved)).toEqual([moved[0].id, 'timetable', 'toplists']);
    expect(tabsFromItems(itemsFromTabs(DEFAULT_BOTTOM_TABS))).toEqual([...DEFAULT_BOTTOM_TABS]);
  });
});

describe('tabCountFlag', () => {
  it('says nothing from 2 to 6 tabs', () => {
    for (const count of [2, 3, 4, 5, 6]) expect(tabCountFlag(count)).toBeNull();
  });

  it('flags fewer than 2 and says what the bar shows instead', () => {
    expect(tabCountFlag(1)).toBe('Pick at least 2 tabs. With fewer, the bottom bar shows Timetable, Toplists, Live stream and Details.');
    expect(tabCountFlag(0)).toMatch(/^Pick at least 2 tabs/);
  });

  it('flags more than 6', () => {
    expect(tabCountFlag(7)).toBe('Only the first 6 tabs that are on will fit.');
    expect(tabCountFlag(10)).toBe('Only the first 6 tabs that are on will fit.');
  });
});
