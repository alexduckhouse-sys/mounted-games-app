import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { Headphones, Maximize, MoreHorizontal, PictureInPicture2, Play, Radio, RotateCcw, VolumeX, X } from 'lucide-react';
import type { ChatMessage, LiveStream, StreamQualityRid } from '../../types';
import type { MessageKey } from '../../i18n/en';
import { useReplayPreparation } from '../../live/useReplayPreparation';
import { ReplayPreparation } from './ReplayPreparation';
import { createReplayBuffer, getSavedReplays, removeSavedReplay, type SavedReplayClip } from '../../live/replayBuffer';
import { splitStreamMessage, syncVideoLiveEdge } from '../../live/streamViewer';
import { ReplayInspector, SavedReplaysButton } from './ReplayInspector';
import { StreamOverlays } from './StreamOverlays';
import { useReplayWipe } from './ReplayWipe';
import { useOverlay } from '../../hooks/useOverlay';
import { useT } from '../../i18n/LanguageContext';

const QUALITY_TIERS = [
  { rid: 'f', label: 'HD', title: 'teams.stream.qualityHd' },
  { rid: 'h', label: '540p', title: 'teams.stream.qualityMid' },
  { rid: 'q', label: '360p', title: 'teams.stream.qualityLow' },
] as const satisfies readonly { rid: StreamQualityRid; label: string; title: MessageKey }[];

