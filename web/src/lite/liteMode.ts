/** Pure rules for lite mode, kept apart from React so they are easy to test. */

export type LiteSetting = 'auto' | 'on' | 'off';
/** Why lite mode is on: the user chose it, Data Saver is on, or the connection is slow. */
export type LiteReason = 'chosen' | 'data-saver' | 'slow-connection';
/** What the connection alone says. */
export type AutoReason = Exclude<LiteReason, 'chosen'>;

export const LITE_SETTINGS: readonly LiteSetting[] = ['auto', 'on', 'off'];
export const LITE_STORAGE_KEY = 'mg.liteMode';

/** The parts of the Network Information API that we read. iPhone Safari has none of it. */
export interface ConnectionLike extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
  rtt?: number;
}

export function getConnection(): ConnectionLike | undefined {
  return (navigator as Navigator & { connection?: ConnectionLike }).connection ?? undefined;
}

/** What the connection says: Data Saver, a slow connection, or nothing (also when the browser can't tell). */
export function connectionReason(connection: ConnectionLike | undefined = getConnection()): AutoReason | null {
  if (!connection) return null;
  if (connection.saveData === true) return 'data-saver';
  const { effectiveType, rtt } = connection;
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'slow-connection';
  if (effectiveType === '3g' && typeof rtt === 'number' && rtt > 600) return 'slow-connection';
  return null;
}

export function resolveLite(setting: LiteSetting, auto: AutoReason | null): { lite: boolean; reason: LiteReason | null } {
  if (setting === 'on') return { lite: true, reason: 'chosen' };
  if (setting === 'off') return { lite: false, reason: null };
  return { lite: auto !== null, reason: auto };
}

export function readSetting(): LiteSetting {
  try {
    const stored = localStorage.getItem(LITE_STORAGE_KEY);
    return LITE_SETTINGS.includes(stored as LiteSetting) ? (stored as LiteSetting) : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeSetting(setting: LiteSetting) {
  try { localStorage.setItem(LITE_STORAGE_KEY, setting); } catch { /* storage blocked: the choice lasts until the page closes */ }
}

/** One plain line for the settings panel. */
export function liteStatusText(lite: boolean, reason: LiteReason | null): string {
  if (!lite) return 'Off';
  if (reason === 'data-saver') return 'On because Data Saver is on';
  if (reason === 'slow-connection') return 'On because your connection is slow';
  return 'On because you chose it';
}
