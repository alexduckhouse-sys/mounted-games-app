import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CloudOff, Eye, Film, Lock, Mic, MicOff, Pause, Play, RefreshCw, Square, Table2, Trophy, Video } from 'lucide-react';
import { Notice } from '../components/Notice';
import { PageProblem } from '../components/PageProblem';
import { Sheet } from '../components/Sheet';
import { QrPermissionScannerModal } from '../components/QrPermissionScannerModal';
import { ScoreOutboxPanel } from '../components/ScoreOutboxPanel';
import { StreamControlStrip } from '../components/stream/StreamControlStrip';
import { formatPoints } from '../lib/formatPoints';
import { statusLetter } from '../lib/resultStatus';
import { ordinal } from '../lib/toplist';
import { ScoreClashBanner, type ScoreClashItem } from './competition/ScoringParts';
import { ScoringSection, type PendingPlace } from './competition/ScoringSection';
import {
  clearScorerToken, parseScorerSession, readSavedScorerSession, readSavedScorerSessionAt, readScorerToken, scorerApi, scorerFailure,
  tokenFromHash, writeSavedScorerSession, writeScorerToken, type ScorerLoadFailure,
} from '../offline/scorerLink';
import { LIVE_SAVED_COPY_NOTICE_AFTER_MS, lastUpdatedText, shouldNoticeSavedCopy } from '../offline/savedCopies';
import { enqueue, placingsOf, type QueuedScore } from '../offline/scoreOutbox';
import { nextRoundLanes } from '../lib/nextRoundLanes';
import { sessionPointsBase, withQueuedResults } from '../lib/queuedView';
import { dropDrafts, pushUndo, undoSave, type UndoEntry } from '../lib/scoreUndo';
import { clearDeadHeat, markDeadHeat, overridePoints, nextRaceToScore, placesFromResults, tapTeam, toggleEliminated } from '../lib/raceScoring';
import { displayLaneFor, lanesOf, qualifiersOf, restOfQualifier, sitOutPlaces } from './competition/laneRules';
import { HEAT_SAVED, OUTBOX_STORAGE_ERROR, updateOutbox, useScoreOutbox } from '../offline/useScoreOutbox';
import { browserPublisherDependencies, createStreamPublisher, type PublisherSnapshot } from '../live/streamPublisher';
import { createReplayBuffer, getSavedReplays, type ReplayBufferHandle, type SavedReplayClip } from '../live/replayBuffer';
import { ReplayInspector, SavedReplaysButton } from '../components/stream/ReplayInspector';
import { useLiveHub } from '../live/useLiveHub';
import { useReplayPreparation } from '../live/useReplayPreparation';
import { ReplayPreparation } from '../components/stream/ReplayPreparation';
import type { Heat, LiveStream, LiveStreamsResponse, ScorerSession, Session, StreamQualityPreset } from '../types';

/** Takes the token from the address (`/score#t=…`), keeps it on this phone and tidies the address bar. */
function captureToken(): string | null {
  const fromAddress = tokenFromHash(window.location.hash);
  if (fromAddress) {
    writeScorerToken(fromAddress);
    window.history.replaceState(null, '', window.location.pathname);
    return fromAddress;
  }
  return readScorerToken();
}

const REFRESH_MS = 30_000;

const MESSAGES: Record<Exclude<ScorerLoadFailure, 'offline'>, { title: string; body: string }> = {
  missing: { title: 'No scorer link on this phone', body: 'Open the link or scan the QR code the organiser gave you.' },
  invalid: { title: 'This link isn’t valid', body: 'It may have been copied wrongly. Ask the organiser to send it again.' },
  withdrawn: { title: 'This link has stopped working', body: 'Ask the organiser for a new one. Scores already saved on this phone will still send.' },
  other: { title: 'Something went wrong', body: 'The timetable couldn’t be loaded. Try again in a moment.' },
};

function heatIsComplete(heat: Heat): boolean {
  return heat.races.length > 0 && heat.races.every((race) => race.isComplete);
}

/** Replaces one heat with the server's newer copy. */
function withHeat(session: ScorerSession, sessionId: number, heat: Heat): ScorerSession {
  return {
    ...session,
    sessions: session.sessions.map((s) => s.id !== sessionId ? s : { ...s, heats: s.heats.map((h) => h.id === heat.id ? heat : h) }),
  };
}

/**
 * Where a volunteer scores one arena from a link, with no account. It sits outside the app shell and reuses the
 * heat scoring screen and the phone's score outbox, so scores queue offline and send when there's signal.
 */
