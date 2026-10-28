import { useAudioLevel } from '../../hooks/useAudioLevel';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDialogFocus } from '../../components/useDialogFocus';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Eye, Film, Handshake, Layers, Lock, Megaphone, Mic, MicOff, Pause, Play, RefreshCw, SkipForward, Square, Wifi, Wind } from 'lucide-react';
import { api } from '../../api';
import { sponsorsFor } from '../../lib/sponsors';
import { SponsorOverlay } from '../../components/stream/SponsorOverlay';
import { readMessages, writeMessages } from '../../lib/overlayMessages';
import { DEFAULT_OVERLAY, parseLook } from '../../lib/overlays';
import { useReplayWipe } from '../../components/stream/ReplayWipe';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n/LanguageContext';
import { browserPublisherDependencies, createStreamPublisher, type PublisherSnapshot } from '../../live/streamPublisher';
import { useReplayPreparation } from '../../live/useReplayPreparation';
import { ReplayPreparation } from '../../components/stream/ReplayPreparation';
import { createReplayBuffer, getSavedReplays, hydrateSavedReplays, type ReplayBufferHandle, type SavedReplayClip } from '../../live/replayBuffer';
import { ReplayInspector, SavedReplaysButton, SavedReplaysDrawer } from '../../components/stream/ReplayInspector';
import { streamHeatLabel } from '../../lib/streams';
import { setBroadcasting } from '../../pwa';
import { LiveDataCardOverlay, ProducerBanner, type LiveOverlayCardMode } from '../../components/stream/OverlayExtras';
import { OverlayLayer, StreamNotice } from '../../components/stream/StreamOverlays';
import { SelectField } from '../../components/SelectField';
import { Notice } from '../../components/Notice';
import { PageProblem } from '../../components/PageProblem';
import { CameraLockButtons } from '../../components/stream/CameraLocks';
import { confirmDialog } from '../../components/ConfirmDialog';
import { usePageWidth } from '../../components/pageWidthState';
import type { StreamPublisher, StreamQualityPreset } from '../../types';

const DEFAULT_STREAM_LIMIT_SECONDS = 30 * 60;
const EXTEND_STREAM_SECONDS = 15 * 60;
const MAX_STREAM_LIMIT_SECONDS = 45 * 60;
const LOW_TIME_THRESHOLD_SECONDS = 5 * 60;
const QUALITY_PRESETS: StreamQualityPreset[] = ['auto', '360p', '480p', '720p', '1080p'];
const ON_AIR_QUALITY_OPTIONS: { preset: StreamQualityPreset }[] = [{ preset: 'auto' }, { preset: '720p' }, { preset: '480p' }];
const CAMERA_ZOOMS = [1, 2, 3] as const;

const DATA_CARD_OPTIONS: { mode: LiveOverlayCardMode; label: 'off' | 'toplist' | 'heat' | 'lanes' | 'next' }[] = [
  { mode: 'none', label: 'off' },
  { mode: 'toplist', label: 'toplist' },
  { mode: 'heat', label: 'heat' },
  { mode: 'lanes', label: 'lanes' },
  { mode: 'next', label: 'next' },
];

export function BroadcastPage() {
  usePageWidth('wide');
  const t = useT();
  const { competition, streamingEnabled } = useCompetition();
  const { canOrganise } = useAuth();
  // Any signed-in account reaches this page (a competition team member may film); the API makes the real check.
  if (!canOrganise(competition)) {
    return (
      <PageProblem title={t('desk.stream.bc.onlyTeam')} secondaryLabel={t('desk.stream.backToCompetition')} secondaryTo={`/competitions/${competition.id}`}>
        {t('desk.stream.bc.askAdd')}
      </PageProblem>
    );
  }
  if (!streamingEnabled) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-4">
        <p>{t('desk.stream.bc.notSetUp')}</p>
        <Link to={`/competitions/${competition.id}`} className="mg-btn mg-btn-secondary inline-flex">{t('desk.stream.backToCompetition')}</Link>
      </div>
    );
  }
  if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-4">
        <p>{t('desk.stream.bc.noBrowser')}</p>
        <Link to={`/competitions/${competition.id}`} className="mg-btn mg-btn-secondary inline-flex">{t('desk.stream.backToCompetition')}</Link>
      </div>
    );
  }
  return <BroadcastStudio key={competition.id} />;
}

