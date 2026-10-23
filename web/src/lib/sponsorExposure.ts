import { api } from '../api';
import { placementBit, SPONSOR_PLACEMENTS, type SponsorPlacementKey } from './sponsors';

/** One sponsor in one place: appearances and seconds on screen since the last report. */
interface Tally { competitionId: number; sponsorId: number; placement: number; views: number; seconds: number }

const FLUSH_MS = 30_000;
// The API accepts at most 40 items a batch, 500 appearances and 3600 seconds each.
const MAX_ITEMS = 40;
const MAX_VIEWS = 500;
const MAX_SECONDS = 3600;
const MAX_HELD = 200;

const SPONSOR_KEY_BY_BIT = (bit: number): SponsorPlacementKey => SPONSOR_PLACEMENTS.find((p) => p.placement === bit)!.key;

const pending = new Map<string, Tally>();
let timer: ReturnType<typeof setTimeout> | null = null;

function tally(competitionId: number, sponsorId: number, key: SponsorPlacementKey): Tally {
  const placement = placementBit(key);
  const id = `${competitionId}:${sponsorId}:${placement}`;
  let entry = pending.get(id);
  if (!entry) {
    // A tab left open for days with a broken connection must not grow without end.
    if (pending.size >= MAX_HELD) pending.delete(pending.keys().next().value!);
    entry = { competitionId, sponsorId, placement, views: 0, seconds: 0 };
    pending.set(id, entry);
  }
  return entry;
}

function schedule() {
  if (timer === null) timer = setTimeout(() => { void flushSponsorExposure(); }, FLUSH_MS);
}

/** A sponsor came on screen. Counts are batched and sent every half minute and when the page is hidden; they hold no personal data. */
export function recordSponsorView(competitionId: number, sponsorId: number, key: SponsorPlacementKey) {
  tally(competitionId, sponsorId, key).views += 1;
  schedule();
}

/** A sponsor stayed on screen for `seconds` more (live video only). */
export function recordSponsorSeconds(competitionId: number, sponsorId: number, key: SponsorPlacementKey, seconds: number) {
  tally(competitionId, sponsorId, key).seconds += seconds;
  schedule();
}

/** Takes everything held, one batch per competition, at most 40 items each. */
function take(): { competitionId: number; items: Omit<Tally, 'competitionId'>[] }[] {
  const byCompetition = new Map<number, Tally[]>();
  for (const entry of pending.values()) byCompetition.set(entry.competitionId, [...(byCompetition.get(entry.competitionId) ?? []), entry]);
  pending.clear();
  const batches: { competitionId: number; items: Omit<Tally, 'competitionId'>[] }[] = [];
  for (const [competitionId, entries] of byCompetition) {
    const items = entries.flatMap((entry) => {
      // Anything over the per-item caps is split into more items rather than lost.
      const parts: Omit<Tally, 'competitionId'>[] = [];
      let { views, seconds } = entry;
      while (views > 0 || seconds > 0) {
        parts.push({ sponsorId: entry.sponsorId, placement: entry.placement, views: Math.min(views, MAX_VIEWS), seconds: Math.min(seconds, MAX_SECONDS) });
        views = Math.max(0, views - MAX_VIEWS);
        seconds = Math.max(0, seconds - MAX_SECONDS);
      }
      return parts;
    });
    for (let i = 0; i < items.length; i += MAX_ITEMS) batches.push({ competitionId, items: items.slice(i, i + MAX_ITEMS) });
  }
  return batches;
}

function putBack(competitionId: number, items: Omit<Tally, 'competitionId'>[]) {
  for (const item of items) {
    const entry = tally(competitionId, item.sponsorId, SPONSOR_KEY_BY_BIT(item.placement));
    entry.views += item.views;
    entry.seconds += item.seconds;
  }
}

const apiBase = () => import.meta.env.VITE_API_BASE ?? '/api';

/**
 * Sends what has been counted. A failed send keeps the counts for the next try, unless the server refused
 * them (a 4xx, including the rate limit), which would only be refused again. With `leaving`, the page is
 * going away, so the browser's beacon is used where it exists.
 */
export async function flushSponsorExposure(leaving = false): Promise<void> {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  for (const { competitionId, items } of take()) {
    const url = `/competitions/${competitionId}/sponsors/exposures`;
    if (leaving && typeof navigator.sendBeacon === 'function') {
      const queued = navigator.sendBeacon(`${apiBase()}${url}`, new Blob([JSON.stringify({ items })], { type: 'application/json' }));
      if (!queued) putBack(competitionId, items);
      continue;
    }
    try {
      await api.post(url, { items });
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === undefined || status >= 500) { putBack(competitionId, items); schedule(); }
    }
  }
}

/** Sends the counts when the page is hidden or closed. Call once; returns the way to stop. */
export function flushSponsorExposureOnLeave(): () => void {
  const onHide = () => { if (document.visibilityState === 'hidden') void flushSponsorExposure(true); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); };
}

/** Forgets everything held. For tests. */
export function resetSponsorExposure() {
  pending.clear();
  if (timer !== null) { clearTimeout(timer); timer = null; }
}