export function ScorerPage() {
  const [token, setToken] = useState(captureToken);
  const [session, setSession] = useState<ScorerSession | null>(() => token ? readSavedScorerSession() : null);
  const [failure, setFailure] = useState<ScorerLoadFailure | null>(token ? null : 'missing');
  const [fromSavedCopy, setFromSavedCopy] = useState(false);
  /** When the timetable on screen last came from the server (null when unknown). */
  const [sessionAt, setSessionAt] = useState<string | null>(() => token ? readSavedScorerSessionAt() : null);
  const [loading, setLoading] = useState(!!token);
  const [qrOpen, setQrOpen] = useState(false);
  const outbox = useScoreOutbox();

  const load = useCallback(() => {
    return scorerApi.get<unknown>('/scorer/session')
      .then(({ data }) => {
        const parsed = parseScorerSession(data);
        if (!parsed) { setFailure('other'); return; }
        writeSavedScorerSession(parsed);
        setSession(parsed);
        setFailure(null);
        setFromSavedCopy(false);
        setSessionAt(new Date().toISOString());
      })
      .catch((error: unknown) => {
        const why = scorerFailure(error);
        setFailure(why);
        setFromSavedCopy(why === 'offline');
        // A withdrawn or unknown link shouldn't keep showing a timetable the holder can no longer score.
        if (why === 'invalid' || why === 'missing' || why === 'withdrawn') {
          setSession(null);
          if (why !== 'withdrawn') clearScorerToken();
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token) return;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: number; heat: Heat }>).detail;
      if (detail?.heat) setSession((current) => current ? withHeat(current, detail.sessionId, detail.heat) : current);
    };
    window.addEventListener(HEAT_SAVED, onSaved);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(HEAT_SAVED, onSaved);
    };
  }, [token, load]);

  const raceSessions = useMemo(
    () => (session?.sessions ?? []).filter((s) => (s.kind ?? 0) === 0).slice().sort((a, b) => {
      const ta = a.scheduledStart ? Date.parse(a.scheduledStart) : Number.MAX_SAFE_INTEGER;
      const tb = b.scheduledStart ? Date.parse(b.scheduledStart) : Number.MAX_SAFE_INTEGER;
      return (ta - tb) || (a.orderIndex - b.orderIndex);
    }),
    [session],
  );

  return (
    <main className="skin mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-3 p-3 pb-10 sm:p-5">
      <header className="space-y-1 pt-2">
        <p className="mg-meta">Scorer link</p>
        <h1 className="mg-h1 mg-h1-sm">{session ? `${session.competitionName || 'Competition'} · ${session.arenaName}` : 'Score this arena'}</h1>
        {session && <p className="mg-meta">Scoring as {session.label}</p>}
      </header>

      {loading && !session && <p role="status" className="mg-card p-4">Loading the timetable…</p>}

      {failure === 'offline' && !(fromSavedCopy && session && !shouldNoticeSavedCopy(sessionAt, true, new Date(), LIVE_SAVED_COPY_NOTICE_AFTER_MS)) && (
        <Notice icon={CloudOff} role="status" actionLabel="Try again" onAction={() => void load()}>
          {fromSavedCopy && session
            ? `${lastUpdatedText(sessionAt)}. No signal. Scores you enter will send when you’re back online.`
            : 'No signal, and nothing is saved on this phone yet. Try again when you’re back online.'}
        </Notice>
      )}

      {failure && failure !== 'offline' && (
        <PageProblem
          title={MESSAGES[failure].title}
          primaryLabel={failure === 'other' ? 'Try again' : 'Scan the QR code'}
          onPrimary={failure === 'other' ? () => void load() : () => setQrOpen(true)}
        >
          {MESSAGES[failure].body}
        </PageProblem>
      )}

      {session && token && failure !== 'invalid' && failure !== 'missing' && failure !== 'withdrawn' && (
        session.scope === 1 ? (
          <TripodCameraBroadcaster session={session} />
        ) : (
          <>
            {session.scope === 2 && <RemoteStreamControlBar session={session} />}
            <ScoreOutboxPanel competitionId={session.competitionId} />
            {raceSessions.length === 0
              ? <p className="mg-card p-4">Nothing is timetabled for this arena yet. It will appear here once the organiser adds it.</p>
              : <ArenaScoring key={session.competitionId} sessions={raceSessions} outbox={outbox} canStream={session.scope === 2} />}
          </>
        )
      )}

      <QrPermissionScannerModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onScorerVerified={(verifiedToken, verifiedSession) => {
          setToken(verifiedToken);
          setSession(verifiedSession);
          setFailure(null);
          setFromSavedCopy(false);
          setSessionAt(new Date().toISOString());
          setLoading(false);
        }}
        onNavigate={(to) => {
          if (!to.startsWith('/score')) {
            window.location.assign(to);
          }
        }}
      />
    </main>
  );
}

