import { useRef, useState } from 'react';
import { api } from '../api';
import { activeTile, changeOptions, chooseCard, readLiveOptions, type LiveOptions, type OverlayTileId } from '../lib/streamOverlayTiles';
import type { LiveStream, StreamOverlay } from '../types';
import type { OverlaySaveResult } from './useStreamOverlay';

type Save = (change: (overlay: StreamOverlay) => StreamOverlay) => Promise<OverlaySaveResult>;

const NO_CAMERA = 'No camera is live.';
const READ_ONLY = 'You can’t change the overlay from here.';
const SAVE_FAILED: Record<Exclude<OverlaySaveResult, 'saved'>, string> = {
  conflict: 'The overlay changed on another phone. Check it and try again.',
  failed: 'Couldn’t change the overlay. Check your signal and try again.',
};

/**
 * What is on the viewers' screens and the taps that change it: pick a tile, change a card's settings. "Back soon" is
 * the camera being paused, so it is sent to the camera on air. Used by the Overlay tab and the Commentary desk.
 */
export function useOverlayTiles({ competitionId, overlay, saveOverlay, onAir, setAutoOn }: {
  competitionId: number;
  overlay: StreamOverlay;
  saveOverlay?: Save;
  onAir: LiveStream | null;
  setAutoOn?: (on: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the last save failed because the overlay was changed from another phone.
  const [conflict, setConflict] = useState(false);
  const lastWork = useRef<(() => Promise<void>) | null>(null);
  // A pause we just sent shows at once; it is dropped as soon as the camera reports its own status.
  const status = onAir?.status;
  const reported = `${onAir?.id ?? 0}:${status ?? ''}`;
  const [sent, setSent] = useState<{ reported: string; paused: boolean } | null>(null);
  const paused = sent && sent.reported === reported ? sent.paused : status === 1;

  async function setPaused(next: boolean): Promise<boolean> {
    if (!onAir) { setError(NO_CAMERA); return false; }
    try {
      await api.post(`/competitions/${competitionId}/streams/${onAir.id}/command`, { command: 'pause', value: String(next) });
      setSent({ reported, paused: next });
      return true;
    } catch {
      setError('Couldn’t reach the camera phone. Check your signal and try again.');
      return false;
    }
  }

  async function save(change: (overlay: StreamOverlay) => StreamOverlay): Promise<boolean> {
    if (!saveOverlay) { setError(READ_ONLY); return false; }
    const result = await saveOverlay(change).catch((): OverlaySaveResult => 'failed');
    if (result !== 'saved') { setConflict(result === 'conflict'); setError(SAVE_FAILED[result]); return false; }
    return true;
  }

  async function guarded(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    lastWork.current = work;
    try { await work(); } finally { setBusy(false); }
  }

  /** Runs the last change again, for the "Try again" on a failure strip. */
  const retry = () => { const work = lastWork.current; return work ? guarded(work) : Promise.resolve(); };

  const pick = (id: OverlayTileId) => guarded(async () => {
    if (id === 'soon') { if (!paused) await setPaused(true); return; }
    if (paused && !(await setPaused(false))) return;
    if (await save((o) => chooseCard(o, id)) && id === 'auto') setAutoOn?.(true);
  });

  const setOptions = (patch: Partial<LiveOptions>) => guarded(async () => { await save((o) => changeOptions(o, patch)); });

  const revealNext = () => guarded(async () => {
    const shown = readLiveOptions(overlay).podiumShown;
    await save((o) => changeOptions(o, { podiumShown: shown < 3 ? shown + 1 : 0 }));
  });

  const postBanner = (text: string | null) => guarded(async () => {
    await save((o) => ({ ...o, bannerText: text && text.trim() ? text.trim() : null, bannerStyle: 0 }));
  });

  const nextSponsor = () => guarded(async () => {
    try { await api.post(`/competitions/${competitionId}/sponsors/skip`); } catch { setError('Couldn’t move to the next sponsor. Try again.'); }
  });

  return { active: activeTile(overlay, paused), options: readLiveOptions(overlay), busy, error, conflict, retryable: error !== null && error !== NO_CAMERA && error !== READ_ONLY, retry, pick, setOptions, revealNext, postBanner, nextSponsor };
}
