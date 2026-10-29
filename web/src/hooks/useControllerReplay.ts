import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createReplayBuffer, removeSavedReplay, updateReplayRaceTimes, tagSavedReplay, type ReplayBufferHandle, type ReplayBufferStatus, type SavedReplayClip } from '../live/replayBuffer';
import { ReplaySegmentStore } from '../live/replaySegments';
import { useReplayPreparation } from '../live/useReplayPreparation';
import type { Session } from '../types';
import type { QueuedScoreCard } from '../lib/scoreCard';

export const RACE_RECORDING_SECONDS = 45;

function startPreservingSegments(handle: ReplayBufferHandle, stream: MediaStream) {
  const originalClear = ReplaySegmentStore.prototype.clear;
  ReplaySegmentStore.prototype.clear = () => {};
  try {
    handle.start(stream);
  } finally {
    ReplaySegmentStore.prototype.clear = originalClear;
  }
}

/**
 * Records the live video this device is watching into the 30-minute replay buffer, so a producer can save an instant
 * replay and every scored race is kept as a recording. Clips stay on this device. Preparing a clip plays it back in
 * real time, so a 30-second clip takes about 30 seconds and the page must stay open.
 */
export function useControllerReplay({ competitionId, arena, streamId, media, scoreCards, sessions }: {
  competitionId: number;
  arena: string;
  streamId: number | null;
  media: MediaStream | null;
  scoreCards?: QueuedScoreCard[];
  sessions?: Session[];
}) {
  const races = useMemo(() => sessions?.filter((s) => (s.arenaName ?? '') === arena).flatMap((s) => s.heats.flatMap((h) => h.races)) ?? [], [sessions, arena]);
  const raceRef = useRef(races);
  useEffect(() => { raceRef.current = races; updateReplayRaceTimes(competitionId, arena, races); }, [races, competitionId, arena]);
  const buffer = useRef<ReplayBufferHandle | null>(null);
  const streamIdRef = useRef<number | null>(streamId);
  useEffect(() => {
    streamIdRef.current = streamId;
  }, [streamId]);
  const [status, setStatus] = useState<ReplayBufferStatus>({ retainedSeconds: 0 });
  const [noVideo, setNoVideo] = useState(false);
  const [justMadeId, setJustMadeId] = useState<string | null>(null);
  const preparation = useReplayPreparation();
  const prepare = preparation.prepare;
  // The buffer starts with the first video and then lives as long as the page (for this competition and arena).
  // Switching camera remounts the player, which hands over no video for a moment; dropping the buffer then would
  // lose the last 30 minutes, so a gap only pauses recording.
  const live = Boolean(media);
  const bufferKey = `${competitionId}:${arena}`;
  const [armedKey, setArmedKey] = useState<string | null>(null);
  if (media && armedKey !== bufferKey) setArmedKey(bufferKey);
  const armed = armedKey === bufferKey;

  useEffect(() => {
    if (!armed) return;
    const handle = createReplayBuffer({
      competitionId,
      streamId: streamIdRef.current ?? undefined,
      arenaName: arena || 'Arena',
      windowSeconds: 1800,
      onStatus: setStatus,
    });
    buffer.current = handle;
    return () => {
      handle.dispose();
      if (buffer.current === handle) buffer.current = null;
    };
  }, [armed, competitionId, arena]);

  useEffect(() => {
    if (!buffer.current) return;
    if (media) startPreservingSegments(buffer.current, media);
    else buffer.current.stop();
  }, [media, armed, competitionId, arena]);

  // Keep a recording of each race when its result arrives. The first look only notes what is already there.
  const lastCard = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const latest = scoreCards?.at(-1);
    if (lastCard.current === undefined) { lastCard.current = latest?.key ?? null; return; }
    if (!latest || latest.key === lastCard.current) return;
    lastCard.current = latest.key;
    const sameArena = !latest.arenaName || latest.arenaName.trim().toLowerCase() === arena.trim().toLowerCase();
    const current = buffer.current;
    // No video right now (between cameras): there is nothing of this race to keep.
    if (!current || !sameArena || !live) return;
    void prepare((options) => current.saveClip(`${latest.heading} · ${latest.card.raceName}`, { ...options, durationSeconds: RACE_RECORDING_SECONDS }), (clip) => { if (raceRef.current.length) tagSavedReplay(clip.id, 'race', raceRef.current); else tagSavedReplay(clip.id, 'race'); });
  }, [scoreCards, arena, prepare, live]);

  const instant = useCallback((seconds: number, label: string, onSaved?: (clip: SavedReplayClip) => void) => {
    const current = buffer.current;
    if (!current) { setNoVideo(true); return; }
    setNoVideo(false);
    void prepare((options) => current.saveClip(label, { ...options, durationSeconds: seconds }), (clip) => {
      if (raceRef.current.length) tagSavedReplay(clip.id, 'instant', raceRef.current); else tagSavedReplay(clip.id, 'instant');
      setJustMadeId(clip.id);
      onSaved?.(clip);
    });
  }, [prepare]);

  const cancelClip = useCallback((clipId: string) => {
    removeSavedReplay(clipId);
    setJustMadeId((current) => (current === clipId ? null : current));
  }, []);

  return {
    recording: Boolean(media),
    retainedSeconds: media ? status.retainedSeconds : 0,
    warning: media ? status.warning : undefined,
    progress: preparation.progress,
    error: noVideo ? 'Replays are recorded from the video on this page. Wait for the video to start, then try again.' : preparation.error,
    cancelPreparation: preparation.cancel,
    justMadeId,
    instant,
    cancelClip,
  };
}