function RemoteStreamControlBar({ session }: { session: ScorerSession }) {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [quality, setQuality] = useState<StreamQualityPreset>('1080p');
  const [muted, setMuted] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [statusNote, setStatusNote] = useState<string>('');
  const [inspectingClip, setInspectingClip] = useState<SavedReplayClip | null>(null);

  const loadStreams = useCallback(() => {
    return scorerApi.get<LiveStreamsResponse>(`/competitions/${session.competitionId}/streams`)
      .then(({ data }) => {
        const active = (data?.streams ?? []).filter(
          (s) => s.status !== 2 && s.arenaName.trim().toLowerCase() === session.arenaName.trim().toLowerCase(),
        );
        setStreams(active);
        const current = active.find((s) => s.id === selectedStreamId) ?? active[0] ?? null;
        if (current) {
          setMuted(current.audioMuted);
          setPaused(current.status === 1);
        }
      })
      .catch(() => {
        // Offline or stream list unavailable
      });
  }, [session.competitionId, session.arenaName, selectedStreamId]);

  useEffect(() => {
    void loadStreams();
  }, [loadStreams]);

  const activeStream = streams.find((s) => s.id === selectedStreamId) ?? streams[0] ?? null;

  async function sendCommand(command: string, value?: string, targetStreamId?: number) {
    const id = targetStreamId ?? activeStream?.id;
    if (!id) return;
    try {
      await scorerApi.post(`/competitions/${session.competitionId}/streams/${id}/command`, {
        command,
        value: value ?? null,
      });
      setStatusNote(`Sent: ${command}`);
    } catch {
      setStatusNote('Could not reach camera');
    }
  }

  return (
    <section aria-label="Remote camera control" className="mg-card space-y-2.5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Video className="h-4 w-4 text-red-600" aria-hidden="true" />
          <span>Stream &amp; Camera Control</span>
          {activeStream ? (
            <span className="mg-badge mg-badge-live text-xs">
              LIVE · {activeStream.angleName} ({activeStream.viewerCount} watching)
            </span>
          ) : (
            <span className="mg-meta">No active camera in {session.arenaName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <SavedReplaysButton
            competitionId={session.competitionId}
            arenaName={session.arenaName}
            onSelectClip={(c) => setInspectingClip(c)}
          />
          <button
            type="button"
            className="btn-ghost min-h-9 px-2.5 text-xs"
            aria-label="Refresh camera status"
            onClick={() => void loadStreams()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {streams.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Director camera cut">
          <span className="font-semibold text-[rgb(var(--mg-muted))]">Director cut:</span>
          {streams.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Cut to ${s.angleName}`}
              aria-pressed={activeStream?.id === s.id}
              className={`min-h-9 rounded-full px-3 font-semibold ${activeStream?.id === s.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}
              onClick={() => {
                setSelectedStreamId(s.id);
                setMuted(s.audioMuted);
                setPaused(s.status === 1);
                void sendCommand('selectAngle', String(s.id), s.id);
              }}
            >
              {s.angleName}
            </button>
          ))}
        </div>
      )}

      {activeStream && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            aria-label={muted ? 'Unmute camera mic' : 'Mute camera mic'}
            aria-pressed={muted}
            className={`min-h-9 flex items-center gap-1 rounded-lg px-2.5 font-semibold ${muted ? 'bg-red-100 text-red-900' : 'bg-slate-100 text-slate-800'}`}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              void sendCommand('mute', String(next));
            }}
          >
            {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            <span>{muted ? 'Mic muted' : 'Mic on'}</span>
          </button>

          {([1, 2, 3] as const).map((z) => (
            <button
              key={z}
              type="button"
              aria-label={`Remote zoom ${z}x`}
              aria-pressed={zoom === z}
              className={`min-h-9 rounded-lg px-2.5 font-bold ${zoom === z ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}
              onClick={() => {
                setZoom(z);
                void sendCommand('setZoom', String(z));
              }}
            >
              {z}x
            </button>
          ))}

          {(['360p', '720p', '1080p'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Stream quality ${preset}`}
              aria-pressed={quality === preset}
              className={`min-h-9 rounded-lg px-2.5 font-semibold ${quality === preset ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}
              onClick={() => {
                setQuality(preset);
                void sendCommand('setQualityPreset', preset);
              }}
            >
              {preset}
            </button>
          ))}

          <button
            type="button"
            aria-label={paused ? 'Resume stream' : 'Pause stream (Back soon)'}
            aria-pressed={paused}
            className={`min-h-9 flex items-center gap-1 rounded-lg px-2.5 font-semibold ${paused ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800'}`}
            onClick={() => {
              const next = !paused;
              setPaused(next);
              void sendCommand('pause', String(next));
            }}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            <span>{paused ? 'Resume' : 'Back soon'}</span>
          </button>

          <button
            type="button"
            aria-label="Save 15s camera replay"
            className="min-h-9 flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 font-semibold text-slate-800"
            onClick={() => void sendCommand('saveReplay', '15')}
          >
            <Film className="h-3.5 w-3.5" />
            <span>Save 15s replay</span>
          </button>
        </div>
      )}

      {statusNote && <p role="status" className="text-xs text-[rgb(var(--mg-muted))]">{statusNote}</p>}

      {inspectingClip && (
        <ReplayInspector
          clip={inspectingClip}
          clips={getSavedReplays(session.competitionId)}
          onSelectClip={(c) => setInspectingClip(c)}
          onClose={() => setInspectingClip(null)}
        />
      )}
    </section>
  );
}

function TripodCameraBroadcaster({ session }: { session: ScorerSession }) {
  const replayBuffer = useRef<ReplayBufferHandle | null>(null);
  const replayPreparation = useReplayPreparation();
  const [commandError, setCommandError] = useState('');
  const [replayStatus, setReplayStatus] = useState<{ retainedSeconds: number; warning?: string }>({ retainedSeconds: 0 });
  const [inspectingClip, setInspectingClip] = useState<SavedReplayClip | null>(null);
  const publisher = useRef<ReturnType<typeof createStreamPublisher> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [snapshot, setSnapshot] = useState<PublisherSnapshot>({
    state: 'idle', media: null, streamId: null, viewerCount: 0, signal: 'good', audioMuted: false, hasAudio: false, error: null,
  });
  const [angle, setAngle] = useState('Main camera');
  const [quality, setQuality] = useState<StreamQualityPreset>('1080p');
  const [dimmed, setDimmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices) return;
    const baseDeps = browserPublisherDependencies();
    const next = createStreamPublisher(session.competitionId, {
      ...baseDeps,
      request: <T = void>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
        scorerApi.request<T>({ method, url: path, data: body }).then((r) => r.data),
    });
    publisher.current = next;
    const unsubscribe = next.subscribe(() => setSnapshot(next.getSnapshot()));
    return () => { unsubscribe(); publisher.current = null; next.dispose(); };
  }, [session.competitionId]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = true;
    videoRef.current.playsInline = true;
    videoRef.current.autoplay = true;
    videoRef.current.srcObject = snapshot.media;
    if (snapshot.media) void videoRef.current.play().catch(() => {});
  }, [snapshot.media]);

  const live = ['starting', 'live', 'paused', 'reconnecting'].includes(snapshot.state);
  useEffect(() => {
    if (!snapshot.media) return;
    const handle = createReplayBuffer({ competitionId: session.competitionId, streamId: snapshot.streamId ?? undefined,
      arenaName: session.arenaName, onStatus: setReplayStatus });
    replayBuffer.current = handle; handle.start(snapshot.media);
    return () => { handle.dispose(); if (replayBuffer.current === handle) replayBuffer.current = null; };
  }, [snapshot.media, snapshot.streamId, session.competitionId, session.arenaName]);
  useLiveHub(session.competitionId, {
    onStreamCommand: (message) => {
      const current = publisher.current;
      const state = current?.getSnapshot();
      if (!current || !state || state.streamId !== message.streamId || !['live', 'paused', 'reconnecting'].includes(state.state)) return;
      const { command, value } = message;
      setCommandError('');
      void (async () => {
        if (command === 'mute') await current.mute(value === 'true');
        else if (command === 'pause') await current.pause(value === 'true');
        else if (command === 'flipCamera') await current.switchCamera();
        else if (command === 'windFilter') await current.setWindFilter(value === 'true');
        else if (command === 'setZoom') await current.setZoom(Number(value) || 1);
        else if (command === 'setQualityPreset' && (value === '360p' || value === '720p' || value === '1080p')) {
          await current.setQualityPreset(value); if (publisher.current === current) setQuality(value);
        } else if (command === 'saveReplay') {
          const buffer = replayBuffer.current;
          if (buffer) await replayPreparation.prepare((options) => buffer.saveClip('Camera replay', { ...options, durationSeconds: Number(value) || 15 }), setInspectingClip);
        }
      })().catch(() => { if (publisher.current === current) setCommandError('The camera command failed. Try again.'); });
    },
  });

  return (
    <section aria-label="Tripod camera broadcaster" className="mg-card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">Tripod camera · {session.arenaName}</h2>
          <p className="mg-meta">Stream-only link (scoring is disabled on this phone)</p>
        </div>
        {live && (
          <span className="mg-badge mg-badge-live flex items-center gap-1">
            LIVE <Eye className="h-3.5 w-3.5" /> {snapshot.viewerCount}
          </span>
        )}
      </div>

      {snapshot.error && <Notice>{snapshot.error}</Notice>}
      {commandError && <Notice>{commandError}</Notice>}
      <ReplayPreparation {...replayPreparation} />
      {snapshot.media && <p className="mg-meta">Replay history: {Math.floor(replayStatus.retainedSeconds / 60)}m {Math.floor(replayStatus.retainedSeconds % 60)}s (up to 30m)</p>}
      {replayStatus.warning && <Notice role="status">{replayStatus.warning}</Notice>}
      <SavedReplaysButton competitionId={session.competitionId} arenaName={session.arenaName} onSelectClip={setInspectingClip} />
      {inspectingClip && <ReplayInspector clip={inspectingClip} clips={getSavedReplays(session.competitionId)} onClose={() => setInspectingClip(null)} onSelectClip={setInspectingClip} />}

      {!snapshot.media ? (
        <button
          type="button"
          className="btn-primary min-h-11 flex items-center gap-2"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await publisher.current?.capture(true); } finally { setBusy(false); }
          }}
        >
          <Camera className="h-4 w-4" /> Allow camera
        </button>
      ) : (
        <div className="space-y-3">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} muted autoPlay playsInline className="h-full w-full object-cover" aria-label="Tripod camera preview" />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">Camera angle:</span>
            {['Main camera', 'Finish line', 'Start line', 'Wide'].map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={angle === name}
                disabled={live}
                className={`min-h-9 rounded-full px-3 font-semibold ${angle === name ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}
                onClick={() => setAngle(name)}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">Quality:</span>
            {(['360p', '720p', '1080p'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={quality === preset}
                className={`min-h-9 rounded-full px-3 font-semibold ${quality === preset ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}
                onClick={() => {
                  setQuality(preset);
                  void publisher.current?.setQualityPreset?.(preset);
                }}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!live ? (
              <button
                type="button"
                className="btn-primary min-h-11"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await publisher.current?.start(session.arenaName, angle, true); } finally { setBusy(false); }
                }}
              >
                Go live
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-ghost min-h-11 flex items-center gap-1.5"
                  aria-label="Lock and dim tripod screen"
                  onClick={() => setDimmed(true)}
                >
                  <Lock className="h-4 w-4" /> Lock &amp; dim screen
                </button>
                <button
                  type="button"
                  className="btn-ghost min-h-11 flex items-center gap-1.5 text-red-700"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try { await publisher.current?.stop(); } finally { setBusy(false); }
                  }}
                >
                  <Square className="h-4 w-4" /> End stream
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {dimmed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tripod screen dimmed"
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 bg-black text-white/35 select-none"
          onDoubleClick={() => setDimmed(false)}
        >
          <Lock className="h-8 w-8" />
          <p className="text-sm font-semibold">LIVE · {session.arenaName} · {angle}</p>
          <p className="text-xs">Screen locked</p>
          <button
            type="button"
            className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/50"
            onClick={() => setDimmed(false)}
          >
            Double-tap to unlock.
          </button>
        </div>
      )}
    </section>
  );
}

