import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useT } from '../../../i18n/LanguageContext';
import { renderTrimmedFollowClip } from '../../../components/stream/ReplayInspector';
import { ReplayPreparation } from '../../../components/stream/ReplayPreparation';
import { clockLabel, followFromKeys, frameAt, frameRect, keysFromFollow, putKey, zoomLabel, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, type FrameKey } from '../../../lib/replayFrame';
import { removeSavedReplay, updateReplayTrim, type SavedReplayClip } from '../../../live/replayBuffer';
import { useReplayPreparation } from '../../../live/useReplayPreparation';

const STEP_SECONDS = 0.1;

/**
 * Watches or edits one replay clip. Watching just plays the whole video. Editing adds the frame the replay follows (drag
 * it, then add keyframes as the riders move), the start and end, zoom and slow motion, and saves a new clip with the
 * movement baked in. Slow motion changes how fast it plays here only; the saved clip is full speed.
 */
export function ReplayEditor({ clip, editable, justMade, onClose, onCancelClip, onSaved }: {
  clip: SavedReplayClip;
  editable: boolean;
  justMade: boolean;
  onClose: () => void;
  onCancelClip?: (clipId: string) => void;
  onSaved?: (clip: SavedReplayClip) => void;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const preparation = useReplayPreparation();
  const [duration, setDuration] = useState(clip.durationSeconds || 1);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [start, setStart] = useState(clip.trimStartSec ?? clip.trimStartSeconds ?? 0);
  const [end, setEnd] = useState(clip.trimEndSec ?? clip.trimEndSeconds ?? (clip.durationSeconds || 1));
  const [keys, setKeys] = useState<FrameKey[]>(() => keysFromFollow(clip.followKeyframes));
  const [dragging, setDragging] = useState<{ x: number; y: number; frameX: number; frameY: number } | null>(null);

  const frame = frameAt(keys, now);
  const rect = frameRect(frame);
  const viewport = () => ({ width: stage.current?.clientWidth || undefined, height: stage.current?.clientHeight || undefined });

  // Keep the trim and framing with the clip, as the replay viewer does.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (editable) updateReplayTrim(clip.id, start, end, followFromKeys(keys, viewport()));
  }, [clip.id, editable, start, end, keys]);

  const seek = useCallback((seconds: number) => {
    const target = Math.min(duration, Math.max(0, seconds));
    if (video.current) video.current.currentTime = target;
    setNow(target);
  }, [duration]);

  // Follow the video while it plays, and stop at the end of the cut.
  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    const tick = () => {
      const el = video.current;
      if (el) {
        const stopAt = editable ? end : duration;
        if (el.currentTime >= stopAt || el.ended) {
          el.pause();
          setPlaying(false);
          setNow(stopAt);
          return;
        }
        setNow(el.currentTime);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, editable, end, duration]);

  useEffect(() => { if (video.current) video.current.playbackRate = slow ? 0.5 : 1; }, [slow]);

  function togglePlay() {
    const el = video.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    if (editable && (el.currentTime >= end || el.currentTime < start)) seek(start);
    else if (el.currentTime >= duration) seek(0);
    void el.play().then(() => setPlaying(true), () => setPlaying(false));
  }

  function pause() { video.current?.pause(); setPlaying(false); }
  const nudge = (seconds: number) => { pause(); seek((video.current?.currentTime ?? now) + seconds); };
  const setKey = (patch: Partial<{ x: number; y: number; z: number }>) => { pause(); setKeys((current) => putKey(current, now, patch)); };

  function onDragStart(event: PointerEvent<HTMLElement>) {
    event.preventDefault();
    pause();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not every browser (or test) allows it */ }
    setDragging({ x: event.clientX, y: event.clientY, frameX: frame.x, frameY: frame.y });
  }
  function onDragMove(event: PointerEvent<HTMLElement>) {
    const box = stage.current?.getBoundingClientRect();
    if (!dragging || !box || !box.width || !box.height) return;
    setKeys((current) => putKey(current, now, {
      x: dragging.frameX + ((event.clientX - dragging.x) / box.width) * 100,
      y: dragging.frameY + ((event.clientY - dragging.y) / box.height) * 100,
    }));
  }
  const onDragEnd = () => setDragging(null);
  function onFrameKey(event: KeyboardEvent<HTMLElement>) {
    const step = 2;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!move) return;
    event.preventDefault();
    setKey({ x: frame.x + move[0], y: frame.y + move[1] });
  }

  function saveClip() {
    pause();
    const size = viewport();
    void preparation.prepare((options) => renderTrimmedFollowClip(video.current, clip, start, end, followFromKeys(keys, size),
      { zoom: 1, panX: 0, panY: 0, viewportWidth: size.width, viewportHeight: size.height }, options), (saved) => onSaved?.(saved));
  }
  function remove() {
    removeSavedReplay(clip.id);
    onClose();
  }

  const percent = (seconds: number) => `${(Math.min(duration, Math.max(0, seconds)) / duration) * 100}%`;
  const cutLength = Math.max(0, end - start);

  return (
    <div className="rp" role="region" aria-label={t('desk.stream.ed.region', { label: clip.label })}>
      <span className="rp-head"><span className="rp-name">{clip.label}</span><span className="rp-len">{editable ? t('desk.stream.ed.lengthCut', { cut: cutLength.toFixed(1), total: Math.round(duration) }) : t('desk.stream.ed.lengthWhole', { total: Math.round(duration) })}</span></span>

      <div className="rp-video" ref={stage} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerLeave={onDragEnd}>
        <video ref={video} src={clip.url} playsInline preload="auto" aria-label={t('desk.stream.ed.video', { label: clip.label })} className="rp-media"
          onLoadedMetadata={(event) => { const length = event.currentTarget.duration; if (Number.isFinite(length) && length > 0) setDuration(length); }}
          onEnded={() => setPlaying(false)} />
        {editable && (
          <span className="rp-frame" role="slider" tabIndex={0} aria-label={t('desk.stream.ed.framing')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frame.x)}
            aria-valuetext={t('desk.stream.ed.framingValue', { x: Math.round(frame.x), y: Math.round(frame.y), z: frame.z.toFixed(1) })} data-drag={dragging !== null}
            style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }}
            onPointerDown={onDragStart} onKeyDown={onFrameKey}><span className="rp-z">{zoomLabel(frame.z)}</span></span>
        )}
      </div>

      <div className="rp-bar">
        <span aria-hidden="true" className="rp-track" />
        {editable && <span aria-hidden="true" className="rp-band" style={{ left: percent(start), width: `${((end - start) / duration) * 100}%` }} />}
        {editable && keys.map((key) => <span key={key.t} aria-hidden="true" className="rp-key" style={{ left: percent(key.t) }} />)}
        <input type="range" min={0} max={100} step={0.5} value={(now / duration) * 100} aria-label={t('desk.stream.ed.playhead')} className="rp-range"
          onChange={(event) => { pause(); seek((Number(event.target.value) / 100) * duration); }} />
      </div>
      <span className="rp-time"><span>{clockLabel(now)}</span>{editable && <span>{t('desk.stream.ed.keyframes', { count: keys.length })}</span>}<span>{clockLabel(duration)}</span></span>

      <div className="rp-ctl">
        <button type="button" className="rp-ib" aria-label={t('desk.stream.ed.back')} onClick={() => nudge(-STEP_SECONDS)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className="rp-play" aria-label={playing ? t('desk.stream.ed.pause') : t('desk.stream.ed.play')} onClick={togglePlay}>
          {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
        </button>
        <button type="button" className="rp-ib" aria-label={t('desk.stream.ed.forward')} onClick={() => nudge(STEP_SECONDS)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        <span className="rp-fill" />
        {editable && <button type="button" className="rp-pill" onClick={() => { if (now < end) setStart(now); }}>{t('desk.stream.ed.startHere')}</button>}
        {editable && <button type="button" className="rp-pill" onClick={() => { if (now > start) setEnd(now); }}>{t('desk.stream.ed.endHere')}</button>}
      </div>

      {editable && (
        <div className="rp-ctl">
          <span className="rp-lbl">{t('desk.stream.ed.zoom')}</span>
          <span className="rp-zoom">
            <button type="button" aria-label={t('desk.stream.ed.zoomOut')} disabled={frame.z <= MIN_ZOOM} onClick={() => setKey({ z: frame.z - ZOOM_STEP })}>−</button>
            <span>{zoomLabel(frame.z)}</span>
            <button type="button" aria-label={t('desk.stream.ed.zoomIn')} disabled={frame.z >= MAX_ZOOM} onClick={() => setKey({ z: frame.z + ZOOM_STEP })}>+</button>
          </span>
          <span className="rp-fill" />
          <button type="button" className="rp-pill" onClick={() => setKey({})}>{t('desk.stream.ed.addKeyframe')}</button>
          <button type="button" className="rp-pill" aria-pressed={slow} onClick={() => setSlow((on) => !on)}>{t('desk.stream.ed.slowMo')}</button>
        </div>
      )}

      <ReplayPreparation progress={preparation.progress} error={preparation.error} cancel={preparation.cancel} />

      <div className="rp-ctl rp-last">
        {justMade && onCancelClip && <button type="button" className="rp-link" onClick={() => { pause(); onCancelClip(clip.id); onClose(); }}>{t('desk.stream.ed.cancelClip')}</button>}
        <span className="rp-fill" />
        {editable && <button type="button" className="rp-pill" disabled={preparation.progress !== null} onClick={saveClip}>{t('desk.stream.ed.saveClip')}</button>}
        {editable && <button type="button" className="rp-link" onClick={() => setKeys([])}>{t('desk.stream.ed.resetFraming')}</button>}
        {editable && !justMade && <button type="button" className="rp-link" onClick={remove}>{t('desk.stream.ed.remove')}</button>}
        <button type="button" className="rp-pill" onClick={() => { pause(); onClose(); }}>{t('common.close')}</button>
      </div>
    </div>
  );
}
