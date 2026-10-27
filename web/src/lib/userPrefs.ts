import { useCallback, useEffect, useState } from 'react';

export type BottomTabId =
  | 'timetable'
  | 'toplists'
  | 'following'
  | 'chat'
  | 'teams'
  | 'arena'
  | 'declarations'
  | 'shop'
  | 'details'
  | 'operations';

export type BottomBarPresetId =
  | 'spectator'
  | 'parent'
  | 'trainer'
  | 'ring-crew'
  | 'organiser';

export type ToplistViewPref = 'standings' | 'results' | 'sessions';
export type NotifyLeadMins = number;
export type TextSizePref = 'normal' | 'large';

export interface BottomTabOption {
  id: BottomTabId;
  label: string;
  organiserOnly?: boolean;
}

export interface BottomBarPreset {
  id: BottomBarPresetId;
  label: string;
  description: string;
  tabs: BottomTabId[];
}

export const ALL_BOTTOM_TAB_OPTIONS: readonly BottomTabOption[] = [
  { id: 'timetable', label: 'Timetable' },
  { id: 'toplists', label: 'Toplists' },
  { id: 'following', label: 'Following' },
  { id: 'chat', label: 'Live stream' },
  { id: 'teams', label: 'Teams' },
  { id: 'arena', label: 'Arena' },
  { id: 'declarations', label: 'Dec forms' },
  { id: 'shop', label: 'Shop' },
  { id: 'details', label: 'Details' },
  { id: 'operations', label: 'Operations', organiserOnly: true },
] as const;

export const VALID_BOTTOM_TAB_IDS: readonly BottomTabId[] = ALL_BOTTOM_TAB_OPTIONS.map((t) => t.id);

export const DEFAULT_BOTTOM_TABS: readonly BottomTabId[] = [
  'timetable',
  'toplists',
  'chat',
  'details',
] as const;

export const MIN_BOTTOM_TABS = 2;
export const MAX_BOTTOM_TABS = 6;

export const BOTTOM_BAR_PRESETS: readonly BottomBarPreset[] = [
  {
    id: 'spectator',
    label: 'Spectator',
    description: 'Timetable, scores, chat and event info',
    tabs: ['timetable', 'toplists', 'chat', 'details'],
  },
  {
    id: 'parent',
    label: 'Parent',
    description: 'Follow your teams, timetable, scores and chat',
    tabs: ['following', 'timetable', 'toplists', 'chat'],
  },
  {
    id: 'trainer',
    label: 'Trainer',
    description: 'Timetable, declarations, teams, scores and chat',
    tabs: ['timetable', 'declarations', 'teams', 'toplists', 'chat'],
  },
  {
    id: 'ring-crew',
    label: 'Ring crew',
    description: 'Timetable, arena map, scores and chat',
    tabs: ['timetable', 'arena', 'toplists', 'chat'],
  },
  {
    id: 'organiser',
    label: 'Organiser',
    description: 'Timetable, scores, declarations, manage and chat',
    tabs: ['timetable', 'toplists', 'declarations', 'operations', 'chat'],
  },
] as const;

export const STORAGE_KEYS = {
  bottomTabs: 'mg.prefs.bottomTabs',
  toplistView: 'mg.prefs.toplistView',
  defaultAgeGroup: 'mg.prefs.defaultAgeGroup',
  notifyLeadMins: 'mg.prefs.notifyLeadMins',
  textSize: 'mg.prefs.textSize',
  scorerHaptics: 'mg.prefs.scorerHaptics',
  sortByLaneOrder: 'mg.prefs.sortByLaneOrder',
} as const;

export const PREFS_CHANGED_EVENT = 'mg:prefs-changed';

function notifyPrefsChanged(): void {
  window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT));
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage quota or private-browsing errors
  }
}

export function isValidBottomTabId(value: unknown): value is BottomTabId {
  return typeof value === 'string' && (VALID_BOTTOM_TAB_IDS as readonly string[]).includes(value);
}

