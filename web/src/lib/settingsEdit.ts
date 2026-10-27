import { ALL_BOTTOM_TAB_OPTIONS, DEFAULT_BOTTOM_TABS, MAX_BOTTOM_TABS, MIN_BOTTOM_TABS, type BottomTabId } from './userPrefs';
import { activeLocale, tr } from '../i18n/translate';
import type { MessageKey } from '../i18n/en';

/** The name of a bottom bar tab in the language in use. */
export function tabLabel(id: BottomTabId): string {
  return tr(`shell.tab.${id}` as MessageKey);
}

/** The shortest and longest heat reminder, and the size of each step, in minutes. */
export const REMINDER_MIN = 5;
export const REMINDER_MAX = 120;
export const REMINDER_STEP = 5;

/**
 * The reminder one step less (`-1`) or more (`1`) than `minutes`, always a multiple of 5 between 5 and 120.
 * An older value that isn't a multiple of 5 (the setting used to take any number) steps to the next multiple.
 */
export function stepReminder(minutes: number, direction: -1 | 1): number {
  const steps = minutes / REMINDER_STEP;
  const next = direction === 1 ? (Number.isInteger(steps) ? steps : Math.floor(steps)) + 1 : (Number.isInteger(steps) ? steps : Math.ceil(steps)) - 1;
  return Math.min(REMINDER_MAX, Math.max(REMINDER_MIN, next * REMINDER_STEP));
}

/** One line of the bottom bar list: a tab and whether it is switched on. */
export interface TabItem { id: BottomTabId; on: boolean }

/** The tabs that are on, in their saved order, then every other tab, switched off. */
export function itemsFromTabs(tabs: readonly BottomTabId[]): TabItem[] {
  return [
    ...tabs.map((id) => ({ id, on: true })),
    ...ALL_BOTTOM_TAB_OPTIONS.filter((option) => !tabs.includes(option.id)).map((option) => ({ id: option.id, on: false })),
  ];
}

/** The tabs that are on, in list order. */
export function tabsFromItems(items: readonly TabItem[]): BottomTabId[] {
  return items.filter((item) => item.on).map((item) => item.id);
}

/**
 * What to say when the number of tabs that are on won't fit the bar, or null when it will. Too few or too many is
 * flagged rather than blocked: the bar then shows the usual tabs, or the first six.
 */
export function tabCountFlag(count: number): string | null {
  if (count < MIN_BOTTOM_TABS) {
    const usual = DEFAULT_BOTTOM_TABS.map((id) => (ALL_BOTTOM_TAB_OPTIONS.some((option) => option.id === id) ? tabLabel(id) : id));
    const tabs = new Intl.ListFormat(activeLocale(), { style: 'long', type: 'conjunction' }).format(usual);
    return tr('shell.settings.tooFewTabs', { min: MIN_BOTTOM_TABS, tabs });
  }
  if (count > MAX_BOTTOM_TABS) return tr('shell.settings.tooManyTabs', { max: MAX_BOTTOM_TABS });
  return null;
}
