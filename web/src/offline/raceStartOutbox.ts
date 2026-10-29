import { useEffect, useState } from 'react';
import { api } from '../api';
import { scorerApi } from './scorerLink';

const KEY = 'mg.outbox.race-starts';
const CHANGED = 'mg:race-starts';
export interface RaceStart { raceId: number; at: string; viaLink: boolean; sent?: boolean; confirmed?: boolean; error?: string }

export function readRaceStarts(): RaceStart[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(items) ? items.filter((q): q is RaceStart => q && Number.isInteger(q.raceId)
      && q.raceId > 0 && typeof q.at === 'string' && Number.isFinite(Date.parse(q.at)) && typeof q.viaLink === 'boolean') : [];
  } catch { return []; }
}
function write(items: RaceStart[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(items)); }
  catch { return false; }
  window.dispatchEvent(new CustomEvent(CHANGED));
  return true;
}
export function discardRaceStart(raceId: number): boolean {
  return write(readRaceStarts().filter((q) => q.raceId !== raceId));
}
export function raceStartFor(raceId: number): string | undefined {
  return readRaceStarts().find((q) => q.raceId === raceId)?.at;
}
/** Persist before unlocking the lanes. Never replace a first tap with a double tap. */
export function queueRaceStart(raceId: number, viaLink = false, at = new Date().toISOString()): boolean {
  const list = readRaceStarts();
  if (list.some((q) => q.raceId === raceId)) return true;
  if (!write([...list.filter((q) => !q.sent || !q.confirmed || Date.parse(q.at) >= Date.now() - 7 * 86400000), { raceId, at, viaLink }])) return false;
  void flushRaceStarts();
  return true;
}
/** Also used by score sync: the flag-down tap must arrive before its score. */
export async function sendRaceStart(raceId: number, at: string, viaLink = false): Promise<void> {
  const client = viaLink ? scorerApi : api;
  await client.post(`${viaLink ? '/scorer' : ''}/races/${raceId}/start`, { at }, { timeout: 15000 });
  // Keep the accepted timestamp for reload recovery and portable score backups.
  write(readRaceStarts().map((q) => q.raceId === raceId && q.at === at ? { ...q, sent: true } : q));
}
let flushing: Promise<void> | null = null;
export function flushRaceStarts(): Promise<void> {
  flushing ??= (async () => {
    for (const item of readRaceStarts().filter((q) => !q.sent && !q.error)) {
      if (!navigator.onLine) return;
      try { await sendRaceStart(item.raceId, item.at, item.viaLink); }
      catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (!status || status >= 500 || status === 408 || status === 429) return;
        write(readRaceStarts().map((q) => q.raceId === item.raceId && q.at === item.at
          ? { ...q, error: 'The start time was not accepted. Check this phone’s date and time, or score without a start time.' } : q));
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
export function useRaceStart(raceId?: number, explicitStart?: string | null, complete = false): RaceStart | undefined {
  const [starts, setStarts] = useState(readRaceStarts);
  useEffect(() => {
    const refresh = () => setStarts(readRaceStarts());
    window.addEventListener(CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(CHANGED, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  useEffect(() => {
    const current = readRaceStarts();
    const item = current.find((q) => q.raceId === raceId);
    if (!item) return;
    if (explicitStart && !item.confirmed) write(current.map((q) => q === item ? { ...q, confirmed: true } : q));
    else if (!explicitStart && !complete && item.confirmed) discardRaceStart(item.raceId);
  }, [raceId, explicitStart, complete]);
  return starts.find((q) => q.raceId === raceId);
}