export function sanitizeBottomTabs(input: unknown): BottomTabId[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_BOTTOM_TABS];
  }
  const seen = new Set<BottomTabId>();
  const valid: BottomTabId[] = [];
  for (const item of input) {
    if (isValidBottomTabId(item) && !seen.has(item)) {
      seen.add(item);
      valid.push(item);
    }
  }
  if (valid.length < MIN_BOTTOM_TABS) {
    return [...DEFAULT_BOTTOM_TABS];
  }
  return valid.slice(0, MAX_BOTTOM_TABS);
}

export function getBottomTabs(): BottomTabId[] {
  const raw = readStorage(STORAGE_KEYS.bottomTabs);
  if (!raw) return [...DEFAULT_BOTTOM_TABS];
  try {
    return sanitizeBottomTabs(JSON.parse(raw));
  } catch {
    return [...DEFAULT_BOTTOM_TABS];
  }
}

export function setBottomTabs(tabs: readonly BottomTabId[]): BottomTabId[] {
  const clean = sanitizeBottomTabs([...tabs]);
  writeStorage(STORAGE_KEYS.bottomTabs, JSON.stringify(clean));
  notifyPrefsChanged();
  return clean;
}

export function resetBottomTabs(): BottomTabId[] {
  writeStorage(STORAGE_KEYS.bottomTabs, null);
  notifyPrefsChanged();
  return [...DEFAULT_BOTTOM_TABS];
}

export function applyBottomBarPreset(presetId: BottomBarPresetId): BottomTabId[] {
  const preset = BOTTOM_BAR_PRESETS.find((p) => p.id === presetId);
  if (!preset) return getBottomTabs();
  return setBottomTabs(preset.tabs);
}

export function getActiveBottomBarPreset(tabs: readonly BottomTabId[]): BottomBarPresetId | null {
  for (const preset of BOTTOM_BAR_PRESETS) {
    if (
      preset.tabs.length === tabs.length &&
      preset.tabs.every((tab, idx) => tab === tabs[idx])
    ) {
      return preset.id;
    }
  }
  return null;
}

export function getDefaultToplistView(): ToplistViewPref {
  const raw = readStorage(STORAGE_KEYS.toplistView);
  if (raw === 'standings' || raw === 'results' || raw === 'sessions') {
    return raw;
  }
  return 'standings';
}

export function setDefaultToplistView(view: ToplistViewPref): void {
  writeStorage(STORAGE_KEYS.toplistView, view);
  notifyPrefsChanged();
}

export function getDefaultAgeGroup(): string | null {
  const raw = readStorage(STORAGE_KEYS.defaultAgeGroup);
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

export function setDefaultAgeGroup(ageGroup: string | null): void {
  const clean = ageGroup && ageGroup.trim().length > 0 ? ageGroup.trim() : null;
  writeStorage(STORAGE_KEYS.defaultAgeGroup, clean);
  notifyPrefsChanged();
}

export function getNotifyMinutesBefore(): NotifyLeadMins {
  const raw = readStorage(STORAGE_KEYS.notifyLeadMins);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 240) {
    return Math.round(parsed);
  }
  return 60;
}

export function setNotifyMinutesBefore(mins: NotifyLeadMins): void {
  const valid: NotifyLeadMins = Number.isFinite(mins) && mins >= 1 && mins <= 240 ? Math.round(mins) : 60;
  writeStorage(STORAGE_KEYS.notifyLeadMins, String(valid));
  notifyPrefsChanged();
}

export function formatNotifyLeadReminder(
  leadMins: NotifyLeadMins,
  sessionId: number,
  teamId: number,
  teamLabel: string
): { tag: string; title: string } {
  if (leadMins === 60) {
    return {
      tag: `1h:${sessionId}:${teamId}`,
      title: `${teamLabel} — 1 hour to go`,
    };
  }
  return {
    tag: `${leadMins}m:${sessionId}:${teamId}`,
    title: `${teamLabel} — ${leadMins} minutes to go`,
  };
}