function BroadcastStudio() {
  const t = useT();
  const { competition, streams, streamMessages, overlay, saveOverlay, scoreCards, lastStreamCommand } = useCompetition();
  const { user } = useAuth();
  const navigate = useNavigate();
  const publisher = useRef<ReturnType<typeof createStreamPublisher> | null>(null);
  const replayBuffer = useRef<ReplayBufferHandle | null>(null);
  const replayPreparation = useReplayPreparation();
  const prepareReplay = replayPreparation.prepare;
  const [replayStatus, setReplayStatus] = useState<{ retainedSeconds: number; warning?: string }>({ retainedSeconds: 0 });
  const lastScoredCard = useRef<string | null>(scoreCards?.at(-1)?.key ?? null);
  const [snapshot, setSnapshot] = useState<PublisherSnapshot>({ state: 'idle', media: null, streamId: null, viewerCount: 0, signal: 'good', audioMuted: false, hasAudio: false, error: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [searchParams] = useSearchParams();
  const paramArena = searchParams.get('arena')?.trim();
  const paramAngle = searchParams.get('angle')?.trim();
  const arenas = [...new Set(competition.sessions.map((session) => session.arenaName?.trim()).filter((name): name is string => !!name))];
  const [arena, setArena] = useState(paramArena || arenas[0] || '');
  const [angle, setAngle] = useState(paramAngle || 'Main camera');
  const [otherArena, setOtherArena] = useState(Boolean(paramArena && !arenas.includes(paramArena)) || arenas.length === 0);
  const [otherAngle, setOtherAngle] = useState(Boolean(paramAngle && !['Main camera', 'Finish line', 'Start line', 'Wide'].includes(paramAngle)));
  const [sound, setSound] = useState(true);
  const [windFilter, setWindFilter] = useState(false);
  const [qualityPreset, setQualityPreset] = useState<StreamQualityPreset>('1080p');
  const [cameraZoom, setCameraZoom] = useState<number>(1);
  const [screenDimmed, setScreenDimmed] = useState(false);
  const [inspectingClip, setInspectingClip] = useState<SavedReplayClip | null>(null);
  const [showReplayDrawer, setShowReplayDrawer] = useState(false);
  const [caption, setCaption] = useState('');
  const [editingCaption, setEditingCaption] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [limitSeconds, setLimitSeconds] = useState(DEFAULT_STREAM_LIMIT_SECONDS);
  const [showAnnounce, setShowAnnounce] = useState(false);
  const [announceText, setAnnounceText] = useState('');
  const [showOverlays, setShowOverlays] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const live = ['starting', 'live', 'paused', 'reconnecting'].includes(snapshot.state);
  const mic = useAudioLevel(snapshot.media, { isLive: live, muted: snapshot.audioMuted });
  const canControl = snapshot.state === 'live' || snapshot.state === 'paused';
  const currentStream = streams.find((stream) => stream.id === snapshot.streamId);
  const currentOverlay = overlay ?? DEFAULT_OVERLAY;
  const currentLook = (currentOverlay.look ?? {}) as Record<string, unknown>;
  const wipeLook = parseLook(currentOverlay.look);
  const { wipe, layer: wipeLayer } = useReplayWipe(wipeLook.accent, wipeLook.background);
  const showReplay = (clip: SavedReplayClip) => wipe({ title: 'Replay', detail: clip.label }, () => setInspectingClip(clip));
  const backToLive = () => wipe({ title: 'Live' }, () => setInspectingClip(null));
  const activeCardMode: LiveOverlayCardMode =
    currentLook.liveCard === 'toplist' || currentLook.liveCard === 'heat' || currentLook.liveCard === 'lanes' || currentLook.liveCard === 'next'
      ? currentLook.liveCard
      : 'none';
  const label = caption || streamHeatLabel(competition.sessions, arena) || `${arena} · ${angle}`;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const occupant = !live ? streams.find((stream) => stream.status !== 2 && same(stream.arenaName, arena) && same(stream.angleName, angle)) : undefined;
  const occupied = occupant !== undefined;
  const occupantId = occupant?.id;
  // Who is streaming there: asked for only when the angle you picked is taken, so the notice can name them.
  const [occupantNames, setOccupantNames] = useState<Record<number, string | null>>({});
  useEffect(() => {
    if (occupantId === undefined) return;
    let cancelled = false;
    api.get<StreamPublisher[]>(`/competitions/${competition.id}/streams/publishers`)
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data)) return;
        setOccupantNames((names) => ({ ...names, ...Object.fromEntries(data.map((row) => [row.streamId, row.startedByName?.trim() || null])) }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [competition.id, occupantId]);
  const occupantName = occupantId === undefined ? null : occupantNames[occupantId] ?? null;
  const arenaStreams = streams.filter((stream) => stream.status !== 2 && same(stream.arenaName, arena));

  useEffect(() => {
    void hydrateSavedReplays(competition.id);
    const next = createStreamPublisher(competition.id, browserPublisherDependencies());
    publisher.current = next;
    const unsubscribe = next.subscribe(() => setSnapshot(next.getSnapshot()));
    return () => { unsubscribe(); next.dispose(); setBroadcasting(false); };
  }, [competition.id]);

  // Once the camera is allowed, keep the camera and microphone lists current as devices are plugged in or out.
  const hasMedia = Boolean(snapshot.media);
  useEffect(() => {
    if (!hasMedia) return;
    return publisher.current?.watchDevices((cameras, microphones) => { setDevices(cameras); setMics(microphones); });
  }, [hasMedia]);

  // Attach 30-minute rolling replay buffer while live
  useEffect(() => {
    if (!live || !snapshot.media) {
      replayBuffer.current?.dispose();
      replayBuffer.current = null;
      return;
    }
    const handle = createReplayBuffer({
      competitionId: competition.id,
      arenaName: arena || 'Arena',
      windowSeconds: 1800,
      resolutionLabel: snapshot.captureResolution ?? 'HD',
      onStatus: setReplayStatus,
    });
    handle.start(snapshot.media);
    replayBuffer.current = handle;
    return () => {
      handle.dispose();
      if (replayBuffer.current === handle) replayBuffer.current = null;
    };
  }, [live, snapshot.media, competition.id, arena, snapshot.captureResolution]);

  // Remember card identity: the shared card queue is bounded, so its length eventually stops changing.
  useEffect(() => {
    const latest = scoreCards?.at(-1);
    if (!latest || latest.key === lastScoredCard.current) return;
    lastScoredCard.current = latest.key;
    if (same(latest.arenaName, arena)) {
      const buffer = replayBuffer.current;
      if (buffer) void prepareReplay((options) => buffer.saveClip(`${latest.heading} · ${latest.card.raceName}`, { ...options, durationSeconds: 45 }), () => {});
    }
  }, [scoreCards, arena, prepareReplay]);

  // Execute remote camera/stream commands issued from ScorerPage or another controller
  useEffect(() => {
    if (!lastStreamCommand || !live) return;
    const matchesStream = snapshot.streamId === lastStreamCommand.streamId;
    if (!matchesStream) return;
    const { command, value } = lastStreamCommand;
    if (command === 'setZoom') {
      const z = Number(value) || 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors a remote command into the on-screen controls
      setCameraZoom(z);
      void publisher.current?.setZoom?.(z);
    } else if (command === 'mute') {
      void publisher.current?.mute(value === 'true');
    } else if (command === 'pause') {
      void publisher.current?.pause(value === 'true');
    } else if (command === 'flipCamera') {
      void publisher.current?.switchCamera();
    } else if (command === 'windFilter') {
      const enabled = value === 'true';
      setWindFilter(enabled);
      void publisher.current?.setWindFilter?.(enabled);
    } else if (command === 'setQualityPreset') {
      if (value === 'auto' || value === '360p' || value === '480p' || value === '720p' || value === '1080p') {
        setQualityPreset(value);
        void publisher.current?.setQualityPreset?.(value);
      }
    } else if (command === 'saveReplay') {
      const secs = Number(value) || 15;
      const buffer = replayBuffer.current;
      if (buffer) void prepareReplay((options) => buffer.saveClip(`${arena || 'Arena'} · ${secs}s Replay`, { ...options, durationSeconds: secs }), () => {});
    }
  }, [lastStreamCommand, live, snapshot.streamId, arena, prepareReplay]);

  useEffect(() => {
    if (!video.current) return;
    video.current.muted = true; video.current.playsInline = true; video.current.autoplay = true;
    video.current.srcObject = snapshot.media;
    if (snapshot.media) void video.current.play().catch(() => { /* Preview remains available after the next tap. */ });
  }, [snapshot.media, live]);

  const flip = () => run(() => publisher.current!.switchCamera());

  const end = useCallback(async () => {
    setError('');
    try { await publisher.current!.stop(); navigate(`/competitions/${competition.id}/chat`); }
    catch { setError(t('desk.stream.bc.endUnconfirmed')); }
  }, [competition.id, navigate, t]);

  async function askToEnd() {
    if (await confirmDialog({ title: t('desk.stream.end.title'), message: t('desk.stream.end.message'), cancelLabel: t('desk.stream.end.keep'), confirmLabel: t('desk.stream.end.confirm'), destructive: true })) void end();
  }

  useEffect(() => {
    setBroadcasting(live);
    if (!live) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    const timer = setInterval(() => {
      const currentNow = Date.now();
      setNow(currentNow);
      if (startedAt !== null && Math.floor((currentNow - startedAt) / 1000) >= limitSeconds) {
        void end();
      }
    }, 1000);
    return () => { window.removeEventListener('beforeunload', warn); clearInterval(timer); setBroadcasting(false); };
  }, [live, startedAt, limitSeconds, end]);

  useEffect(() => { if (currentStream) publisher.current?.viewers(currentStream.viewerCount); }, [currentStream]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); } catch { setError(t('desk.stream.bc.changeFailed')); }
    finally { setBusy(false); }
  }

  const elapsed = Math.max(0, Math.floor((now - (startedAt ?? now)) / 1000));
  const remaining = Math.max(0, limitSeconds - elapsed);
  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const remainingLabel = t('desk.stream.bc.left', { time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` });

  async function postAnnouncement() {
    const text = announceText.trim();
    if (!text || busy) return;
    await run(async () => {
      if (saveOverlay) {
        await saveOverlay((o) => ({ ...o, bannerText: text, bannerStyle: 0 }));
      }
      const existing = readMessages(competition.id);
      if (!existing.some((m) => m.text === text)) {
        writeMessages(competition.id, [...existing, { text, style: 0 }]);
      }
      try {
        await api.post(`/competitions/${competition.id}/chat/announcement`, {
          body: text,
          message: text,
          author: user?.fullName || 'Live stream',
          tag: 'banner',
        });
      } catch {
        // Banner still updates on the video even if announcement post fails
      }
      setAnnounceText('');
      setShowAnnounce(false);
    });
  }

  async function clearBanner() {
    if (!saveOverlay || busy) return;
    await run(async () => {
      await saveOverlay((o) => ({ ...o, bannerText: null }));
    });
  }

  async function selectDataCard(mode: LiveOverlayCardMode) {
    if (!saveOverlay || busy) return;
    await run(async () => {
      await saveOverlay((o) => {
        const lookObj = typeof o.look === 'object' && o.look !== null ? (o.look as Record<string, unknown>) : {};
        return { ...o, look: { ...lookObj, liveCard: mode } };
      });
    });
  }

  async function toggleScoreStrip() {
    if (!saveOverlay || busy) return;
    await run(async () => {
      await saveOverlay((o) => ({ ...o, scoreCardMode: o.scoreCardMode === 2 ? 0 : 2 }));
    });
  }

  async function toggleLowerThird() {
    if (!saveOverlay || busy) return;
    await run(async () => {
      await saveOverlay((o) => ({ ...o, stripMode: o.stripMode === 2 ? 0 : 2 }));
    });
  }

  async function cutToAngle(targetStreamId: number) {
    if (busy) return;
    await run(async () => {
      await api.post(`/competitions/${competition.id}/streams/${targetStreamId}/command`, {
        command: 'selectAngle',
        value: String(targetStreamId),
      });
    });
  }

  function handleSaveReplay(secs = 15) {
    const buffer = replayBuffer.current;
    if (buffer) void prepareReplay((options) => buffer.saveClip(`${arena || 'Arena'} · ${angle}`, { ...options, durationSeconds: secs }), showReplay);
  }

  const hasActiveOverlayPopup = showOverlays || showAnnounce || showReplayDrawer || activeCardMode !== 'none';
  const preview = <video ref={video} muted autoPlay playsInline className="h-full w-full object-cover" aria-label={t('desk.stream.bc.previewAria')} />;
  if (live) return createPortal(<div className="mg-font fixed inset-0 z-[100] bg-[rgb(var(--mg-header-deep))] text-white">
    {preview}
    <OverlayLayer>
      <ReplayPreparation {...replayPreparation} />
      <div className="pointer-events-none absolute left-4 right-20 top-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="mg-badge mg-badge-live">{t('desk.stream.bc.liveTime', { time })}</span>
          <span className="mg-stream-glass px-2 py-1 text-xs">{t('desk.stream.bc.history', { minutes: Math.floor(replayStatus.retainedSeconds / 60), seconds: Math.floor(replayStatus.retainedSeconds % 60) })}</span>
          {replayStatus.warning && <span role="status" className="mg-stream-glass px-2 py-1 text-xs">{replayStatus.warning}</span>}
          <span className={`mg-stream-glass flex items-center gap-1.5 px-2 py-1 ${remaining <= LOW_TIME_THRESHOLD_SECONDS ? 'border border-amber-400 text-amber-200' : ''}`}>
            <span>{remainingLabel}</span>
            <button
              type="button"
              className="pointer-events-auto rounded bg-white/15 px-1.5 py-0.5 text-xs font-bold text-white hover:bg-white/25"
              disabled={limitSeconds >= MAX_STREAM_LIMIT_SECONDS}
              title={limitSeconds >= MAX_STREAM_LIMIT_SECONDS ? t('desk.stream.bc.maxLength') : t('desk.stream.bc.extend')}
              onClick={() => setLimitSeconds((s) => Math.min(s + EXTEND_STREAM_SECONDS, MAX_STREAM_LIMIT_SECONDS))}
            >
              {t('desk.stream.bc.plus15')}
            </button>
          </span>
          <span className="mg-stream-glass flex items-center gap-1 px-2 py-1"><Eye className="h-4 w-4" />{snapshot.viewerCount}</span>
          <span className={`mg-stream-glass flex items-center gap-1 border px-2 py-1 ${snapshot.signal === 'poor' ? 'border-[rgb(var(--mg-red))]' : snapshot.signal === 'fair' ? 'border-amber-400' : 'border-transparent'}`}>
            <Wifi className="h-4 w-4" />
            <span>{snapshot.signal === 'good' ? t('desk.stream.bc.signalGood') : snapshot.signal === 'fair' ? t('desk.stream.bc.signalFair') : t('desk.stream.bc.signalWeak')}</span>
            {(snapshot.signal !== 'good' || snapshot.state === 'reconnecting') && (
              <button
                type="button"
                aria-label={t('desk.stream.bc.reconnectAria')}
                className="pointer-events-auto ml-1 rounded bg-white/15 px-1.5 py-0.5 text-xs font-bold text-white hover:bg-white/25"
                onClick={() => publisher.current?.reconnect?.()}
              >
                {t('desk.stream.bc.reconnect')}
              </button>
            )}
          </span>
          <button
            type="button"
            aria-label={snapshot.audioMuted ? t('desk.stream.bc.unmute') : t('desk.stream.bc.mute')}
            aria-pressed={snapshot.audioMuted}
            disabled={busy || !canControl}
            className={`pointer-events-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${snapshot.audioMuted ? 'bg-[rgb(var(--mg-red))] text-white' : 'mg-stream-glass text-white'}`}
            onClick={() => void run(() => publisher.current!.mute(!snapshot.audioMuted))}
          >
            {snapshot.audioMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            <span>{snapshot.audioMuted ? t('desk.stream.bc.muted') : t('desk.stream.bc.micOn')}</span>
          </button>
          {live && snapshot.hasAudio && (
            <span className="pointer-events-none flex items-center gap-1.5">
              <span
                role="meter"
                aria-label={t('desk.stream.bc.micLevel')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(mic.level * 100)}
                className="mg-stream-glass block h-1.5 w-16 overflow-hidden rounded-full"
              >
                <span
                  className="block h-full w-full origin-left rounded-full bg-[rgb(var(--mg-ok))]"
                  style={{ transform: `scaleX(${mic.isMuted ? 0 : mic.level})` }}
                />
              </span>
              {mic.silentWarning && !snapshot.audioMuted && <span className="text-[11px] font-semibold text-white">{t('desk.stream.bc.noSound')}</span>}
            </span>
          )}
          <div role="group" aria-label={t('desk.stream.bc.qualityGroup')} className="mg-stream-glass pointer-events-auto flex items-center gap-0.5 rounded-full p-0.5 text-xs font-bold">
            {ON_AIR_QUALITY_OPTIONS.map((opt) => (
              <button
                key={opt.preset}
                type="button"
                aria-pressed={qualityPreset === opt.preset}
                className={`rounded-full px-2 py-0.5 transition-colors ${qualityPreset === opt.preset ? 'bg-amber-400 text-black' : 'text-white/85 hover:text-white'}`}
                onClick={() => {
                  setQualityPreset(opt.preset);
                  void publisher.current?.setQualityPreset?.(opt.preset);
                }}
              >
                {t(`desk.stream.quality.${opt.preset}`)}
              </button>
            ))}
          </div>
          <span className="mg-stream-glass px-2 py-1">{arena} · {angle}</span>
          {CAMERA_ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              aria-label={t('desk.stream.bc.zoomAria', { z })}
              aria-pressed={cameraZoom === z}
              className={`pointer-events-auto rounded-full px-2 py-0.5 text-xs font-bold ${cameraZoom === z ? 'bg-amber-400 text-black' : 'mg-stream-glass text-white'}`}
              onClick={() => { setCameraZoom(z); void publisher.current?.setZoom?.(z); }}
            >
              {z}x
            </button>
          ))}
        </div>
        {arenaStreams.length > 1 && (
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label={t('desk.stream.bc.directorCut')}>
            <span className="mg-stream-glass px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">{t('desk.stream.bc.cutTo')}</span>
            {arenaStreams.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-label={t('desk.stream.bc.cutToAngle', { angle: s.angleName })}
                className={`rounded-full px-2.5 py-0.5 font-semibold ${s.id === snapshot.streamId ? 'bg-amber-400 text-black' : 'mg-stream-glass text-white hover:bg-white/20'}`}
                onClick={() => void cutToAngle(s.id)}
              >
                {s.angleName}
              </button>
            ))}
          </div>
        )}
      </div>
      <ProducerBanner arenaName={arena} overlay={currentOverlay} />
      <LiveDataCardOverlay arenaName={arena} overlay={currentOverlay} />
      <SponsorOverlay arenaName={arena} track={false} />
      <div className="pointer-events-auto absolute bottom-4 right-3 top-16 flex flex-col justify-center gap-2 overflow-y-auto text-center text-xs">
        <button className="mg-stream-control flex-col !rounded-xl p-2" disabled={busy || !canControl} onClick={flip}><RefreshCw />{t('desk.stream.bc.flip')}</button>
        <button className="mg-stream-control flex-col !rounded-xl p-2" disabled={busy || !canControl} onClick={() => run(() => publisher.current!.mute(!snapshot.audioMuted))}>{snapshot.audioMuted ? <MicOff /> : <Mic />}{snapshot.audioMuted ? t('desk.stream.bc.soundOff') : t('desk.stream.bc.soundOn')}</button>
        <button className="mg-stream-control flex-col !rounded-xl p-2" disabled={busy || !canControl} onClick={() => run(() => publisher.current!.pause(snapshot.state !== 'paused'))}>{snapshot.state === 'paused' ? <Play /> : <Pause />}{snapshot.state === 'paused' ? t('desk.stream.bc.resume') : t('desk.stream.bc.backSoon')}</button>
        <button
          type="button"
          className="mg-stream-control flex-col !rounded-xl p-2"
          disabled={busy || !canControl}
          aria-label={t('desk.stream.bc.save15')}
          onClick={() => handleSaveReplay(15)}
        >
          <Film />{t('desk.stream.bc.replay')}
        </button>
        <button
          type="button"
          aria-pressed={showAnnounce}
          className={`mg-stream-control flex-col !rounded-xl p-2 ${showAnnounce || currentOverlay.bannerText ? '!bg-amber-500 !text-black' : ''}`}
          disabled={busy || !canControl}
          onClick={() => { setShowAnnounce((v) => !v); setShowOverlays(false); }}
        >
          <Megaphone />{t('desk.stream.bc.announce')}
        </button>
        <button
          type="button"
          aria-pressed={showOverlays}
          className={`mg-stream-control flex-col !rounded-xl p-2 ${showOverlays || activeCardMode !== 'none' ? '!bg-amber-500 !text-black' : ''}`}
          disabled={busy || !canControl}
          onClick={() => { setShowOverlays((v) => !v); setShowAnnounce(false); }}
        >
          <Layers />{t('desk.stream.bc.overlays')}
        </button>
        <button
          type="button"
          className="mg-stream-control flex-col !rounded-xl p-2"
          aria-label={t('desk.stream.bc.dimAria')}
          onClick={() => setScreenDimmed(true)}
        >
          <Lock />{t('desk.stream.bc.dim')}
        </button>
        <button className="mg-stream-control flex-col !rounded-xl !bg-[rgb(var(--mg-red))] p-2" onClick={() => void askToEnd()}><Square />{t('desk.stream.bc.end')}</button>
      </div>
      {showAnnounce && (
        <form
          className="mg-stream-glass pointer-events-auto fixed inset-4 sm:inset-12 z-30 m-auto flex max-h-[82vh] w-[min(94vw,40rem)] flex-col justify-center gap-3 rounded-2xl border border-white/20 p-5 shadow-2xl"
          onSubmit={(event) => { event.preventDefault(); void postAnnouncement(); }}
        >
          <div className="flex items-center justify-between">
            <strong className="text-sm font-bold">{t('desk.stream.bc.announceHeading')}</strong>
            <button type="button" className="mg-stream-control !min-h-8 px-2.5 text-xs" onClick={() => setShowAnnounce(false)}>
              {t('common.close')}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={t('desk.stream.bc.bannerMessage')}
              className="min-w-0 flex-1 rounded bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/60"
              maxLength={140}
              value={announceText}
              placeholder={t('desk.stream.bc.bannerPlaceholder')}
              onChange={(event) => setAnnounceText(event.target.value)}
            />
            <button type="submit" className="mg-stream-control !min-h-9 !rounded-lg px-3 text-xs font-bold" disabled={busy || !announceText.trim()}>
              {t('desk.stream.bc.post')}
            </button>
            {currentOverlay.bannerText && (
              <button type="button" className="mg-stream-control !min-h-9 !rounded-lg px-3 text-xs" disabled={busy} onClick={() => void clearBanner()}>
                {t('desk.stream.bc.clearBanner')}
              </button>
            )}
          </div>
        </form>
      )}
      {showOverlays && (
        <section
          aria-label={t('desk.stream.bc.liveOverlays')}
          className="mg-stream-glass pointer-events-auto fixed inset-4 sm:inset-10 z-30 m-auto flex max-h-[84vh] w-[min(94vw,42rem)] flex-col justify-center gap-4 overflow-y-auto rounded-2xl border border-white/20 p-5 text-xs sm:text-sm shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/15 pb-2">
            <strong className="text-sm font-bold">{t('desk.stream.bc.overlaysHeading')}</strong>
            <button type="button" className="mg-stream-control !min-h-8 px-2.5 text-xs" onClick={() => setShowOverlays(false)}>
              {t('common.close')}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 font-semibold uppercase tracking-wider text-[rgb(var(--mg-header-sub))]">{t('desk.stream.bc.dataCard')}</span>
            {DATA_CARD_OPTIONS.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                aria-pressed={activeCardMode === opt.mode}
                disabled={busy}
                className={`rounded-full px-3 py-1.5 font-semibold ${activeCardMode === opt.mode ? 'bg-amber-400 text-black' : 'bg-white/15 text-white'}`}
                onClick={() => void selectDataCard(opt.mode)}
              >
                {t(`desk.stream.card.${opt.label}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={currentOverlay.scoreCardMode !== 2}
              disabled={busy}
              className={`rounded-lg px-3 py-1.5 font-semibold ${currentOverlay.scoreCardMode !== 2 ? 'bg-amber-400 text-black' : 'bg-white/15 text-white'}`}
              onClick={() => void toggleScoreStrip()}
            >
              {t('desk.stream.bc.scoreStrip')}
            </button>
            <button
              type="button"
              aria-pressed={currentOverlay.stripMode !== 2}
              disabled={busy}
              className={`rounded-lg px-3 py-1.5 font-semibold ${currentOverlay.stripMode !== 2 ? 'bg-amber-400 text-black' : 'bg-white/15 text-white'}`}
              onClick={() => void toggleLowerThird()}
            >
              {t('desk.stream.bc.lowerThird')}
            </button>
            <SponsorButtons competitionId={competition.id} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-2">
            <button
              type="button"
              className="mg-stream-control !min-h-9 !rounded-lg px-3 text-xs font-semibold"
              onClick={() => { setShowOverlays(false); setShowReplayDrawer(true); }}
            >
              {t('desk.stream.bc.replayHub')}
            </button>
            <Link
              to={`/competitions/${competition.id}/produce`}
              className="mg-stream-control !min-h-9 !rounded-lg px-3 text-xs font-semibold"
            >
              {t('desk.stream.bc.remoteLink')}
            </Link>
          </div>
        </section>
      )}
      <div className="absolute bottom-20 left-4 right-24 flex flex-col items-start gap-2">{streamMessages.slice(-3).map((item) => <StreamNotice key={`${item.message.id}-${item.receivedAt}`} {...item} duration={10_000} />)}</div>
      {!hasActiveOverlayPopup && (
        <div className="pointer-events-auto absolute bottom-4 left-4 right-24 flex flex-wrap items-center gap-2">
          {editingCaption ? <form className="mg-stream-glass flex flex-1 gap-2 p-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await publisher.current!.caption(caption); setEditingCaption(false); }); }}><input aria-label={t('desk.stream.bc.viewersSee')} className="min-w-0 flex-1 bg-transparent p-2 text-white" maxLength={80} value={caption} placeholder={t('desk.stream.bc.captionPlaceholder')} onChange={(event) => setCaption(event.target.value)} /><button disabled={busy}>{t('common.save')}</button></form>
            : <button className="mg-stream-glass px-3 py-2 text-left text-sm" onClick={() => setEditingCaption(true)}><span className="mr-2 text-xs uppercase text-[rgb(var(--mg-header-sub))]">{t('desk.stream.bc.viewersSee')}</span>{label}</button>}
          <SavedReplaysButton competitionId={competition.id} arenaName={arena} onSelectClip={showReplay} />
          {currentOverlay.bannerText && !showAnnounce && (
            <button type="button" className="mg-stream-glass px-3 py-2 text-xs font-semibold text-amber-300" disabled={busy} onClick={() => void clearBanner()}>
              {t('desk.stream.bc.clearBanner')}
            </button>
          )}
        </div>
      )}
      {snapshot.state === 'paused' && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgb(var(--mg-header-deep)/0.65)]"><h2 className="text-2xl font-bold">{t('desk.stream.bc.viewersSeeBackSoon')}</h2><button className="mg-stream-control pointer-events-auto px-4" disabled={busy} onClick={() => run(() => publisher.current!.pause(false))}><Play />{t('desk.stream.bc.resume')}</button></div>}
      {(snapshot.state === 'starting' || snapshot.state === 'reconnecting') && <p role="status" className="mg-stream-glass absolute left-4 top-1/2 p-3">{snapshot.state === 'starting' ? t('desk.stream.bc.starting') : t('desk.stream.bc.reconnecting')}</p>}
      {error && <p role="alert" className="mg-stream-glass absolute left-4 right-24 top-20 p-3">{error}</p>}
      {screenDimmed && (
        <DimmedLock
          label={t('desk.stream.bc.dimmedLabel')}
          className="pointer-events-auto fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 bg-black text-white/35 select-none"
          onUnlock={() => setScreenDimmed(false)}
        >
          <Lock className="h-8 w-8" />
          <h2 className="text-lg font-bold">{t('desk.stream.bc.locked')}</h2>
          <p className="text-sm font-semibold">{t('desk.stream.bc.lockedLine', { time, arena, angle })}</p>
        </DimmedLock>
      )}
      <SavedReplaysDrawer
        competitionId={competition.id}
        open={showReplayDrawer}
        onClose={() => setShowReplayDrawer(false)}
        onSelectClip={showReplay}
        onCaptureBufferClip={(secs) => handleSaveReplay(secs)}
        bufferedSeconds={Math.floor(replayStatus.retainedSeconds)}
      />
      <AnimatePresence>
        {inspectingClip && (
          <ReplayInspector
            key="replay"
            clip={inspectingClip}
            clips={getSavedReplays(competition.id)}
            onSelectClip={showReplay}
            onClose={backToLive}
          />
        )}
      </AnimatePresence>
      {wipeLayer}
    </OverlayLayer>
  </div>, document.body);
  const soundField = (
    <label className="mg-card flex items-center justify-between p-3"><span>{t('desk.stream.bc.sound')}</span><input type="checkbox" checked={sound} disabled={busy} onChange={(event) => { const next = event.target.checked; void run(async () => { if (snapshot.media) await publisher.current!.capture(next); setSound(next); }); }} /></label>
  );
  return <div className={`mx-auto flex w-full flex-col gap-4 pb-6 pt-3 ${snapshot.media ? '' : 'max-w-xl'}`}>
    <Link className="mg-text-link" to={`/competitions/${competition.id}/chat`}>{t('desk.stream.bc.liveStream')}</Link><h1 className="mg-h1">{t('desk.stream.bc.goLiveHeading')}</h1>
    {error || snapshot.error ? <Notice>{error || snapshot.error}</Notice> : null}
    {!snapshot.media && soundField}
    {!snapshot.media ? <button disabled={busy} className="mg-btn mg-btn-primary min-h-12" onClick={() => run(async () => { await publisher.current!.capture(sound); setDevices(await publisher.current!.devices()); setMics(await (publisher.current!.audioDevices?.() ?? Promise.resolve([]))); })}><Camera />{t('desk.stream.bc.allowCamera')}</button> : <>
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)] lg:items-start lg:gap-6">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-[rgb(var(--mg-header-deep))] lg:sticky lg:top-[calc(var(--mg-shell-h,104px)+16px)]">{preview}<span className="mg-font mg-stream-glass absolute left-3 top-3 px-2 py-1">{t('desk.stream.bc.preview')}</span><button className="mg-stream-control absolute bottom-3 right-3" aria-label={t('desk.stream.bc.flipCamera')} disabled={busy} onClick={flip}><RefreshCw /></button></div>
        <div className="flex flex-col gap-4">
          {soundField}
          {sound && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="mg-stream-chip flex items-center gap-1.5"
                aria-pressed={windFilter}
                disabled={busy}
                onClick={() => {
                  const next = !windFilter;
                  setWindFilter(next);
                  void publisher.current?.setWindFilter?.(next);
                }}
              >
                <Wind className="h-4 w-4" />
                <span>{t('desk.stream.bc.windFilter')}</span>
              </button>
            </div>
          )}
          <fieldset><legend className="mb-2 font-semibold">{t('desk.stream.bc.arena')}</legend><div className="flex flex-wrap gap-2">{arenas.map((name) => <button className="mg-stream-chip" aria-pressed={!otherArena && name === arena} key={name} onClick={() => { setArena(name); setOtherArena(false); }}>{name}</button>)}<button className="mg-stream-chip" aria-pressed={otherArena} onClick={() => { setOtherArena(true); setArena(''); }}>{t('desk.stream.bc.other')}</button></div>{otherArena && <input aria-label={t('desk.stream.bc.arenaName')} className="input mt-2" maxLength={80} value={arena} onChange={(event) => setArena(event.target.value)} />}</fieldset>
          <fieldset><legend className="mb-2 font-semibold">{t('desk.stream.bc.cameraPosition')}</legend><div className="flex flex-wrap gap-2">{['Main camera', 'Finish line', 'Start line', 'Wide'].map((name) => <button key={name} className="mg-stream-chip" aria-pressed={!otherAngle && name === angle} onClick={() => { setAngle(name); setOtherAngle(false); }}>{name}</button>)}<button className="mg-stream-chip" aria-pressed={otherAngle} onClick={() => { setOtherAngle(true); setAngle(''); }}>{t('desk.stream.bc.other')}</button></div>{otherAngle && <input aria-label={t('desk.stream.bc.cameraPosition')} className="input mt-2" maxLength={60} value={angle} onChange={(event) => setAngle(event.target.value)} />}</fieldset>
          <fieldset>
            <legend className="mb-2 font-semibold">{t('desk.stream.bc.qualityLegend')}</legend>
            <div className="flex flex-wrap gap-2">
              {QUALITY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="mg-stream-chip"
                  aria-pressed={qualityPreset === preset}
                  onClick={() => {
                    setQualityPreset(preset);
                    void publisher.current?.setQualityPreset?.(preset);
                  }}
                >
                  {t(`desk.stream.quality.${preset}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-2 font-semibold">{t('desk.stream.bc.camera')}<SelectField className="input" disabled={busy} defaultValue="" onChange={(event) => run(() => publisher.current!.switchCamera(event.target.value))}><option value="" disabled>{t('desk.stream.bc.chooseCamera')}</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || t('desk.stream.bc.cameraN', { n: index + 1 })}</option>)}</SelectField></label>
          {sound && mics.length > 0 && (
            <label className="flex flex-col gap-2 font-semibold">
              {t('desk.stream.bc.microphone')}
              <SelectField className="input" disabled={busy} defaultValue="" onChange={(event) => run(() => publisher.current!.switchAudio?.(event.target.value) ?? Promise.resolve())}>
                <option value="" disabled>{t('desk.stream.bc.chooseMic')}</option>
                {mics.map((mic, index) => <option key={mic.deviceId} value={mic.deviceId}>{mic.label || t('desk.stream.bc.micN', { n: index + 1 })}</option>)}
              </SelectField>
            </label>
          )}
          <CameraLockButtons locks={snapshot.cameraLocks} disabled={busy} className="flex flex-wrap items-center gap-2" buttonClassName="mg-stream-chip"
            onChange={(kind, locked) => void run(() => publisher.current!.setCameraLock(kind, locked))} />
          {occupied && <Notice tone="info">{t('desk.stream.bc.occupied', { name: occupantName ?? t('desk.stream.bc.someone'), arena, angle })}</Notice>}
          <Notice tone="info" role={null}>{t('desk.stream.bc.notice')}</Notice>
          <button disabled={busy || !arena.trim() || !angle.trim()} className="mg-btn mg-btn-primary !min-h-[52px] !bg-[rgb(var(--mg-red))] !text-white" onClick={() => run(async () => { const t = Date.now(); setStartedAt(t); setNow(t); setLimitSeconds(DEFAULT_STREAM_LIMIT_SECONDS); await publisher.current!.start(arena, angle, occupied); })}><VideoIcon />{occupied ? t('desk.stream.bc.takeOver') : t('desk.stream.bc.goLive')}</button>
        </div>
      </div>
    </>}
  </div>;
}

function VideoIcon() { return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" />; }

/**
 * Sponsor cards on the video: a switch between "in breaks" and off, and a skip to the next sponsor. Hidden when
 * no sponsor is set to show on the video, or when this phone can't change the overlays.
 */
export function SponsorButtons({ competitionId }: { competitionId: number }) {
  const t = useT();
  const { overlay, saveOverlay, sponsors } = useCompetition();
  const [busy, setBusy] = useState(false);
  const current = overlay ?? DEFAULT_OVERLAY;
  const any = sponsorsFor(sponsors ?? [], 'BreakStream').length > 0 || sponsorsFor(sponsors ?? [], 'Stream').length > 0;
  if (!saveOverlay || !any) return null;
  const on = current.sponsorMode !== 2;
  async function toggle() {
    setBusy(true);
    await saveOverlay!((o) => ({ ...o, sponsorMode: o.sponsorMode === 2 ? 0 : 2 }));
    setBusy(false);
  }
  async function skip() {
    setBusy(true);
    try { await api.post(`/competitions/${competitionId}/sponsors/skip`); } catch { /* the next tap tries again */ }
    setBusy(false);
  }
  return <>
    <button className={`mg-stream-control flex-col !rounded-xl p-2 ${on ? '!bg-amber-500 !text-black' : ''}`} disabled={busy} aria-pressed={on} onClick={() => void toggle()}
      aria-label={on ? t('desk.stream.bc.sponsorsOffAria') : t('desk.stream.bc.sponsorsOnAria')}><Handshake />{on ? t('desk.stream.bc.sponsorsOn') : t('desk.stream.bc.sponsorsOff')}</button>
    {on && <button className="mg-stream-control flex-col !rounded-xl p-2" disabled={busy} onClick={() => void skip()} aria-label={t('desk.stream.bc.skipAria')}><SkipForward />{t('desk.stream.bc.skip')}</button>}
  </>;
}

/** The tripod lock screen: focus sits on the unlock button, Escape unlocks, and Tab stays on the screen. */
function DimmedLock({ label, className, onUnlock, children }: { label: string; className: string; onUnlock: () => void; children: ReactNode }) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onUnlock, 'button');
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} className={className} onDoubleClick={onUnlock}>
      {children}
      <button
        type="button"
        className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/50 hover:text-white"
        onClick={onUnlock}
      >
        {t('desk.stream.bc.unlock')}
      </button>
    </div>
  );
}
