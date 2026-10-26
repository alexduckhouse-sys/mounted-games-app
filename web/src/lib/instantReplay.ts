export const INSTANT_LENGTHS = [30, 60] as const;
export type InstantLength = (typeof INSTANT_LENGTHS)[number];

const KEY = 'mg.instantReplaySeconds';

/** How far back an instant replay saves. Remembered on this device. */
export function loadInstantLength(): InstantLength {
  try {
    const value = Number(localStorage.getItem(KEY));
    return (INSTANT_LENGTHS as readonly number[]).includes(value) ? (value as InstantLength) : 30;
  } catch {
    return 30;
  }
}

export function saveInstantLength(length: InstantLength) {
  try { localStorage.setItem(KEY, String(length)); } catch { /* the choice still holds until the page closes */ }
}

export function lengthLabel(seconds: number): string {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
}