export function getTextSize(): TextSizePref {
  const raw = readStorage(STORAGE_KEYS.textSize);
  return raw === 'large' ? 'large' : 'normal';
}

export function syncTextSizeDom(size: TextSizePref = getTextSize()): void {
  if (size === 'large') {
    document.documentElement.setAttribute('data-text-size', 'large');
  } else {
    document.documentElement.removeAttribute('data-text-size');
  }
}

export function setTextSize(size: TextSizePref): void {
  const valid: TextSizePref = size === 'large' ? 'large' : 'normal';
  writeStorage(STORAGE_KEYS.textSize, valid);
  syncTextSizeDom(valid);
  notifyPrefsChanged();
}

export function getScorerHaptics(): boolean {
  const raw = readStorage(STORAGE_KEYS.scorerHaptics);
  if (raw === 'false' || raw === '0') return false;
  return true;
}

export function setScorerHaptics(enabled: boolean): void {
  writeStorage(STORAGE_KEYS.scorerHaptics, enabled ? 'true' : 'false');
  notifyPrefsChanged();
}

export function getSortByLaneOrder(): boolean {
  const raw = readStorage(STORAGE_KEYS.sortByLaneOrder);
  if (raw === 'false' || raw === '0') return false;
  return true;
}

export function setSortByLaneOrder(enabled: boolean): void {
  writeStorage(STORAGE_KEYS.sortByLaneOrder, enabled ? 'true' : 'false');
  notifyPrefsChanged();
}

/** Two short pulses when a team is put out, so it feels different from the single tap of placing one. */
export const ELIMINATED_HAPTIC: readonly number[] = [40, 60, 40];

/** Buzzes once (or in a pattern) when the scorer has haptics on. A phone that can't or won't vibrate is ignored. */
export function triggerScorerHaptic(pattern: number | readonly number[] = 10): boolean {
  if (!getScorerHaptics()) return false;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      return navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
    } catch {
      return false;
    }
  }
  return false;
}

export interface UserPrefsSnapshot {
  bottomTabs: BottomTabId[];
  activePreset: BottomBarPresetId | null;
  defaultToplistView: ToplistViewPref;
  defaultAgeGroup: string | null;
  notifyLeadMins: NotifyLeadMins;
  textSize: TextSizePref;
  scorerHaptics: boolean;
  sortByLaneOrder: boolean;
}

export function readUserPrefsSnapshot(): UserPrefsSnapshot {
  const bottomTabs = getBottomTabs();
  return {
    bottomTabs,
    activePreset: getActiveBottomBarPreset(bottomTabs),
    defaultToplistView: getDefaultToplistView(),
    defaultAgeGroup: getDefaultAgeGroup(),
    notifyLeadMins: getNotifyMinutesBefore(),
    textSize: getTextSize(),
    scorerHaptics: getScorerHaptics(),
    sortByLaneOrder: getSortByLaneOrder(),
  };
}

export function useUserPrefs() {
  const [prefs, setPrefs] = useState<UserPrefsSnapshot>(() => readUserPrefsSnapshot());

  const refresh = useCallback(() => {
    setPrefs(readUserPrefsSnapshot());
  }, []);

  useEffect(() => {
    syncTextSizeDom(getTextSize());
    const handleStorage = (e: StorageEvent) => {
      if (Object.values(STORAGE_KEYS).includes(e.key as (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS])) {
        refresh();
        syncTextSizeDom(getTextSize());
      }
    };
    window.addEventListener(PREFS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(PREFS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', handleStorage);
    };
  }, [refresh]);

  return {
    ...prefs,
    setBottomTabs,
    resetBottomTabs,
    applyBottomBarPreset,
    setDefaultToplistView,
    setDefaultAgeGroup,
    setNotifyMinutesBefore,
    setTextSize,
    setScorerHaptics,
    setSortByLaneOrder,
  };
}

// Sync initial text size attribute on module load
syncTextSizeDom();