export function StreamPlayer({ media, stream, label, reconnecting = false, message, announcement, captionBar = false, quality = 'f', onQuality, audioOnly, onAudioOnly, onSyncLive, enableDvr = true }: {
  media: MediaStream | null; stream: LiveStream; label: string | null; reconnecting?: boolean; message?: string | null;
  announcement?: { message: ChatMessage; receivedAt: number }; captionBar?: boolean;
  quality?: StreamQualityRid; onQuality?: (rid: StreamQualityRid) => void;
  enableDvr?: boolean;
  audioOnly?: boolean; onAudioOnly?: (audioOnly: boolean) => void; onSyncLive?: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const replayBufferRef = useRef<ReturnType<typeof createReplayBuffer> | null>(null);
  const [full, setFull] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const [muted, setMuted] = useState(true);
  const [needsPlay, setNeedsPlay] = useState(false);
  const replayPreparation = useReplayPreparation();
  const [localAudioOnly, setLocalAudioOnly] = useState(false);
  const [activeReplay, setActiveReplay] = useState<SavedReplayClip | null>(null);
  const { look } = useOverlay();
  const { wipe, layer: wipeLayer } = useReplayWipe(look.accent, look.background, { sponsor: true });
  // Into a replay, or from one clip to another, the band sweeps over the change; closing sweeps back to live.
  const showReplay = (clip: SavedReplayClip) => wipe({ title: 'Replay', detail: clip.label }, () => setActiveReplay(clip));
  const backToLive = () => wipe({ title: 'Live' }, () => setActiveReplay(null));
  const isAudioOnly = audioOnly ?? localAudioOnly;
  const soundOff = muted || stream.status === 1 || stream.audioMuted;
  useEffect(() => {
    if (!media) return;
    const timer = setInterval(() => {
      syncVideoLiveEdge(videoRef.current);
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [media]);
  function toggleAudioOnly() {
    const next = !isAudioOnly;
    setLocalAudioOnly(next);
    media?.getVideoTracks().forEach((track) => { track.enabled = !next; });
    onAudioOnly?.(next);
  }
  function handleSyncLive() {
    syncVideoLiveEdge(videoRef.current, true);
    onSyncLive?.();
  }
  useEffect(() => {
    if (!media || !enableDvr) {
      replayBufferRef.current?.dispose();
      replayBufferRef.current = null;
      return;
    }
    const buf = createReplayBuffer({
      competitionId: stream.competitionId,
      streamId: stream.id,
      arenaName: stream.arenaName,
      windowSeconds: 60,
    });
    buf.start(media);
    replayBufferRef.current = buf;
    return () => { buf.dispose(); replayBufferRef.current = null; };
  }, [media, stream.competitionId, stream.id, stream.arenaName, enableDvr]);
  function triggerInstantReplay() {
    const buffer = replayBufferRef.current;
    if (buffer) void replayPreparation.prepare((options) => buffer.saveClip(label || `${stream.arenaName} -15s`, { ...options, durationSeconds: 15 }), showReplay);
  }
  function togglePip() {
    const video = videoRef.current as (HTMLVideoElement & {
      requestPictureInPicture?: () => Promise<unknown>;
      webkitSetPresentationMode?: (mode: string) => void;
    }) | null;
    if (!video) return;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture?.().catch(() => {});
    } else if (video.requestPictureInPicture) {
      void video.requestPictureInPicture().catch(() => {});
    } else if (video.webkitSetPresentationMode) {
      try { video.webkitSetPresentationMode('picture-in-picture'); } catch { /* ignore */ }
    }
  }
  useEffect(() => {
    const video = videoRef.current!;
    let cancelled = false;
    // Safari needs these properties before srcObject, even when JSX supplied the attributes.
    // Attach muted so autoplay is allowed; the effect below applies the viewer's sound choice.
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.srcObject = media;
    if (media) void video.play().then(() => { if (!cancelled) setNeedsPlay(false); }).catch(() => { if (!cancelled) setNeedsPlay(true); });
    return () => { cancelled = true; video.srcObject = null; };
  }, [media, full]);
  useEffect(() => { videoRef.current!.muted = soundOff; }, [soundOff, media, full]);
  // Unmute inside the tap itself: iPhone Safari pauses a video unmuted outside a user gesture.
  function unmute() {
    const video = videoRef.current!;
    video.muted = false;
    if (video.paused) void video.play().catch(() => setNeedsPlay(true));
    setMuted(false);
  }
  const leave = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false; setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    screen.orientation?.unlock?.();
    restoreFocus.current?.focus();
  }, []);
  const close = useCallback(() => {
    if (openRef.current) { leave(); window.history.back(); }
  }, [leave]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const back = () => leave();
    const nativeExit = () => { if (!document.fullscreenElement) close(); };
    window.addEventListener('popstate', back);
    document.addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', nativeExit);
    return () => {
      window.removeEventListener('popstate', back); document.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', nativeExit);
      if (openRef.current) { leave(); window.history.back(); }
    };
  }, [close, leave]);
  useEffect(() => {
    if (!full) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    containerRef.current?.querySelector<HTMLButtonElement>('[data-stream-close]')?.focus();
    if (!/iPhone|iPod/.test(navigator.userAgent)) {
      void containerRef.current?.requestFullscreen?.().then(() => {
        const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
        if (openRef.current) return orientation?.lock?.('landscape');
      }).catch(() => {});
    }
    return () => { document.body.style.overflow = previous; };
  }, [full]);
  function open() {
    if (openRef.current) return;
    restoreFocus.current = document.activeElement as HTMLElement;
    window.history.pushState({ ...window.history.state, streamFullscreen: true }, '');
    openRef.current = true; setFull(true);
  }
  const player = <div ref={containerRef} className={`mg-font overflow-hidden bg-[rgb(var(--mg-header-deep))] text-white ${full ? 'fixed inset-0 z-[100]' : `relative aspect-video ${captionBar ? '' : 'rounded-xl'}`}`} role={full ? 'dialog' : undefined} aria-modal={full || undefined} aria-label={full ? t('teams.stream.liveVideo') : undefined}>
    <video ref={videoRef} muted={soundOff} playsInline autoPlay className={`h-full w-full object-contain ${isAudioOnly ? 'opacity-0' : ''}`} onClick={open} aria-label={`${stream.arenaName}, ${stream.angleName}`} />
    {isAudioOnly && (
      <div role="status" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[rgb(var(--mg-header-deep)/0.92)] text-center">
        <Headphones className="h-7 w-7 text-amber-300" aria-hidden="true" />
        <p className="text-sm font-bold">{t('teams.stream.audioOnly')}</p>
        <p className="text-xs text-white/75">{t('teams.stream.audioOnlyNote')}</p>
      </div>
    )}
    <StreamOverlays stream={stream} label={label} reconnecting={reconnecting} muted={muted} onSound={unmute} announcement={announcement} hideCaption={captionBar && !full}>
      <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-1.5">
        <div id={moreId} className={`${moreOpen ? 'mg-stream-glass absolute right-0 top-11 z-10 flex flex-col items-stretch gap-1.5 rounded-xl p-2' : 'hidden'} sm:contents`}>
        {onQuality && (
          <div role="group" aria-label={t('teams.stream.quality')} className="mg-stream-glass flex items-center gap-0.5 rounded-full p-0.5 text-[11px] font-bold">
            {QUALITY_TIERS.map((tier) => (
              <button
                key={tier.rid}
                type="button"
                title={t(tier.title)}
                aria-label={t('teams.stream.qualityTier', { tier: tier.label })}
                aria-pressed={quality === tier.rid}
                className={`rounded-full px-2 py-0.5 transition-colors ${quality === tier.rid ? 'bg-amber-400 text-black' : 'text-white/85 hover:text-white'}`}
                onClick={() => onQuality(tier.rid)}
              >
                {tier.label}
              </button>
            ))}
          </div>
        )}
        {media && (
          <button
            type="button"
            aria-label={t('teams.stream.audioOnly')}
            aria-pressed={isAudioOnly}
            className={`mg-stream-control !min-h-8 !rounded-full px-2.5 text-xs font-bold ${isAudioOnly ? '!bg-amber-400 !text-black' : ''}`}
            onClick={toggleAudioOnly}
          >
            <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('teams.stream.audioOnly')}</span>
          </button>
        )}
        {media && (
          <button
            type="button"
            aria-label={t('teams.stream.syncLive')}
            className="mg-stream-control !min-h-8 !rounded-full px-2.5 text-xs font-bold"
            onClick={handleSyncLive}
          >
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('teams.stream.syncLive')}</span>
          </button>
        )}
        {media && (
          <button
            type="button"
            className="mg-stream-control !min-h-8 !min-w-8"
            aria-label={t('teams.stream.pip')}
            onClick={togglePip}
          >
            <PictureInPicture2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        </div>
        {media && enableDvr && (
          <button
            type="button"
            className="mg-stream-control !min-h-8 !rounded-full px-2.5 text-xs font-bold"
            aria-label={t('teams.stream.instantReplay')}
            onClick={triggerInstantReplay}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>-15s</span>
          </button>
        )}
        <SavedReplaysButton
          competitionId={stream.competitionId}
          arenaName={stream.arenaName}
          onSelectClip={showReplay}
        />
        <button type="button" className="mg-stream-control !min-h-8 !min-w-8 sm:hidden" aria-label={t('teams.stream.more')} aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></button>
        {(full || !captionBar) && <button className="mg-stream-control" data-stream-close={full || undefined} aria-label={full ? t('teams.stream.closeFull') : t('teams.stream.openFull')} onClick={full ? close : open}>{full ? <X /> : <Maximize />}</button>}
      </div>
      {needsPlay && <button className="mg-stream-control pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 !rounded-xl px-4" onClick={() => { void videoRef.current!.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true)); }}><Play /> {t('teams.stream.play')}</button>}
      {message && (() => {
        const { title, body } = splitStreamMessage(message);
        return title
          ? <div role="status" className="mg-stream-glass absolute left-3 right-3 top-1/2 p-3 text-center"><strong className="block text-lg font-bold">{title}</strong><span className="block text-sm">{body}</span></div>
          : <p role="status" className="mg-stream-glass absolute left-3 right-3 top-1/2 p-3 text-center">{message}</p>;
      })()}
    </StreamOverlays>
    <div className="absolute bottom-12 left-3 right-3"><ReplayPreparation {...replayPreparation} /></div>
    <AnimatePresence>
      {activeReplay && (
        <ReplayInspector
          key="replay"
          clip={activeReplay}
          clips={getSavedReplays(stream.competitionId)}
          onSelectClip={showReplay}
          onDeleteClip={(id) => {
            removeSavedReplay(id);
            const remaining = getSavedReplays(stream.competitionId);
            setActiveReplay(remaining.at(-1) ?? null);
          }}
          onClose={backToLive}
        />
      )}
    </AnimatePresence>
    {wipeLayer}
  </div>;
  const showSound = stream.hasAudio && !stream.audioMuted && stream.status !== 1 && muted;
  return full ? <><div className="aspect-video rounded-xl bg-[rgb(var(--mg-header-deep))]" />{createPortal(player, document.body)}</> : captionBar ? <div className="live-stream-frame mg-card overflow-hidden">{player}<div className="live-stream-caption"><span className="mg-badge mg-badge-live">{t('common.live')}</span><strong>{label || `${stream.arenaName} · ${stream.angleName}`}</strong>{showSound && <button type="button" className="live-caption-sound" aria-label={t('teams.stream.tapForSound')} onClick={unmute}><VolumeX aria-hidden="true" /></button>}<button type="button" onClick={open}>{t('teams.stream.fullScreen')}</button></div></div> : player;
}
