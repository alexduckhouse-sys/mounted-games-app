import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_BOTTOM_TAB_OPTIONS,
  applyBottomBarPreset,
  BOTTOM_BAR_PRESETS,
  DEFAULT_BOTTOM_TABS,
  formatNotifyLeadReminder,
  getActiveBottomBarPreset,
  getBottomTabs,
  getDefaultAgeGroup,
  getDefaultToplistView,
  getNotifyMinutesBefore,
  getScorerHaptics,
  getTextSize,
  isValidBottomTabId,
  MAX_BOTTOM_TABS,
  PREFS_CHANGED_EVENT,
  readUserPrefsSnapshot,
  resetBottomTabs,
  sanitizeBottomTabs,
  setBottomTabs,
  setDefaultAgeGroup,
  setDefaultToplistView,
  setNotifyMinutesBefore,
  setScorerHaptics,
  setTextSize,
  STORAGE_KEYS,
  syncTextSizeDom,
  triggerScorerHaptic,
  useUserPrefs,
} from './userPrefs';

describe('userPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-text-size');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates bottom tab IDs and sanitises invalid, duplicate or out-of-range lists', () => {
    expect(isValidBottomTabId('timetable')).toBe(true);
    expect(isValidBottomTabId('operations')).toBe(true);
    expect(isValidBottomTabId('unknown')).toBe(false);
    expect(isValidBottomTabId(42)).toBe(false);

    expect(sanitizeBottomTabs(null)).toEqual(DEFAULT_BOTTOM_TABS);
    expect(sanitizeBottomTabs(['timetable'])).toEqual(DEFAULT_BOTTOM_TABS);
    expect(sanitizeBottomTabs(['timetable', 'timetable'])).toEqual(DEFAULT_BOTTOM_TABS);
    expect(sanitizeBottomTabs(['timetable', 'toplists', 'toplists', 'invalid'])).toEqual([
      'timetable',
      'toplists',
    ]);

    const allIds = ALL_BOTTOM_TAB_OPTIONS.map((t) => t.id);
    const clamped = sanitizeBottomTabs(allIds);
    expect(clamped).toHaveLength(MAX_BOTTOM_TABS);
    expect(clamped).toEqual(allIds.slice(0, MAX_BOTTOM_TABS));
  });

  it('reads, persists and resets bottom tabs with fallback on malformed JSON', () => {
    expect(getBottomTabs()).toEqual(DEFAULT_BOTTOM_TABS);

    localStorage.setItem(STORAGE_KEYS.bottomTabs, '{broken-json');
    expect(getBottomTabs()).toEqual(DEFAULT_BOTTOM_TABS);

    const updated = setBottomTabs(['following', 'timetable', 'toplists']);
    expect(updated).toEqual(['following', 'timetable', 'toplists']);
    expect(getBottomTabs()).toEqual(['following', 'timetable', 'toplists']);

    const reset = resetBottomTabs();
    expect(reset).toEqual(DEFAULT_BOTTOM_TABS);
    expect(localStorage.getItem(STORAGE_KEYS.bottomTabs)).toBeNull();
  });

  it('applies role presets and detects the active preset', () => {
    expect(getActiveBottomBarPreset(DEFAULT_BOTTOM_TABS)).toBe('spectator');
    expect(getActiveBottomBarPreset(['timetable', 'shop'])).toBeNull();

    for (const preset of BOTTOM_BAR_PRESETS) {
      const applied = applyBottomBarPreset(preset.id);
      expect(applied).toEqual(preset.tabs);
      expect(getActiveBottomBarPreset(applied)).toBe(preset.id);
    }

    // Unknown preset keeps existing tabs
    const current = getBottomTabs();
    expect(applyBottomBarPreset('unknown' as never)).toEqual(current);
  });

  it('manages default toplist view and default age group', () => {
    expect(getDefaultToplistView()).toBe('standings');
    setDefaultToplistView('results');
    expect(getDefaultToplistView()).toBe('results');
    setDefaultToplistView('sessions');
    expect(getDefaultToplistView()).toBe('sessions');
    localStorage.setItem(STORAGE_KEYS.toplistView, 'other');
    expect(getDefaultToplistView()).toBe('standings');

    expect(getDefaultAgeGroup()).toBeNull();
    setDefaultAgeGroup(' Open ');
    expect(getDefaultAgeGroup()).toBe('Open');
    setDefaultAgeGroup('   ');
    expect(getDefaultAgeGroup()).toBeNull();
    setDefaultAgeGroup(null);
    expect(getDefaultAgeGroup()).toBeNull();
  });

  it('manages notification lead minutes (1 to 240, including custom timings)', () => {
    expect(getNotifyMinutesBefore()).toBe(60);
    setNotifyMinutesBefore(15);
    expect(getNotifyMinutesBefore()).toBe(15);
    setNotifyMinutesBefore(30);
    expect(getNotifyMinutesBefore()).toBe(30);
    setNotifyMinutesBefore(45);
    expect(getNotifyMinutesBefore()).toBe(45);
    setNotifyMinutesBefore(999);
    expect(getNotifyMinutesBefore()).toBe(60);
    setNotifyMinutesBefore(0);
    expect(getNotifyMinutesBefore()).toBe(60);
    localStorage.setItem(STORAGE_KEYS.notifyLeadMins, 'invalid');
    expect(getNotifyMinutesBefore()).toBe(60);
  });

  it('manages text size preference and syncs html[data-text-size]', () => {
    expect(getTextSize()).toBe('normal');
    expect(document.documentElement.getAttribute('data-text-size')).toBeNull();

    setTextSize('large');
    expect(getTextSize()).toBe('large');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('large');

    setTextSize('normal');
    expect(getTextSize()).toBe('normal');
    expect(document.documentElement.getAttribute('data-text-size')).toBeNull();

    syncTextSizeDom('large');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
  });

  it('manages scorer haptics and triggers navigator.vibrate safely', () => {
    expect(getScorerHaptics()).toBe(true);
    const vibrateMock = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      configurable: true,
      writable: true,
    });

    expect(triggerScorerHaptic(12)).toBe(true);
    expect(vibrateMock).toHaveBeenCalledWith(12);

    setScorerHaptics(false);
    expect(getScorerHaptics()).toBe(false);
    expect(triggerScorerHaptic()).toBe(false);
    expect(vibrateMock).toHaveBeenCalledTimes(1);

    setScorerHaptics(true);
    vibrateMock.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    expect(triggerScorerHaptic()).toBe(false);

    Object.defineProperty(navigator, 'vibrate', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(triggerScorerHaptic()).toBe(false);
  });

  it('handles storage errors gracefully', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(getBottomTabs()).toEqual(DEFAULT_BOTTOM_TABS);
    expect(() => setBottomTabs(['timetable', 'chat'])).not.toThrow();
    expect(() => resetBottomTabs()).not.toThrow();
  });

  it('updates useUserPrefs hook state across custom and storage events', () => {
    const { result } = renderHook(() => useUserPrefs());
    expect(result.current.bottomTabs).toEqual(DEFAULT_BOTTOM_TABS);
    expect(result.current.activePreset).toBe('spectator');
    expect(result.current.notifyLeadMins).toBe(60);
    expect(result.current.textSize).toBe('normal');
    expect(result.current.scorerHaptics).toBe(true);

    act(() => {
      result.current.applyBottomBarPreset('parent');
      result.current.setNotifyMinutesBefore(30);
      result.current.setTextSize('large');
      result.current.setScorerHaptics(false);
      result.current.setSortByLaneOrder(false);
      result.current.setDefaultToplistView('results');
      result.current.setDefaultAgeGroup('Junior');
    });

    expect(result.current.bottomTabs).toEqual(['following', 'timetable', 'toplists', 'chat']);
    expect(result.current.activePreset).toBe('parent');
    expect(result.current.notifyLeadMins).toBe(30);
    expect(result.current.textSize).toBe('large');
    expect(result.current.scorerHaptics).toBe(false);
    expect(result.current.sortByLaneOrder).toBe(false);
    expect(result.current.defaultToplistView).toBe('results');
    expect(result.current.defaultAgeGroup).toBe('Junior');

    act(() => {
      result.current.setSortByLaneOrder(true);
    });
    expect(result.current.sortByLaneOrder).toBe(true);

    // Simulate cross-tab storage event
    act(() => {
      localStorage.setItem(STORAGE_KEYS.textSize, 'normal');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STORAGE_KEYS.textSize,
          newValue: 'normal',
        })
      );
    });
    expect(result.current.textSize).toBe('normal');
    expect(document.documentElement.getAttribute('data-text-size')).toBeNull();

    // Unrelated storage key is ignored safely
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other.key' }));
      window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT));
    });
    expect(readUserPrefsSnapshot().textSize).toBe('normal');
  });

  it('formats notification reminder tags and titles for 60, 30 and 15 minute lead times', () => {
    expect(formatNotifyLeadReminder(60, 10, 20, 'Kent A')).toEqual({
      tag: '1h:10:20',
      title: 'Kent A — 1 hour to go',
    });
    expect(formatNotifyLeadReminder(30, 10, 20, 'Kent A')).toEqual({
      tag: '30m:10:20',
      title: 'Kent A — 30 minutes to go',
    });
    expect(formatNotifyLeadReminder(15, 10, 20, 'Supporting Kent A')).toEqual({
      tag: '15m:10:20',
      title: 'Supporting Kent A — 15 minutes to go',
    });
  });
});
