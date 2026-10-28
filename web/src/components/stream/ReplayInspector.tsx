/* eslint-disable react-refresh/only-export-components */
import { useDialogFocus } from '../useDialogFocus';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ChangeEvent, type MouseEvent } from 'react';
import {
  Camera,
  Download,
  Film,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useT } from '../../i18n/LanguageContext';
import { tr } from '../../i18n/translate';
import { LEAVE, SPRING } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { useReplayPreparation } from '../../live/useReplayPreparation';
import { ReplayPreparation } from './ReplayPreparation';
import { Notice } from '../Notice';
import { useToast } from '../Toast';
import type { ReplayEncodingOptions } from '../../live/replayEncoding';
import {
  exportTrimmedClip,
  getSavedReplays,
  loadPersistedReplays,
  removeSavedReplay,
  subscribeSavedReplays,
  updateReplayTrim,
  type FollowKeyframe,
  type SavedReplayClip,
} from '../../live/replayBuffer';

export interface ReplayInspectorProps {
  clip: SavedReplayClip;
  clips?: SavedReplayClip[];
  onSelectClip?: (clip: SavedReplayClip) => void;
  onDeleteClip?: (clipId: string) => void;
  onSaveHighlight?: (clip: SavedReplayClip) => void;
  onClose: () => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export interface SavedReplaysDrawerProps {
  competitionId?: number;
  open: boolean;
  onClose: () => void;
  onSelectClip: (clip: SavedReplayClip) => void;
  onDeleteClip?: (clipId: string) => void;
  onCaptureBufferClip?: (durationSeconds: number) => void;
  bufferedSeconds?: number;
}

export interface SavedReplaysButtonProps {
  competitionId: number;
  arenaName?: string;
  onSelectClip: (clip: SavedReplayClip) => void;
  className?: string;
}

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4] as const;

const PLAYBACK_SPEEDS = [
  { rate: 0.25, label: 'desk.stream.in.speedPhoto' },
  { rate: 0.5, label: 'desk.stream.in.speedSlow' },
  { rate: 1, label: 'desk.stream.in.speedNormal' },
] as const;

function formatTimestamp(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

/**
 * Pure interpolation helper calculating smooth zoom, panX, and panY
 * coordinates across an array of timestamped follow-cam keyframes.
 */
export function interpolateFollowTransform(
  keyframes: FollowKeyframe[] | null | undefined,
  currentTimeSec: number
): { zoom: number; panX: number; panY: number } | null {
  if (!keyframes || keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.timeSec - b.timeSec);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const k0 = sorted.findLast((k) => k.timeSec <= currentTimeSec) ?? first;
  const k1 = sorted.find((k) => k.timeSec >= currentTimeSec) ?? last;
  if (k0 === k1) {
    return { zoom: k0.zoom, panX: k0.panX, panY: k0.panY };
  }
  const span = Math.max(0.0001, k1.timeSec - k0.timeSec);
  const t = (currentTimeSec - k0.timeSec) / span;
  return {
    zoom: Number((k0.zoom + (k1.zoom - k0.zoom) * t).toFixed(3)),
    panX: Number((k0.panX + (k1.panX - k0.panX) * t).toFixed(2)),
    panY: Number((k0.panY + (k1.panY - k0.panY) * t).toFixed(2)),
  };
}

/**
 * Captures a crisp photo-finish PNG snapshot at current playhead and zoom/pan transform,
 * renders bottom metadata banner, and triggers a file download.
 */
export function capturePhotoFinishSnapshot(
  video: HTMLVideoElement | null,
  clip: SavedReplayClip,
  currentTimeSec: number,
  transform: { zoom: number; panX: number; panY: number }
): string {
  if (!video || !video.videoWidth || !video.videoHeight) throw new Error(tr('desk.stream.in.waitVideo'));
  const canvas = document.createElement('canvas');
  const w = video.videoWidth, h = video.videoHeight;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(tr('desk.stream.in.noPhoto'));
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(transform.zoom, transform.zoom);
  ctx.translate(-w / 2 + transform.panX, -h / 2 + transform.panY);
  ctx.drawImage(video, 0, 0, w, h); ctx.restore();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.82)'; ctx.fillRect(0, h - 64, w, 64);
  ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 24px sans-serif';
  ctx.fillText(tr('desk.stream.in.photoBanner', { label: clip.label, arena: clip.arenaName, time: formatVideoTime(currentTimeSec) }), 24, h - 24);
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png')) throw new Error(tr('desk.stream.in.photoNotSaved'));
  const link = document.createElement('a'); link.href = dataUrl;
  link.download = `photo-finish-${clip.label.replace(/\s+/g, '_')}-${currentTimeSec.toFixed(1)}s.png`;
  document.body.appendChild(link); link.click(); link.remove();
  return dataUrl;
}

/**
 * Bakes the active follow-cam zoom and pan transform into the exported highlight clip.
 */
