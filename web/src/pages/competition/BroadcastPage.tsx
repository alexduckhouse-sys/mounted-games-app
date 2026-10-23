import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, Eye, Handshake, Megaphone, Mic, MicOff, Pause, Play, RefreshCw, SkipForward, Square, Wifi } from 'lucide-react';
import { api } from '../../api';
import { sponsorsFor } from '../../lib/sponsors';
import { SponsorOverlay } from '../../components/stream/SponsorOverlay';
import { readMessages } from '../../lib/overlayMessages';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { browserPublisherDependencies, createStreamPublisher, type PublisherSnapshot } from '../../live/streamPublisher';
import { streamHeatLabel } from '../../lib/streams';
import { setBroadcasting } from '../../pwa';
import { OverlayLayer, StreamNotice } from '../../components/stream/StreamOverlays';
import { FilmingBanner } from '../../components/FilmingBanner';

export function BroadcastPage() {
  const { competition, streamingEnabled } = useCompetition();
  const { canOrganise } = useAuth();
  if (!canOrganise(competition)) return <p>Only the organiser can broadcast.</p>;
  if (!streamingEnabled) return <p>Streaming is not set up for this event.</p>;
  if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices) return <p>This browser cannot broadcast. Try Safari or Chrome over a secure connection.</p>;
  return <BroadcastStudio key={competition.id} />;
}
function BroadcastStudio() {
  const { competition, streams, streamMessages } = useCompetition();
  const navigate = useNavigate();
  const publisher = useRef<ReturnType<typeof createStreamPublisher> | null>(null);
  const [snapshot, setSnapshot] = useState<PublisherSnapshot>({ state: 'idle', media: null, streamId: null, viewerCount: 0, signal: 'good', audioMuted: false, hasAudio: false, error: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const arenas = [...new Set(competition.sessions.map((session) => session.arenaName?.trim()).filter((name): name is string => !!name))];
  const [arena, setArena] = useState(arenas[0] ?? '');
  const [angle, setAngle] = useState('Main camera');
  const [otherArena, setOtherArena] = useState(arenas.length === 0);
  const [otherAngle, setOtherAngle] = useState(false);
  const [sound, setSound] = useState(true);
  const [caption, setCaption] = useState('');
  const [editingCaption, setEditingCaption] = useState(false);
  const [ending, setEnding] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const video = useRef<HTMLVideoElement>(null);
  const live = ['starting', 'live', 'paused', 'reconnecting'].includes(snapshot.state);
  const canControl = snapshot.state === 'live' || snapshot.state === 'paused';
  const currentStream = streams.find((stream) => stream.id === snapshot.streamId);
  const label = caption || streamHeatLabel(competition.sessions, arena) || `${arena} · ${angle}`;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const occupied = !live && streams.some((stream) => stream.status !== 2 && same(stream.arenaName, arena) && same(stream.angleName, angle));
  useEffect(() => {
    const next = createStreamPublisher(competition.id, browserPublisherDependencies());
    publisher.current = next;
    const unsubscribe = next.subscribe(() => setSnapshot(next.getSnapshot()));
    return () => { unsubscribe(); next.dispose(); setBroadcasting(false); };
  }, [competition.id]);
  useEffect(() => {
    if (!video.current) return;
    video.current.muted = true; video.current.playsInline = true; video.current.autoplay = true;
    video.current.srcObject = snapshot.media;
    if (snapshot.media) void video.current.play().catch(() => { /* Preview remains available after the next tap. */ });
  }, [snapshot.media, live]);
  useEffect(() => {
    setBroadcasting(live);
    if (!live) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { window.removeEventListener('beforeunload', warn); clearInterval(timer); setBroadcasting(false); };
  }, [live]);
  useEffect(() => { if (currentStream) publisher.current?.viewers(currentStream.viewerCount); }, [currentStream]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); } catch { setError('Could not complete that change. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  const flip = () => run(() => publisher.current!.switchCamera());
  const end = async () => {
    setEnding(true); setError('');
    try { await publisher.current!.stop(); navigate(`/competitions/${competition.id}/chat`); }
    catch { setError('The camera has stopped. Could not confirm the end with the server.'); }
    finally { setEnding(false); }
  };
  const elapsed = Math.max(0, Math.floor((now - (startedAt ?? now)) / 1000));
  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const preview = <video ref={video} muted autoPlay playsInline className="h-full w-full object-cover" aria-label="Camera preview" />;
  if (live) return createPortal(<div className="mg-font fixed inset-0 z-[100] bg-[rgb(var(--mg-header-deep))] text-white">
    {preview}
    <OverlayLayer>
      <div className="absolute left-4 right-20 top-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="mg-badge mg-badge-live">LIVE {time}</span>
        <span className="mg-stream-glass flex items-center gap-1 px-2 py-1"><Eye className="h-4 w-4" />{snapshot.viewerCount}</span>
        <span className={`mg-stream-glass flex items-center gap-1 border px-2 py-1 ${snapshot.signal === 'poor' ? 'border-[rgb(var(--mg-red))]' : snapshot.signal === 'fair' ? 'border-amber-400' : 'border-transparent'}`}><Wifi className="h-4 w-4" />{snapshot.signal === 'good' ? 'Good' : snapshot.signal === 'fair' ? 'Fair' : 'Weak signal'}</span>
        <span className="mg-stream-glass px-2 py-1">{arena} · {angle}</span>
      </div>
      <SponsorOverlay arenaName={arena} track={false} />
      <div className="absolute left-4 right-24 top-14"><FilmingBanner competitionId={competition.id} refreshKey={competition.sessions} /></div>
      <div className="pointer-events-auto absolute bottom-4 right-3 top-16 flex flex-col justify-center gap-2 overflow-y-auto text-center text-xs">
        <button className="mg-stream-control flex-col !rounded-xl p-2" disabled={busy || !canControl} onClick={flip}><RefreshCw />Flip</button>
        <button className="mg-stream-control flex-col !rounded-xl p-2" disabled={busy || !canControl} onClick={() => run(() => publisher.current!.mute(!snapshot.audioMuted))}>{snapshot.audioMuted ? <MicOff /> : <Mic />}{snapshot.audioMuted ? 'Sound off' : 'Sound on'}</button>
        <button className="mg-stream-control flex-col !rounded-xl p-2" disabled={busy || !canControl} onClick={() => run(() => publisher.current!.pause(snapshot.state !== 'paused'))}>{snapshot.state === 'paused' ? <Play /> : <Pause />}{snapshot.state === 'paused' ? 'Resume' : 'Back soon'}</button>
        <BannerButton competitionId={competition.id} />
        <SponsorButtons competitionId={competition.id} />
        <button className="mg-stream-control flex-col !rounded-xl !bg-[rgb(var(--mg-red))] p-2" onClick={() => setConfirmEnd(true)}><Square />End</button>
      </div>
      <div className="absolute bottom-20 left-4 right-24 flex flex-col items-start gap-2">{streamMessages.slice(-3).map((item) => <StreamNotice key={`${item.message.id}-${item.receivedAt}`} {...item} duration={10_000} />)}</div>
      <div className="pointer-events-auto absolute bottom-4 left-4 right-24">
        {editingCaption ? <form className="mg-stream-glass flex gap-2 p-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await publisher.current!.caption(caption); setEditingCaption(false); }); }}><input aria-label="Viewers see" className="min-w-0 flex-1 bg-transparent p-2 text-white" maxLength={80} value={caption} placeholder="Leave blank for the timetable" onChange={(event) => setCaption(event.target.value)} /><button disabled={busy}>Save</button></form>
          : <button className="mg-stream-glass px-3 py-2 text-left text-sm" onClick={() => setEditingCaption(true)}><span className="mr-2 text-xs uppercase text-[rgb(var(--mg-header-sub))]">Viewers see</span>{label}</button>}
      </div>
      {snapshot.state === 'paused' && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgb(var(--mg-header-deep)/0.65)]"><h2 className="text-2xl font-bold">Viewers see Back soon</h2><button className="mg-stream-control pointer-events-auto px-4" disabled={busy} onClick={() => run(() => publisher.current!.pause(false))}><Play />Resume</button></div>}
      {(snapshot.state === 'starting' || snapshot.state === 'reconnecting') && <p role="status" className="mg-stream-glass absolute left-4 top-1/2 p-3">{snapshot.state === 'starting' ? 'Starting stream…' : 'Reconnecting…'}</p>}
      {error && <p role="alert" className="mg-stream-glass absolute left-4 right-24 top-20 p-3">{error}</p>}
      {confirmEnd && <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-[rgb(var(--mg-header-deep)/0.8)]"><div role="alertdialog" aria-modal="true" aria-labelledby="end-stream-title" className="mg-stream-glass mx-4 max-w-sm space-y-3 border border-[rgb(var(--mg-header-line))] p-5"><h2 id="end-stream-title" className="text-2xl font-bold">End the stream?</h2><p>Viewers will see that it has finished.</p><div className="flex gap-3"><button autoFocus className="mg-stream-control !rounded-xl px-3" onClick={() => setConfirmEnd(false)}>Keep going</button><button disabled={ending} className="mg-stream-control !rounded-xl !bg-[rgb(var(--mg-red))] px-3" onClick={end}>End stream</button></div></div></div>}
    </OverlayLayer>
  </div>, document.body);
  return <div className="mx-auto flex max-w-xl flex-col gap-4 pb-6">
    <Link className="mg-text-link" to={`/competitions/${competition.id}/chat`}>‹ Live &amp; stream</Link><h1 className="mg-h1">Go live</h1>
    {error || snapshot.error ? <p role="alert" className="mg-notice">{error || snapshot.error}</p> : null}
    <FilmingBanner competitionId={competition.id} refreshKey={competition.sessions} />
    <label className="mg-card flex items-center justify-between p-3"><span>Sound</span><input type="checkbox" checked={sound} disabled={busy} onChange={(event) => { const next = event.target.checked; void run(async () => { if (snapshot.media) await publisher.current!.capture(next); setSound(next); }); }} /></label>
    {!snapshot.media ? <button disabled={busy} className="mg-btn mg-btn-primary min-h-12" onClick={() => run(async () => { await publisher.current!.capture(sound); setDevices(await publisher.current!.devices()); })}><Camera />Allow camera</button> : <>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-[rgb(var(--mg-header-deep))]">{preview}<span className="mg-font mg-stream-glass absolute left-3 top-3 px-2 py-1">Preview</span><button className="mg-stream-control absolute bottom-3 right-3" aria-label="Flip camera" disabled={busy} onClick={flip}><RefreshCw /></button></div>
      <fieldset><legend className="mb-2 font-semibold">Arena</legend><div className="flex flex-wrap gap-2">{arenas.map((name) => <button className="mg-stream-chip" aria-pressed={!otherArena && name === arena} key={name} onClick={() => { setArena(name); setOtherArena(false); }}>{name}</button>)}<button className="mg-stream-chip" aria-pressed={otherArena} onClick={() => { setOtherArena(true); setArena(''); }}>Other…</button></div>{otherArena && <input aria-label="Arena name" className="input mt-2" maxLength={80} value={arena} onChange={(event) => setArena(event.target.value)} />}</fieldset>
      <fieldset><legend className="mb-2 font-semibold">Camera position</legend><div className="flex flex-wrap gap-2">{['Main camera', 'Finish line', 'Start line', 'Wide'].map((name) => <button key={name} className="mg-stream-chip" aria-pressed={!otherAngle && name === angle} onClick={() => { setAngle(name); setOtherAngle(false); }}>{name}</button>)}<button className="mg-stream-chip" aria-pressed={otherAngle} onClick={() => { setOtherAngle(true); setAngle(''); }}>Other…</button></div>{otherAngle && <input aria-label="Camera position" className="input mt-2" maxLength={60} value={angle} onChange={(event) => setAngle(event.target.value)} />}</fieldset>
      <label className="flex flex-col gap-2 font-semibold">Camera<select className="input" disabled={busy} defaultValue="" onChange={(event) => run(() => publisher.current!.switchCamera(event.target.value))}><option value="" disabled>Choose camera</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
      {occupied && <p role="status" className="mg-notice">Someone is already streaming {arena} · {angle}. Going live takes over from them.</p>}
      <p className="mg-notice">Anyone can watch. Check families know the event is being filmed. Keep this screen on: locking the phone pauses the stream.</p>
      <button disabled={busy || !arena.trim() || !angle.trim()} className="mg-btn mg-btn-primary !min-h-[52px] !bg-[rgb(var(--mg-red))] !text-white" onClick={() => run(async () => { setStartedAt(Date.now()); await publisher.current!.start(arena, angle, occupied); })}><VideoIcon />{occupied ? 'Take over and go live' : 'Go live'}</button>
    </>}
  </div>;
}
function VideoIcon() { return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" />; }

/**
 * A quick banner switch for the person filming: clears the banner that's up, or puts back the latest
 * message saved on this phone's producer screen. Everything else lives on the producer screen.
 */
export function BannerButton({ competitionId }: { competitionId: number }) {
  const { overlay, saveOverlay } = useCompetition();
  const [busy, setBusy] = useState(false);
  const current = overlay ?? DEFAULT_OVERLAY;
  const on = current.bannerText !== null;
  const next = readMessages(competitionId).at(-1);
  if (!saveOverlay || (!on && !next)) return null;
  async function toggle() {
    setBusy(true);
    await saveOverlay!((o) => (on ? { ...o, bannerText: null } : { ...o, bannerText: next!.text, bannerStyle: next!.style }));
    setBusy(false);
  }
  return <button className={`mg-stream-control flex-col !rounded-xl p-2 ${on ? '!bg-amber-500 !text-black' : ''}`} disabled={busy} onClick={() => void toggle()}
    aria-label={on ? 'Clear the banner' : `Show banner: ${next!.text}`}><Megaphone />{on ? 'Banner on' : 'Banner'}</button>;
}


/**
 * Sponsor cards on the video: a switch between "in breaks" and off, and a skip to the next sponsor. Hidden when
 * no sponsor is set to show on the video, or when this phone can't change the overlays.
 */
export function SponsorButtons({ competitionId }: { competitionId: number }) {
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
      aria-label={on ? 'Turn sponsors off' : 'Turn sponsors on'}><Handshake />{on ? 'Sponsors on' : 'Sponsors off'}</button>
    {on && <button className="mg-stream-control flex-col !rounded-xl p-2" disabled={busy} onClick={() => void skip()} aria-label="Skip sponsor"><SkipForward />Skip</button>}
  </>;
}