function ArenaScoring({ sessions, outbox, canStream }: { sessions: Session[]; outbox: ReturnType<typeof useScoreOutbox>; canStream: boolean }) {
  const [chosenSessionId, setChosenSessionId] = useState<number | null>(null);
  const [chosenHeatId, setChosenHeatId] = useState<number | null>(null);
  const [chosenRaceId, setChosenRaceId] = useState<number | null>(null);
  // null until the scorer touches the tiles, so a scored race shows its saved placings for correcting.
  const [pending, setPending] = useState<PendingPlace[] | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Default to the first session with an unfinished heat, so the scorer lands where the action is.
  const session = sessions.find((s) => s.id === chosenSessionId)
    ?? sessions.find((s) => s.heats.some((h) => !heatIsComplete(h))) ?? sessions[0];

  const [commentatorChoice, setCommentatorChoice] = useState<'yes' | 'no' | null>(() => {
    try {
      const fromUrl = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('commentator') === '1';
      if (fromUrl) {
        localStorage.setItem(`mg.commentatorScoring.${session.competitionId}`, 'yes');
        return 'yes';
      }
      const val = localStorage.getItem(`mg.commentatorScoring.${session.competitionId}`);
      if (val === 'yes' || val === 'no') return val;
    } catch { /* ignore */ }
    return null;
  });
  const [postRaceRecap, setPostRaceRecap] = useState<{
    raceName: string;
    summaryText: string;
    heat: Heat;
    session: Session;
  } | null>(null);

  const commentatorMode = commentatorChoice === 'yes';
  function saveCommentatorChoice(next: 'yes' | 'no') {
    setCommentatorChoice(next);
    try { localStorage.setItem(`mg.commentatorScoring.${session.competitionId}`, next); } catch { /* ignore */ }
  }

  const heats = session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const heat = heats.find((h) => h.id === chosenHeatId) ?? heats.find((h) => !heatIsComplete(h)) ?? heats[0] ?? null;
  const races = (heat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const activeRace = races.find((r) => r.id === chosenRaceId) ?? races.find((r) => !r.isComplete) ?? races[races.length - 1] ?? null;
  // A heat with more teams than lanes races only the lanes, so points are out of the lanes, not the teams.
  const sessionBase = sessionPointsBase(session.heats, session.lanesPerHeat);
  const laneRules = lanesOf(session);
  // Saves still waiting on this phone are shown as if sent.
  const viewHeats = heats.map((h) => withQueuedResults(h, outbox, sessionBase));
  const viewHeat = heat ? viewHeats.find((h) => h.id === heat.id) ?? heat : null;
  const viewRaces = (viewHeat?.races ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const heatIndex = heat ? heats.findIndex((h) => h.id === heat.id) : -1;
  const nextLanes = viewHeat ? nextRoundLanes({ ...session, heats: viewHeats }, viewHeat, viewHeats[heatIndex + 1] ?? null, qualifiersOf(session)) : null;
  // In a qualifier only the teams that go through to the final are placed; the rest score 1 point each.
  const qualifierCap = heat?.raceRoundStage === 1 ? qualifiersOf(session) : null;

  function choose(change: { session?: number; heat?: number; race?: number }) {
    setPostRaceRecap(null);
    if (change.session !== undefined) { setChosenSessionId(change.session); setChosenHeatId(null); setChosenRaceId(null); }
    if (change.heat !== undefined) { setChosenHeatId(change.heat); setChosenRaceId(null); }
    if (change.race !== undefined) setChosenRaceId(change.race);
    // Choosing a different race starts that race's placings afresh, or from its saved results when correcting.
    setPending(null);
  }

  // Correcting a scored race starts from what's there.
  const seeded = activeRace?.isComplete ? placesFromResults(activeRace) : [];
  const shown = pending ?? seeded;

  function change(next: PendingPlace[]) {
    if (activeRace) setUndoStack((stack) => pushUndo(stack, { kind: 'draft', raceId: activeRace.id, places: shown }));
    setPending(next);
  }

  function clickTeam(teamId: number) {
    change(tapTeam(shown, teamId, qualifierCap));
  }

  function toggleElim(teamId: number) {
    change(toggleEliminated(shown, teamId));
  }

  /** Queues the race's result; false when it can't be saved yet (the error says why). */
  function submit(places: PendingPlace[] = shown): boolean {
    if (!activeRace || !heat) return false;
    const reason = reasons[activeRace.id]?.trim();
    if ((activeRace.results.length > 0 || outbox.some((item) => item.raceId === activeRace.id)) && !reason) {
      setSaveError('Add a reason for this correction before saving.');
      return false;
    }
    const item: QueuedScore = {
      saveId: crypto.randomUUID(),
      reason,
      viaLink: true,
      raceId: activeRace.id,
      competitionId: session.competitionId,
      sessionId: session.id,
      label: `${heat.label ?? `Heat ${heatIndex + 1}`} · ${activeRace.name}`,
      places: [...places, ...restOfQualifier(heat, places), ...sitOutPlaces(heat, races.findIndex((r) => r.id === activeRace.id), laneRules)],
      expected: placingsOf(activeRace.results),
      teamNames: Object.fromEntries(heat.entries.map((e) => [e.teamId, e.teamName])),
      queuedAt: new Date().toISOString(),
      state: 'waiting',
    };
    const queuedBefore = outbox.find((q) => q.raceId === activeRace.id) ?? null;
    const nextOutbox = enqueue(outbox, item);
    if (!updateOutbox((list) => enqueue(list, item))) { setSaveError(OUTBOX_STORAGE_ERROR); return false; }
    setSaveError(null);
    setUndoStack((stack) => pushUndo(dropDrafts(stack, activeRace.id), { kind: 'save', raceId: activeRace.id, sent: item, queuedBefore, draft: places }));
    setPending([]);

    if (commentatorMode) {
      const updatedHeats = heats.map((h) => withQueuedResults(h, nextOutbox, sessionBase));
      const updatedHeat = updatedHeats.find((h) => h.id === heat.id) ?? heat;
      const scoredRace = updatedHeat.races.find((r) => r.id === activeRace.id);
      const summaryParts = (scoredRace?.results ?? [])
        .slice()
        .sort((a, b) => {
          if (a.isSitOut !== b.isSitOut) return a.isSitOut ? 1 : -1;
          if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
          return (a.placing ?? 999) - (b.placing ?? 999) || b.points - a.points;
        })
        .map((res) => {
          if (res.isSitOut) return `Sat out ${res.teamName}`;
          if (res.eliminated) return `${statusLetter(true, res.status) ?? 'E'} ${res.teamName}`;
          return `${res.placing != null ? ordinal(res.placing) : ''} ${res.teamName} (+${formatPoints(res.points)} pts)`.trim();
        });
      setPostRaceRecap({
        raceName: activeRace.name,
        summaryText: summaryParts.join(', ') || 'Results recorded',
        heat: updatedHeat,
        session: { ...session, heats: updatedHeats },
      });
    }

    const queuedIds = new Set([...outbox.map((q) => q.raceId), activeRace.id]);
    const next = nextRaceToScore(heats, session.raceOrderAlternating === true, { heatId: heat.id, raceId: activeRace.id }, queuedIds);
    if (next) { setChosenHeatId(next.heatId); setChosenRaceId(next.raceId); }
    return true;
  }

  // Undo takes back the last action on the open race, or else the last save.
  const lastUndo = undoStack[undoStack.length - 1];
  const canUndo = lastUndo != null && (lastUndo.kind === 'save' || lastUndo.raceId === activeRace?.id);
  function undo() {
    if (!lastUndo) return;
    setUndoStack((stack) => stack.slice(0, -1));
    if (lastUndo.kind === 'draft') { setPending(lastUndo.places); return; }
    if (lastUndo.kind === 'mark') return;
    let restore: PendingPlace[] = [];
    updateOutbox((list) => {
      const result = undoSave(list, lastUndo);
      restore = result.restore;
      return result.outbox;
    });
    const owner = heats.find((h) => h.races.some((r) => r.id === lastUndo.raceId));
    if (owner) { setChosenHeatId(owner.id); setChosenRaceId(lastUndo.raceId); }
    setPending(restore.length > 0 ? restore : null);
  }

  const teamNamesById: Record<number, string> = {};
  for (const h of heats) {
    for (const e of h.entries) teamNamesById[e.teamId] = e.teamName;
  }
  for (const q of outbox) {
    if (q.teamNames) Object.assign(teamNamesById, q.teamNames);
  }

  const clashes: ScoreClashItem[] = outbox
    .filter((q) => q.state === 'conflict' && q.sessionId === session.id)
    .map((q) => {
      const serverRace = heats.flatMap((h) => h.races).find((r) => r.id === q.raceId);
      return {
        raceId: q.raceId,
        raceName: serverRace?.name ?? q.label,
        raceOrder: serverRace?.orderIndex,
        sessionId: q.sessionId,
        existingPlaces: (serverRace?.results ?? []).map((r) => ({
          teamId: r.teamId,
          place: r.placing ?? 0,
          eliminated: r.eliminated,
          points: r.points,
          status: r.status,
        })),
        incomingPlaces: q.places.map((p) => ({
          teamId: p.teamId,
          place: p.place,
          eliminated: p.eliminated,
          points: p.points,
          status: p.status,
        })),
      };
    });

  function resolveClash(clash: ScoreClashItem, useIncoming: boolean) {
    if (!useIncoming) {
      updateOutbox((list) => list.filter((q) => q.raceId !== clash.raceId));
      return;
    }
    const existingItem = outbox.find((q) => q.raceId === clash.raceId);
    if (!existingItem) return;
    updateOutbox((list) =>
      enqueue(list, {
        ...existingItem,
        saveId: crypto.randomUUID(),
        expected: clash.existingPlaces.map((p) => ({ teamId: p.teamId, place: p.place, eliminated: p.eliminated })),
        reason: 'Score clash resolved',
        state: 'waiting',
      }),
    );
  }

  // Scorer links may contain one heat only; never present these totals as a section ranking.
  const availableTotals = new Map<number, { teamId: number; teamName: string; points: number }>();
  for (const s of sessions) {
    if (s.competitionSectionId !== session.competitionSectionId) continue;
    for (const h of s.heats) {
      const viewed = withQueuedResults(h, outbox, sessionPointsBase(s.heats, s.lanesPerHeat));
      for (const e of viewed.entries) {
        const row = availableTotals.get(e.teamId) ?? { teamId: e.teamId, teamName: e.teamName, points: 0 };
        row.points += viewed.races.reduce((total, race) => total + (race.results.find((r) => r.teamId === e.teamId)?.points ?? 0), 0);
        availableTotals.set(e.teamId, row);
      }
    }
  }
  const availableRows = [...availableTotals.values()].sort((a, b) => b.points - a.points);

  return (
    <div className="space-y-3">
      {saveError && <Notice>{saveError}</Notice>}
      <ScoreClashBanner clashes={clashes} teamNamesById={teamNamesById} onResolve={resolveClash} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-pressed={commentatorMode}
          onClick={() => saveCommentatorChoice(commentatorMode ? 'no' : 'yes')}
          className={`mg-btn !min-h-9 !px-3 text-xs font-bold ${
            commentatorMode ? 'mg-btn-primary' : 'mg-btn-secondary'
          }`}
        >
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          {commentatorMode ? 'Commentator facts: ON' : 'Commentator facts: OFF'}
        </button>
      </div>

      {commentatorChoice === null && (
        <Sheet
          title="Show commentator facts while you score?"
          description="You’ll see the scores this link can see, and a heat summary after each race."
          onClose={() => saveCommentatorChoice('no')}
          dismissible={false}
        >
          {({ close }) => (
            <div className="kit-acts">
              <button type="button" className="kit-pill kit-pill-fill" onClick={() => close(() => saveCommentatorChoice('yes'))}>Yes, show them</button>
              <button type="button" className="kit-pill" onClick={() => close(() => saveCommentatorChoice('no'))}>No, just score</button>
            </div>
          )}
        </Sheet>
      )}

      {sessions.length > 1 && (
        <label className="flex flex-col gap-1 text-sm font-semibold">Session
          <select className="input min-h-11" value={session.id} onChange={(event) => choose({ session: Number(event.target.value) })}>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      {heats.length === 0 && <p className="mg-card p-4">No heats in this session yet.</p>}
      {heats.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Heats">
          {heats.map((h, i) => (
            <button
              key={h.id}
              role="tab"
              aria-selected={h.id === heat?.id}
              onClick={() => choose({ heat: h.id })}
              className={`min-h-11 whitespace-nowrap rounded-md px-3 text-sm font-semibold ${h.id === heat?.id ? 'bg-brand-600 text-white' : heatIsComplete(h) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}
            >
              {h.label ?? `Heat ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {commentatorMode && viewHeat && (
        <section aria-label="Live commentator facts" className="mg-card space-y-3 p-3.5">
          <div className="flex items-center gap-2 border-b border-[rgb(var(--mg-rule-soft))] pb-2">
            <Mic className="h-4 w-4 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
            <h2 className="mg-display m-0 text-sm font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
              Live Commentator Facts · {viewHeat.label || 'Current Heat'}
            </h2>
          </div>
          {viewHeat.entries.length > 0 && (
            <ul className="m-0 grid grid-cols-1 gap-2 list-none p-0 sm:grid-cols-2">
              {viewHeat.entries
                .slice()
                .sort((a, b) => a.laneIndex - b.laneIndex)
                .map((entry) => {
                  const row = availableTotals.get(entry.teamId);
                  const heatPts = viewHeat.races.reduce(
                    (sum, r) => sum + (r.results.find((res) => res.teamId === entry.teamId)?.points ?? 0),
                    0,
                  );
                  return (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-3 py-2 text-xs"
                    >
                      <span className="font-bold text-[rgb(var(--mg-ink))]">
                        Lane {displayLaneFor(viewHeat, entry, Math.max(0, races.findIndex((r) => r.id === activeRace?.id)), laneRules)}: {entry.teamName}
                      </span>
                      <span className="font-bold text-[rgb(var(--mg-heading))]">
                        Available scores: {formatPoints(row?.points ?? 0)} pts (Heat: {formatPoints(heatPts)})
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
          {canStream && <StreamControlStrip
            competitionId={session.competitionId}
            arenaName={session.arenaName}
            sectionId={session.competitionSectionId}
            activeHeatId={viewHeat.id}
            compact
            useScorerClient
          />}
        </section>
      )}

      {viewHeat && (
        <ScoringSection
          key={`${viewHeat.id}:${activeRace?.id}`}
          heat={viewHeat}
          races={viewRaces}
          activeRace={viewRaces.find((r) => r.id === activeRace?.id) ?? null}
          onSelectRace={(id) => { choose({ race: id }); setUndoStack((stack) => dropDrafts(stack)); }}
          sessionBase={sessionBase}
          laneRules={laneRules}
          qualifiers={qualifiersOf(session)}
          pending={shown}
          canScore
          queued={outbox}
          onClickTeam={clickTeam}
          onToggleElim={toggleElim}
          onReset={() => change([])}
          onSubmit={submit}
              onOverridePoints={(teamId, points, reason) => change(overridePoints(shown, teamId, points, reason))}
              onDeadHeat={(teamIds) => change(markDeadHeat(shown, teamIds))}
              onClearDeadHeat={(teamId) => change(clearDeadHeat(shown, teamId))}
          onUndo={canUndo ? undo : undefined}
          undoLabel={lastUndo?.kind === 'save' ? 'Undo last save' : 'Undo'}
          allowReasons
          nextLanes={nextLanes}
          correctionReason={activeRace ? reasons[activeRace.id] ?? '' : ''}
          onCorrectionReason={(reason) => { if (activeRace) setReasons((current) => ({ ...current, [activeRace.id]: reason })); }}
        />
      )}

      {postRaceRecap && (
        <Sheet title={`${postRaceRecap.raceName} complete`} description={postRaceRecap.summaryText} onClose={() => setPostRaceRecap(null)} className="sc-recap-sheet">
          {({ close }) => (
            <>
        <section aria-label="Updated heat table" className="space-y-2">
          <h3 className="mg-display m-0 flex items-center gap-1.5 text-sm font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
            <Table2 className="h-4 w-4" aria-hidden="true" /> Updated Heat Table · {postRaceRecap.heat.label || 'Heat'}
          </h3>
          <ol className="m-0 divide-y divide-[rgb(var(--mg-rule-soft))] rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] list-none p-0">
            {postRaceRecap.heat.entries
              .slice()
              .map((entry) => ({
                ...entry,
                points: postRaceRecap.heat.races.reduce(
                  (sum, r) => sum + (r.results.find((res) => res.teamId === entry.teamId)?.points ?? 0),
                  0,
                ),
              }))
              .sort((a, b) => b.points - a.points || a.laneIndex - b.laneIndex)
              .map((row, idx) => (
                <li key={row.teamId} className="flex items-center justify-between px-3 py-2 text-xs font-semibold">
                  <span>{ordinal(idx + 1)} {row.teamName}</span>
                  <span>{formatPoints(row.points)} pts</span>
                </li>
              ))}
          </ol>
        </section>

        <section aria-label="Updated section toplist" className="space-y-2">
          <p className="text-xs">These totals cover only the heats available to this link and include queued scores. They are not section standings.</p>
          <h3 className="mg-display m-0 flex items-center gap-1.5 text-sm font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
            <Trophy className="h-4 w-4" aria-hidden="true" /> Scores available to this link
          </h3>
          <ol className="m-0 divide-y divide-[rgb(var(--mg-rule-soft))] rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] list-none p-0">
            {availableRows.map((row) => (
              <li key={row.teamId} className="flex items-center justify-between px-3 py-2 text-xs font-semibold">
                <span>{row.teamName}</span>
                <span>{formatPoints(row.points)} pts</span>
              </li>
            ))}
          </ol>
        </section>
              <div className="kit-acts">
                <button type="button" className="kit-pill kit-pill-fill" onClick={() => close()}>Close</button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