export async function renderTrimmedFollowClip(
  video: HTMLVideoElement | null,
  clip: SavedReplayClip,
  trimStartSec: number,
  trimEndSec: number,
  keyframes: FollowKeyframe[],
  currentTransform: { zoom: number; panX: number; panY: number; viewportWidth?: number; viewportHeight?: number },
  options: ReplayEncodingOptions = {},
): Promise<SavedReplayClip> {
  const sourceWidth = video?.videoWidth || currentTransform.viewportWidth || 1920;
  const sourceHeight = video?.videoHeight || currentTransform.viewportHeight || 1080;
  const mapped = keyframes.map((keyframe) => ({ ...keyframe,
    panX: keyframe.panX * sourceWidth / (keyframe.viewportWidth || currentTransform.viewportWidth || sourceWidth),
    panY: keyframe.panY * sourceHeight / (keyframe.viewportHeight || currentTransform.viewportHeight || sourceHeight),
  }));
  return exportTrimmedClip(clip, trimStartSec, trimEndSec, keyframes, { ...options,
    transform: (time, width, height) => {
      const target = interpolateFollowTransform(mapped, trimStartSec + time) ?? {
        zoom: currentTransform.zoom,
        panX: currentTransform.panX * sourceWidth / (currentTransform.viewportWidth || sourceWidth),
        panY: currentTransform.panY * sourceHeight / (currentTransform.viewportHeight || sourceHeight),
      };
      return { zoom: target.zoom, panX: target.panX * width / sourceWidth, panY: target.panY * height / sourceHeight };
    },
  });
}

export function ReplayInspector({
  clip,
  clips,
  onSelectClip,
  onDeleteClip,
  onSaveHighlight,
  onClose,
  videoRef: externalVideoRef,
}: ReplayInspectorProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose, 'button[data-autofocus]');
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef || internalVideoRef;
  const viewportRef = useRef<HTMLDivElement>(null);
  const preparation = useReplayPreparation();
  const still = useStillMotion();

  const [zoom, setZoom] = useState<number>(1);
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initialPanX: number; initialPanY: number }>({
    startX: 0,
    startY: 0,
    initialPanX: 0,
    initialPanY: 0,
  });

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const fallbackDuration = clip.durationSeconds || 15;
  const initialTrimStart = clip.trimStartSec ?? clip.trimStartSeconds ?? 0;
  const initialTrimEnd = clip.trimEndSec ?? clip.trimEndSeconds ?? fallbackDuration;
  const [duration, setDuration] = useState<number>(() => fallbackDuration);
  const [playbackRate, setPlaybackRate] = useState<number>(1);

  const [trimStart, setTrimStart] = useState<number>(() => initialTrimStart);
  const [trimEnd, setTrimEnd] = useState<number>(() => initialTrimEnd);

  // Follow-cam keyframes state
  const [followKeyframes, setFollowKeyframes] = useState<FollowKeyframe[]>(
    () => (clip.followKeyframes ? [...clip.followKeyframes] : [])
  );
  const [isRecordingFollow, setIsRecordingFollow] = useState<boolean>(false);
  const [followEnabled, setFollowEnabled] = useState<boolean>(
    () => (clip.followKeyframes?.length ?? 0) > 0
  );

  // A saved photo is a quick toast; a photo that couldn’t be saved is a problem strip with Try again.
  const photoToast = useToast();
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [storageUpdate, setStorageUpdate] = useState({ id: clip.id, warning: clip.storageWarning });
  useEffect(() => subscribeSavedReplays(() => setStorageUpdate({ id: clip.id, warning: clip.storageWarning })), [clip]);
  const storageWarning = storageUpdate.id === clip.id ? storageUpdate.warning : clip.storageWarning;


  // Synchronise state when active clip changes
  const [prevClipId, setPrevClipId] = useState(clip.id);
  if (prevClipId !== clip.id) {
    setPrevClipId(clip.id);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setCurrentTime(0);
    setIsPlaying(false);
    const initialDuration = clip.durationSeconds || 15;
    const start = clip.trimStartSec ?? clip.trimStartSeconds ?? 0;
    const end = clip.trimEndSec ?? clip.trimEndSeconds ?? initialDuration;
    setDuration(initialDuration);
    setTrimStart(start);
    setTrimEnd(end);
    setFollowKeyframes(clip.followKeyframes ? [...clip.followKeyframes] : []);
    setIsRecordingFollow(false);
    setFollowEnabled((clip.followKeyframes?.length ?? 0) > 0);
    setPhotoProblem(null);
  }

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
      videoRef.current.currentTime = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, playbackRate]);

  // Lock background scrolling while modal is open
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function applyFollowTransformAtTime(timeSec: number) {
      if (!isDragging && followEnabled) {
        const width = videoRef.current?.clientWidth || videoRef.current?.videoWidth || 1;
        const height = videoRef.current?.clientHeight || videoRef.current?.videoHeight || 1;
        const transform = interpolateFollowTransform(followKeyframes.map((key) => ({ ...key,
          panX: key.panX * width / (key.viewportWidth || width), panY: key.panY * height / (key.viewportHeight || height),
        })), timeSec);
        if (transform) {
          setZoom(transform.zoom);
          setPanX(transform.panX);
          setPanY(transform.panY);
        }
      }
  }

  function recordKeyframe(time: number, targetZoom: number, targetPanX: number, targetPanY: number) {
      setFollowKeyframes((prev) => {
        const filtered = prev.filter((k) => Math.abs(k.timeSec - time) > 0.15);
        const next = [
          ...filtered,
          {
            timeSec: Number(time.toFixed(2)),
            zoom: Number(targetZoom.toFixed(2)),
            panX: Math.round(targetPanX),
            panY: Math.round(targetPanY),
            viewportWidth: videoRef.current?.clientWidth || videoRef.current?.videoWidth,
            viewportHeight: videoRef.current?.clientHeight || videoRef.current?.videoHeight,
          },
        ].sort((a, b) => a.timeSec - b.timeSec);
        updateReplayTrim(clip.id, trimStart, trimEnd, next);
        return next;
      });
      setFollowEnabled(true);
  }

  const handleResetView = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  const handleZoomChange = (level: number) => {
    setZoom(level);
    if (level === 1) {
      setPanX(0);
      setPanY(0);
    }
    if (isRecordingFollow) {
      recordKeyframe(currentTime, level, panX, panY);
    }
  };

  const handleFocusRegion = (region: 'left' | 'centre' | 'right') => {
    const targetZoom = Math.max(2, zoom);
    const w = viewportRef.current?.clientWidth || 640;
    const maxPanX = Math.max(120, (w * (targetZoom - 1)) / (2 * targetZoom));
    const targetPanX = region === 'left' ? maxPanX : region === 'right' ? -maxPanX : 0;
    setZoom(targetZoom);
    setPanX(targetPanX);
    setPanY(0);
    if (isRecordingFollow) {
      recordKeyframe(currentTime, targetZoom, targetPanX, 0);
    }
  };

  const handleDoubleClickViewport = (e: MouseEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextZoom = zoom <= 1 ? 2 : zoom;
    const maxPanX = Math.max(50, (rect.width * (nextZoom - 1)) / (2 * nextZoom));
    const maxPanY = Math.max(50, (rect.height * (nextZoom - 1)) / (2 * nextZoom));
    const offsetX = (e.clientX - (rect.left + rect.width / 2)) / nextZoom;
    const offsetY = (e.clientY - (rect.top + rect.height / 2)) / nextZoom;
    const targetPanX = Math.max(-maxPanX, Math.min(maxPanX, -offsetX));
    const targetPanY = Math.max(-maxPanY, Math.min(maxPanY, -offsetY));
    setZoom(nextZoom);
    setPanX(targetPanX);
    setPanY(targetPanY);
    if (isRecordingFollow) {
      recordKeyframe(currentTime, nextZoom, targetPanX, targetPanY);
    }
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors in test/synthetic environments
    }
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialPanX: panX,
      initialPanY: panY,
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging || zoom <= 1) return;
    const deltaX = (e.clientX - dragStartRef.current.startX) / zoom;
    const deltaY = (e.clientY - dragStartRef.current.startY) / zoom;

    const w = viewportRef.current?.clientWidth || 640;
    const h = viewportRef.current?.clientHeight || 360;
    const maxPanX = Math.max(50, (w * (zoom - 1)) / (2 * zoom));
    const maxPanY = Math.max(50, (h * (zoom - 1)) / (2 * zoom));

    const nextX = Math.max(-maxPanX, Math.min(maxPanX, dragStartRef.current.initialPanX + deltaX));
    const nextY = Math.max(-maxPanY, Math.min(maxPanY, dragStartRef.current.initialPanY + deltaY));
    setPanX(nextX);
    setPanY(nextY);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore pointer release errors
      }
      setIsDragging(false);
      if (isRecordingFollow) {
        recordKeyframe(currentTime, zoom, panX, panY);
      }
    }
  };

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      // If past trimEnd, restart at trimStart
      if (video.currentTime >= trimEnd) {
        video.currentTime = trimStart;
        setCurrentTime(trimStart);
      }
      void video
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, trimEnd, trimStart]);

  const handleReplayClip = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = trimStart;
    setCurrentTime(trimStart);
    void video
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimStart]);

  const stepFrame = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      setIsPlaying(false);
      const targetDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
      const newTime = Math.max(0, Math.min(targetDuration, video.currentTime + deltaSeconds));
      video.currentTime = newTime;
      setCurrentTime(newTime);
      applyFollowTransformAtTime(newTime);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [duration, applyFollowTransformAtTime]
  );

  const handleSeek = (e: ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
    setCurrentTime(newTime);
    applyFollowTransformAtTime(newTime);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const handleTrimStartChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setTrimStart(val);
    if (videoRef.current && videoRef.current.currentTime < val) {
      videoRef.current.currentTime = val;
      setCurrentTime(val);
    }
    updateReplayTrim(clip.id, val, trimEnd, followKeyframes);
  };

  const handleTrimEndChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setTrimEnd(val);
    if (videoRef.current && videoRef.current.currentTime > val) {
      videoRef.current.currentTime = val;
      setCurrentTime(val);
    }
    updateReplayTrim(clip.id, trimStart, val, followKeyframes);
  };

  const handleSetTrimStart = () => {
    const newStart = Math.max(0, Math.min(currentTime, trimEnd - 0.1));
    setTrimStart(newStart);
    if (videoRef.current && videoRef.current.currentTime < newStart) {
      videoRef.current.currentTime = newStart;
      setCurrentTime(newStart);
    }
    updateReplayTrim(clip.id, newStart, trimEnd, followKeyframes);
  };

  const handleSetTrimEnd = () => {
    const newEnd = Math.min(duration, Math.max(currentTime, trimStart + 0.1));
    setTrimEnd(newEnd);
    if (videoRef.current && videoRef.current.currentTime > newEnd) {
      videoRef.current.currentTime = newEnd;
      setCurrentTime(newEnd);
    }
    updateReplayTrim(clip.id, trimStart, newEnd, followKeyframes);
  };

  const handleResetTrim = () => {
    setTrimStart(0);
    setTrimEnd(duration);
    updateReplayTrim(clip.id, 0, duration, followKeyframes);
  };

  const handleAddKeyframe = () => {
    const targetZoom = zoom > 1 ? zoom : 2;
    if (zoom <= 1) setZoom(2);
    recordKeyframe(currentTime, targetZoom, panX, panY);
  };

  const handleClearFollow = () => {
    setFollowKeyframes([]);
    setIsRecordingFollow(false);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    updateReplayTrim(clip.id, trimStart, trimEnd, []);
  };

  const handlePhotoFinishSnapshot = () => {
    setPhotoProblem(null);
    try {
      const widthScale = (videoRef.current?.videoWidth || 1) / (videoRef.current?.clientWidth || videoRef.current?.videoWidth || 1);
      const heightScale = (videoRef.current?.videoHeight || 1) / (videoRef.current?.clientHeight || videoRef.current?.videoHeight || 1);
      capturePhotoFinishSnapshot(videoRef.current, clip, currentTime, { zoom, panX: panX * widthScale, panY: panY * heightScale });
      photoToast.show(t('desk.stream.in.photoSaved', { time: formatVideoTime(currentTime) }));
    } catch (error) {
      // "Wait for the replay video to load" says what to do; every other failure gets the one standard sentence.
      setPhotoProblem(error instanceof Error && error.message === t('desk.stream.in.waitVideo') ? error.message : t('desk.stream.in.photoFailed'));
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const nowTime = video.currentTime;
    setCurrentTime(nowTime);

    // Apply follow-cam zoom/pan interpolation if active
    applyFollowTransformAtTime(nowTime);

    // Loop within trim range during playback
    if (isPlaying && nowTime >= trimEnd) {
      video.currentTime = trimStart;
      setCurrentTime(trimStart);
    }
  };

  // Keyboard accessibility
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'BUTTON')) {
        return;
      }
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepFrame(-0.1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrame(0.1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, stepFrame]);

  const downloadFilename = `${clip.label.replace(/\s+/g, '_')}_${clip.arenaName.replace(/\s+/g, '_')}.${clip.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;

  const handleSaveHighlight = () => {
    videoRef.current?.pause(); setIsPlaying(false);
    void preparation.prepare((options) => renderTrimmedFollowClip(videoRef.current, clip, trimStart, trimEnd, followKeyframes,
      { zoom, panX, panY, viewportWidth: videoRef.current?.clientWidth, viewportHeight: videoRef.current?.clientHeight }, options),
    (updated) => {
      onSaveHighlight?.(updated);
      const link = document.createElement('a');
      link.href = updated.url;
      const extension = updated.mimeType.includes('mp4') ? 'mp4' : 'webm';
      link.download = `Highlight_${clip.label.replace(/\s+/g, '_')}.${extension}`;
      document.body.appendChild(link); link.click(); link.remove();
    });
  };

  const handleRemoveLineReview = () => {
    removeSavedReplay(clip.id);
    if (onDeleteClip) {
      onDeleteClip(clip.id);
    } else {
      onClose();
    }
  };

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('desk.stream.in.dialog')}
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 text-white mg-font select-none"
      initial={still ? false : { opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      exit={still ? undefined : { opacity: 0, y: 28, transition: LEAVE }}
      transition={SPRING}
    >
      {storageWarning && <div className="p-3"><Notice role="status">{storageWarning}</Notice></div>}
      {/* Top Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgb(var(--mg-header-line))] bg-[rgb(var(--mg-header-deep)/0.95)] px-4 py-2.5">
        <div className="min-w-0 flex-1 pr-3">
          <div className="flex flex-wrap items-center gap-2">
            <Film className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <h2 className="text-base font-bold truncate">{clip.label}</h2>
            {clip.resolutionLabel && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                {clip.resolutionLabel}
              </span>
            )}
            {clip.savedHighlight && (
              <span className="flex items-center gap-1 rounded bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-400/40">
                <Star className="h-3 w-3 fill-amber-300" aria-hidden="true" />
                {t('desk.stream.in.highlight')}
              </span>
            )}
          </div>
          <p className="text-xs text-[rgb(var(--mg-header-sub))] truncate">
            {t('desk.stream.in.headerMeta', { arena: clip.arenaName, time: formatTimestamp(clip.createdAt), seconds: clip.durationSeconds })}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={clip.url}
            download={downloadFilename}
            className="mg-stream-control !min-h-9 !min-w-9 px-3 text-xs font-semibold"
            aria-label={t('desk.stream.in.downloadAria')}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('desk.stream.in.download')}</span>
          </a>
          <button
            type="button"
            className="mg-stream-control !min-h-9 !min-w-9 p-2"
            aria-label={t('desk.stream.in.closeAria')}
            data-autofocus=""
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Interactive Pan/Zoom Viewport */}
      <div
        ref={viewportRef}
        className={`relative flex-1 min-h-0 w-full overflow-hidden flex items-center justify-center bg-black ${
          zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        } touch-none`}
        onDoubleClick={handleDoubleClickViewport}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <video
          ref={videoRef}
          src={clip.url}
          playsInline
          className="max-h-full max-w-full object-contain pointer-events-none transition-transform duration-75"
          style={{
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (videoRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
              setDuration(videoRef.current.duration);
            }
          }}
          aria-label={t('desk.stream.ed.video', { label: clip.label })}
        />

        {/* Floating Zoom & Region Focus Controls Overlay */}
        <div className="pointer-events-auto absolute top-3 right-3 flex flex-wrap items-center gap-1.5 rounded-full bg-[rgb(var(--mg-header-deep)/0.85)] p-1 border border-[rgb(var(--mg-header-line))] backdrop-blur-sm max-w-[95%]">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`min-h-8 min-w-8 rounded-full px-2 text-xs font-bold transition-colors ${
                Math.abs(zoom - level) < 0.05
                  ? 'bg-amber-400 text-black shadow-sm'
                  : 'text-white hover:bg-white/10'
              }`}
              aria-label={t('desk.stream.in.zoomAria', { level })}
              aria-pressed={Math.abs(zoom - level) < 0.05}
              onClick={() => handleZoomChange(level)}
            >
              {level}x
            </button>
          ))}
          {zoom > 1 && (
            <button
              type="button"
              className="flex items-center gap-1 min-h-8 rounded-full px-2.5 text-xs font-semibold text-amber-300 hover:bg-white/10"
              aria-label={t('desk.stream.in.resetView')}
              onClick={handleResetView}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('desk.stream.in.resetView')}</span>
            </button>
          )}

          {/* 1-Tap Arena Region Focus Pills */}
          <div className="h-4 w-px bg-white/20 mx-0.5 hidden sm:block" />
          <button
            type="button"
            className="min-h-8 rounded-full px-2 text-[11px] font-semibold text-white/90 hover:bg-white/10"
            aria-label={t('desk.stream.in.focusLeftAria')}
            onClick={() => handleFocusRegion('left')}
          >
            {t('desk.stream.in.focusLeft')}
          </button>
          <button
            type="button"
            className="min-h-8 rounded-full px-2 text-[11px] font-semibold text-white/90 hover:bg-white/10"
            aria-label={t('desk.stream.in.focusCentreAria')}
            onClick={() => handleFocusRegion('centre')}
          >
            {t('desk.stream.in.centre')}
          </button>
          <button
            type="button"
            className="min-h-8 rounded-full px-2 text-[11px] font-semibold text-white/90 hover:bg-white/10"
            aria-label={t('desk.stream.in.focusRightAria')}
            onClick={() => handleFocusRegion('right')}
          >
            {t('desk.stream.in.focusRight')}
          </button>
        </div>
      </div>

      {/* Scrubber & Controls Section */}
      <div className="flex flex-col gap-2.5 border-t border-[rgb(var(--mg-header-line))] bg-[rgb(var(--mg-header-deep)/0.95)] px-4 py-3">
        {/* Scrubber Slider with Keyframe Markers */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="min-w-[48px] text-right">{formatVideoTime(currentTime)}</span>
          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              aria-label={t('desk.stream.in.scrubber')}
              min={0}
              max={duration}
              step={0.05}
              value={currentTime}
              onChange={handleSeek}
              className="w-full accent-amber-400 cursor-pointer h-1.5 rounded-lg bg-white/20"
            />
            {duration > 0 &&
              followKeyframes.map((k) => (
                <span
                  key={`${k.timeSec}-${k.zoom}`}
                  data-testid="follow-keyframe-dot"
                  className="absolute pointer-events-none text-amber-300 text-[10px] -translate-x-1/2 -top-2.5"
                  style={{
                    left: `${Math.max(0, Math.min(100, (k.timeSec / duration) * 100))}%`,
                  }}
                  title={t('desk.stream.in.keyframeAt', { time: k.timeSec })}
                >
                  ◆
                </span>
              ))}
          </div>
          <span className="min-w-[48px] text-[rgb(var(--mg-header-sub))]">
            {formatVideoTime(duration)}
          </span>
        </div>

        {/* Trim Controls & Slow-Motion Scrubber Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Play/Pause & Frame Step Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="mg-stream-control !min-h-10 !min-w-10 !rounded-xl"
              aria-label={isPlaying ? t('desk.stream.in.pauseAria') : t('desk.stream.in.playAria')}
              onClick={togglePlay}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Play className="h-5 w-5 ml-0.5" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              className="mg-stream-control !min-h-10 px-3 text-xs font-bold !rounded-xl"
              aria-label={t('desk.stream.in.stepBack')}
              onClick={() => stepFrame(-0.1)}
            >
              -0.1s
            </button>
            <button
              type="button"
              className="mg-stream-control !min-h-10 px-3 text-xs font-bold !rounded-xl"
              aria-label={t('desk.stream.in.stepForward')}
              onClick={() => stepFrame(0.1)}
            >
              +0.1s
            </button>
          </div>

          {/* Speed Pills */}
          <div className="flex items-center gap-1.5 rounded-xl bg-black/40 p-1 border border-white/10">
            {PLAYBACK_SPEEDS.map(({ rate, label }) => (
              <button
                key={rate}
                type="button"
                className={`min-h-8 rounded-lg px-2.5 text-xs font-bold transition-colors ${
                  playbackRate === rate
                    ? 'bg-amber-400 text-black shadow-sm'
                    : 'text-white hover:bg-white/10'
                }`}
                aria-label={t('desk.stream.in.speedAria', { rate })}
                aria-pressed={playbackRate === rate}
                onClick={() => handleSpeedChange(rate)}
              >
                <span>{rate}x</span>{' '}
                <span className="hidden sm:inline text-[10px] opacity-80">{t(label)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* In/Out Trim Controls & Range Sliders */}
        <div className="flex flex-col gap-2 rounded-xl bg-black/40 p-2.5 border border-white/10 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold text-white/90">
              <Scissors className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span>
                {t('desk.stream.in.trimmed', { start: formatVideoTime(trimStart), end: formatVideoTime(trimEnd), length: (trimEnd - trimStart).toFixed(1) })}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="mg-stream-control !min-h-7 px-2 text-[11px] font-semibold"
                aria-label={t('desk.stream.in.setStartAria')}
                onClick={handleSetTrimStart}
              >
                {t('desk.stream.in.setStart')}
              </button>
              <button
                type="button"
                className="mg-stream-control !min-h-7 px-2 text-[11px] font-semibold"
                aria-label={t('desk.stream.in.setEndAria')}
                onClick={handleSetTrimEnd}
              >
                {t('desk.stream.in.setEnd')}
              </button>
              <button
                type="button"
                className="mg-stream-control !min-h-7 px-2 text-[11px] font-semibold text-white/70 hover:text-white"
                aria-label={t('desk.stream.in.resetTrimAria')}
                onClick={handleResetTrim}
              >
                {t('desk.stream.in.resetTrim')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10px] text-[rgb(var(--mg-header-sub))]">
                {t('desk.stream.in.trimStart')}
              </span>
              <input
                type="range"
                aria-label={t('desk.stream.in.trimStart')}
                min={0}
                max={Math.max(0, trimEnd - 0.1)}
                step={0.1}
                value={trimStart}
                onChange={handleTrimStartChange}
                className="flex-1 accent-amber-400 cursor-pointer h-1.5 rounded-lg bg-white/20"
              />
              <span className="w-10 text-right font-mono text-[10px] text-white/80">
                {t('desk.stream.in.seconds', { value: trimStart.toFixed(1) })}
              </span>
            </label>

            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10px] text-[rgb(var(--mg-header-sub))]">
                {t('desk.stream.in.trimEnd')}
              </span>
              <input
                type="range"
                aria-label={t('desk.stream.in.trimEnd')}
                min={Math.min(duration, trimStart + 0.1)}
                max={duration}
                step={0.1}
                value={trimEnd}
                onChange={handleTrimEndChange}
                className="flex-1 accent-amber-400 cursor-pointer h-1.5 rounded-lg bg-white/20"
              />
              <span className="w-10 text-right font-mono text-[10px] text-white/80">
                {t('desk.stream.in.seconds', { value: trimEnd.toFixed(1) })}
              </span>
            </label>
          </div>
        </div>

        {/* Follow Zoom ("Follow-Cam") & Snapshot Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/40 p-2 border border-white/10 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 font-semibold text-amber-300 mr-1 text-[11px]">
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('desk.stream.in.followZoom')}</span>
            </span>

            <button
              type="button"
              className={`mg-stream-control !min-h-7 px-2.5 text-[11px] font-semibold transition-colors ${
                isRecordingFollow
                  ? '!bg-red-500 !text-white border-red-400 animate-pulse'
                  : ''
              }`}
              aria-label={t('desk.stream.in.recordAria')}
              aria-pressed={isRecordingFollow}
              onClick={() => {
                const next = !isRecordingFollow;
                setIsRecordingFollow(next);
                if (next) setFollowEnabled(true);
              }}
            >
              {t('desk.stream.in.record')}
            </button>

            <button
              type="button"
              className="mg-stream-control !min-h-7 px-2 text-[11px] font-semibold"
              aria-label={t('desk.stream.in.addKeyframeAria')}
              onClick={handleAddKeyframe}
            >
              <Plus className="h-3 w-3 mr-0.5 inline" aria-hidden="true" />
              {t('desk.stream.in.keyframe')}
            </button>

            {followKeyframes.length > 0 && (
              <button
                type="button"
                className="mg-stream-control !min-h-7 px-2 text-[11px] font-semibold text-red-300 hover:text-red-200"
                aria-label={t('desk.stream.in.clearFollowAria')}
                onClick={handleClearFollow}
              >
                {t('desk.stream.in.clearFollow', { count: followKeyframes.length })}
              </button>
            )}

            <button
              type="button"
              className="mg-stream-control !min-h-7 px-2.5 text-[11px] font-semibold !text-amber-300 hover:!bg-amber-400/20"
              aria-label={t('desk.stream.in.photoAria')}
              onClick={handlePhotoFinishSnapshot}
            >
              {t('desk.stream.in.photoButton')}
            </button>
          </div>

          <div className="flex items-center gap-1 text-[10px] text-[rgb(var(--mg-header-sub))]">
            <span>{t('desk.stream.in.doubleTap')}</span>
          </div>
        </div>
      </div>

      {/* Photo Finish Snapshot: a toast when it worked, a problem strip when it didn't */}
      {photoProblem && (
        <div className="pointer-events-auto fixed bottom-20 left-3 right-3 z-[120] mx-auto max-w-md">
          <Notice actionLabel={t('common.tryAgain')} onAction={handlePhotoFinishSnapshot}>{photoProblem}</Notice>
        </div>
      )}
      {photoToast.node}

      <ReplayPreparation {...preparation} />
      {/* Post-Review Decision Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--mg-header-line))] bg-[rgb(var(--mg-header-deep))] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="mg-stream-control !min-h-10 px-4 text-xs font-bold !rounded-xl !bg-amber-400 !text-black hover:!bg-amber-300 transition-colors"
            aria-label={t('desk.stream.in.saveHighlightAria')}
            disabled={preparation.progress !== null}
            onClick={handleSaveHighlight}
          >
            <Star className="h-4 w-4 mr-1.5 fill-black" aria-hidden="true" />
            <span>{t('desk.stream.in.saveHighlight')}</span>
          </button>
          <button
            type="button"
            className="mg-stream-control !min-h-10 px-4 text-xs font-semibold !rounded-xl text-red-300 hover:!bg-red-500/20 hover:text-red-200 transition-colors"
            aria-label={t('desk.stream.in.removeAria')}
            onClick={handleRemoveLineReview}
          >
            <Trash2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
            <span>{t('desk.stream.in.remove')}</span>
          </button>
        </div>

        <button
          type="button"
          className="mg-stream-control !min-h-10 px-4 text-xs font-semibold !rounded-xl"
          aria-label={t('desk.stream.in.replayClipAria')}
          onClick={handleReplayClip}
        >
          <RotateCcw className="h-4 w-4 mr-1.5" aria-hidden="true" />
          <span>{t('desk.stream.in.replayClip')}</span>
        </button>
      </div>

      {/* Multi-Race Saved Clips Strip */}
      {clips && clips.length > 1 && (
        <div
          role="region"
          aria-label={t('desk.stream.in.savedClips')}
          className="border-t border-[rgb(var(--mg-header-line))] bg-[rgb(var(--mg-header-deep)/0.9)] px-4 py-2"
        >
          <div className="text-[11px] font-semibold text-[rgb(var(--mg-header-sub))] mb-1.5">
            {t('desk.stream.in.raceClips', { count: clips.length })}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {clips.map((c) => {
              const isSelected = c.id === clip.id;
              return (
                <div
                  key={c.id}
                  className={`group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors cursor-pointer shrink-0 ${
                    isSelected
                      ? 'border-amber-400 bg-amber-400/15 text-white'
                      : 'border-white/15 bg-white/5 text-white/80 hover:border-white/40 hover:text-white'
                  }`}
                  onClick={() => onSelectClip?.(c)}
                >
                  <button
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    className="flex flex-col text-left"
                    onClick={(e) => { e.stopPropagation(); onSelectClip?.(c); }}
                  >
                    <span className="font-semibold truncate max-w-[140px]">{c.label}</span>
                    <span className="text-[10px] text-[rgb(var(--mg-header-sub))]">
                      {t('desk.stream.in.clipMetaShort', { arena: c.arenaName, seconds: c.durationSeconds })}
                    </span>
                  </button>

                  {onDeleteClip && (
                    <button
                      type="button"
                      className="rounded p-1 text-white/50 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                      aria-label={t('desk.stream.in.deleteClip', { label: c.label })}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteClip(c.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export function SavedReplaysDrawer(props: SavedReplaysDrawerProps) {
  return props.open ? <SavedReplaysDialog {...props} /> : null;
}

function SavedReplaysDialog({
  competitionId,
  open,
  onClose,
  onSelectClip,
  onDeleteClip,
  onCaptureBufferClip,
  bufferedSeconds,
}: SavedReplaysDrawerProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose, 'button[data-autofocus]');
  const [clips, setClips] = useState<SavedReplayClip[]>(() => getSavedReplays(competitionId));

  useEffect(() => {
    if (!open) return;
    const update = () => setClips(getSavedReplays(competitionId));
    update();
    return subscribeSavedReplays(update);
  }, [open, competitionId]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('desk.stream.in.drawerTitle')}
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm mg-font"
      onClick={onClose}
    >
      <div
        className="w-[min(94vw,42rem)] max-h-[86vh] rounded-2xl border border-[rgb(var(--mg-header-line))] bg-[rgb(var(--mg-header-deep)/0.96)] text-white p-5 shadow-2xl flex flex-col gap-4 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[rgb(var(--mg-header-line))] pb-3">
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-amber-400" aria-hidden="true" />
            <h2 className="text-lg font-bold">{t('desk.stream.in.drawerHeading')}</h2>
          </div>
          <button
            type="button"
            className="mg-stream-control !min-h-9 !min-w-9 p-1.5"
            aria-label={t('desk.stream.in.closeDrawer')}
            data-autofocus=""
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {onCaptureBufferClip && (
          <div className="rounded-xl border border-white/15 bg-black/40 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-[rgb(var(--mg-header-sub))]">
              <span className="font-semibold text-white">{t('desk.stream.in.buffer')}</span>
              <span>{bufferedSeconds !== undefined ? t('desk.stream.in.buffered', { seconds: bufferedSeconds }) : t('desk.stream.in.ready')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { secs: 15, label: t('desk.stream.in.saveLast15') },
                { secs: 30, label: t('desk.stream.in.saveLast30') },
                { secs: 60, label: t('desk.stream.in.saveLast1m') },
                { secs: 300, label: t('desk.stream.in.saveLast5m') },
                { secs: 1800, label: t('desk.stream.in.saveFull') },
              ].map(({ secs, label }) => (
                <button
                  key={secs}
                  type="button"
                  className="mg-stream-control !min-h-9 px-3 text-xs font-semibold"
                  onClick={() => onCaptureBufferClip(secs)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {clips.length === 0 ? (
          <p className="text-sm text-[rgb(var(--mg-header-sub))] py-8 text-center">
            {t('desk.stream.in.noSaved')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {clips.map((clip) => (
              <div
                key={clip.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:border-amber-400/50 transition-colors cursor-pointer"
                onClick={() => {
                  onSelectClip(clip);
                  onClose();
                }}
              >
                <div className="min-w-0 flex-1">
                  <button type="button" className="block max-w-full truncate text-left font-semibold">{clip.label}</button>
                  {clip.storageWarning && <Notice role={null} className="my-1">{clip.storageWarning}</Notice>}
                  <div className="text-xs text-[rgb(var(--mg-header-sub))]">
                    {t('desk.stream.in.clipMeta', { arena: clip.arenaName, seconds: clip.durationSeconds, time: formatTimestamp(clip.createdAt) })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={clip.url}
                    download={`${clip.label.replace(/\s+/g, '_')}.${clip.mimeType.includes('mp4') ? 'mp4' : 'webm'}`}
                    className="mg-stream-control !min-w-8 !min-h-8 p-1.5 text-xs"
                    aria-label={t('desk.stream.in.downloadClip', { label: clip.label })}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </a>
                  {onDeleteClip && (
                    <button
                      type="button"
                      className="mg-stream-control !min-h-8 !min-w-8 p-1.5 text-xs hover:!bg-red-600/80"
                      aria-label={t('desk.stream.in.deleteClip', { label: clip.label })}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteClip(clip.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SavedReplaysButton({
  competitionId,
  arenaName,
  onSelectClip,
  className = '',
}: SavedReplaysButtonProps) {
  const t = useT();
  useEffect(() => { void loadPersistedReplays(competitionId); }, [competitionId]);
  const [clips, setClips] = useState<SavedReplayClip[]>(() => {
    const all = getSavedReplays(competitionId);
    return arenaName ? all.filter((c) => c.arenaName === arenaName) : all;
  });

  useEffect(() => {
    const update = () => {
      const all = getSavedReplays(competitionId);
      const filtered = arenaName ? all.filter((c) => c.arenaName === arenaName) : all;
      setClips(filtered);
    };
    update();
    return subscribeSavedReplays(update);
  }, [competitionId, arenaName]);

  if (clips.length === 0) {
    return null;
  }

  const handleClick = () => {
    const mostRecent = clips[clips.length - 1];
    onSelectClip(mostRecent);
  };

  return (
    <button
      type="button"
      className={`mg-stream-control text-xs font-semibold px-3 py-1.5 gap-1.5 ${className}`}
      onClick={handleClick}
      aria-label={t('desk.stream.in.savedButton', { count: clips.length })}
    >
      <Film className="h-4 w-4" aria-hidden="true" />
      <span>{t('desk.stream.in.replaysButton', { count: clips.length })}</span>
    </button>
  );
}
