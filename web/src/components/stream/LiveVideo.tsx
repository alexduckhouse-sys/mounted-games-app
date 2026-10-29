import { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Video } from 'lucide-react';
import type { ChatMessage, LiveStream, Session, StreamCommand } from '../../types';
import { streamHeatLabel, streamLink } from '../../lib/streams';
import { SPECTATOR_NOTICE } from '../../lib/termsTick';
import { browserViewerDependencies, createStreamViewer, type ViewerSnapshot } from '../../live/streamViewer';
import type { StreamInvoke } from '../../live/streamRuntime';
import { useShowgroundRadio } from '../../hooks/useShowgroundRadio';
import { useLiteMode } from '../../lite/LiteModeContext';
import { CompetitionContext } from '../../pages/competition/context';
import { StreamChips } from './StreamChips';
import { StreamPlayer } from './StreamPlayer';
import { useT } from '../../i18n/LanguageContext';

export function LiveVideo({ competitionId, streams, sessions, invoke, ready, messages, canBroadcast, fallback, competitionName, publicLayout = false, showPlaceholder = false, lastCommand, onMedia, enableDvr = true }: {
  competitionId: number; streams: LiveStream[]; sessions: Session[]; invoke: StreamInvoke; ready: number;
  messages: { message: ChatMessage; receivedAt: number }[]; canBroadcast: boolean; fallback?: string | null; competitionName: string;
  publicLayout?: boolean; showPlaceholder?: boolean; lastCommand?: StreamCommand | null;
  /**
   * Hands the live video to the page (for example to record replays from it), with the id of the stream it is
   * playing (also while it connects, when the video is still null). Called with just null when the player goes away.
   */
  enableDvr?: boolean;
  onMedia?: (media: MediaStream | null, streamId?: number) => void;
}) {
  const { lite } = useLiteMode();
  const t = useT();
  const ctx = useContext(CompetitionContext);
  const effectiveCommand = lastCommand !== undefined ? lastCommand : ctx?.lastStreamCommand;
  const [selectedId, select] = useState<number | null>(null);
  const [pinnedAngle, setPinnedAngle] = useState(false);
  // Once a viewer taps to watch, the other angles in this arena start without another tap.
  const [tapped, setTapped] = useState(false);
  const active = streams.filter((stream) => stream.status !== 2);
  const baseSelected = active.find((stream) => stream.id === selectedId) ?? active[0];
  const directorTarget = !pinnedAngle && effectiveCommand?.command === 'selectAngle'
    ? active.find((s) => s.id === Number(effectiveCommand.value || effectiveCommand.streamId))
    : undefined;
  const selected = directorTarget && baseSelected && directorTarget.arenaName.trim().toLowerCase() === baseSelected.arenaName.trim().toLowerCase()
    ? directorTarget
    : baseSelected;
  const label = selected ? selected.caption || streamHeatLabel(sessions, selected.arenaName) : null;

  const handleManualSelect = (id: number) => {
    const next = active.find((s) => s.id === id);
    if (next && selected && next.arenaName.trim().toLowerCase() === selected.arenaName.trim().toLowerCase()) {
      setPinnedAngle(true);
    } else {
      setPinnedAngle(false);
    }
    select(id);
  };

  return <section className={`flex min-h-0 flex-col ${publicLayout ? '' : 'gap-3'}`}>
    {!publicLayout && (selected || canBroadcast) && <div className="flex items-center gap-3"><h2 className="mg-h2 flex-1">{t('teams.stream.liveVideo')}</h2>
      {canBroadcast && <Link to={`/competitions/${competitionId}/broadcast`} className="mg-btn mg-btn-primary !bg-[rgb(var(--mg-red))] !text-white"><Video aria-hidden="true" className="h-4 w-4" />{t('teams.stream.goLive')}</Link>}
    </div>}
    {selected ? <>
      <div className={`flex flex-wrap items-center gap-2 ${publicLayout && active.length > 1 ? 'pb-2' : ''}`}>
        <StreamChips streams={active} selected={selected} onSelect={handleManualSelect} />
        {pinnedAngle && active.filter((s) => s.arenaName.trim().toLowerCase() === selected.arenaName.trim().toLowerCase()).length > 1 && (
          <button
            type="button"
            className="mg-stream-chip text-xs"
            onClick={() => setPinnedAngle(false)}
          >
            {t('teams.stream.autoFollow')}
          </button>
        )}
      </div>
      {typeof RTCPeerConnection === 'undefined' ? <p role="status" className="mg-card p-4">{t('teams.stream.unsupported')}</p>
        : lite && !tapped ? <TapToWatch stream={selected} captionBar={publicLayout} onTap={() => setTapped(true)} />
        : <ConnectedPlayer key={selected.id} stream={selected} invoke={invoke} ready={ready} onMedia={onMedia} enableDvr={enableDvr} announcement={messages.filter((item) => item.message.type === 2).at(-1)} captionBar={publicLayout} label={label} competitionName={competitionName} />}
      <p className={`m-0 text-xs text-[rgb(var(--mg-muted))] ${publicLayout ? 'px-4 pt-2' : ''}`}>{SPECTATOR_NOTICE}</p>
    </> : fallback ? <CompStreamCard key={fallback} streamUrl={fallback} compName={competitionName} publicLayout={publicLayout} />
      : showPlaceholder ? <div className="live-stream-placeholder mg-card" role="status"><strong>{t('teams.stream.notStarted')}</strong></div> : null}
  </section>;
}
/** Lite mode: no connection is made until the viewer asks for the video. */
function TapToWatch({ stream, captionBar, onTap }: { stream: LiveStream; captionBar: boolean; onTap: () => void }) {
  const t = useT();
  return <button type="button" onClick={onTap} className={`mg-tap-video ${captionBar ? '' : 'rounded-xl'}`}>
    <span className="mg-tap-video-play"><Play aria-hidden="true" /></span>
    <b>{t('teams.stream.tapToWatch')}</b>
    <small>{stream.arenaName} · {stream.angleName}. {t('teams.stream.dataNote')}</small>
  </button>;
}
function ConnectedPlayer({ stream, invoke, ready, announcement, captionBar, label, competitionName, onMedia, enableDvr }: {
  enableDvr: boolean;
  stream: LiveStream; competitionName: string; invoke: StreamInvoke; ready: number; onMedia?: (media: MediaStream | null, streamId?: number) => void;
  announcement?: { message: ChatMessage; receivedAt: number };
  captionBar?: boolean; label: string | null;
}) {
  const t = useT();
  const viewer = useRef<ReturnType<typeof createStreamViewer> | null>(null);
  const [snapshot, setSnapshot] = useState<ViewerSnapshot>({ media: null, state: 'connecting', message: null });
  useEffect(() => {
    const next = createStreamViewer(stream.competitionId, stream.id, browserViewerDependencies(invoke));
    viewer.current = next;
    const unsubscribe = next.subscribe(() => setSnapshot(next.getSnapshot()));
    return () => { unsubscribe(); next.dispose(); };
  }, [stream.competitionId, stream.id, invoke]);
  useEffect(() => {
    onMedia?.(snapshot.media, stream.id);
    return () => onMedia?.(null);
  }, [snapshot.media, onMedia, stream.id]);
  // With the video hidden this is a radio: the lock screen names the event, the arena and the heat on air.
  useShowgroundRadio(snapshot.audioOnly === true, { competitionName, arenaName: stream.arenaName, heatLabel: label });
  useEffect(() => { viewer.current!.sync(ready, stream.generation); }, [ready, stream.generation, stream.competitionId, stream.id, invoke]);
  return <StreamPlayer enableDvr={enableDvr} media={snapshot.media} stream={stream} label={label} reconnecting={snapshot.state === 'reconnecting'} message={snapshot.message || (snapshot.state === 'connecting' ? t('teams.stream.connecting') : null)} announcement={announcement} captionBar={captionBar} quality={snapshot.preferredRid ?? 'f'} onQuality={(rid) => viewer.current?.setQuality(rid)} audioOnly={snapshot.audioOnly} onAudioOnly={(enabled) => viewer.current?.setAudioOnly(enabled)} onSyncLive={() => viewer.current?.syncLive()} />;
}
export function CompStreamCard({ streamUrl, compName, publicLayout = false }: { streamUrl: string; compName: string; publicLayout?: boolean }) {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  const link = streamLink(streamUrl);
  if (!link) return null;
  return <div className={`mg-card overflow-hidden ${publicLayout ? 'live-stream-frame' : ''}`}>
    {!publicLayout && <div className="flex items-center justify-between gap-3 px-4 py-3"><h2 className="mg-h2">{t('teams.stream.stream')}</h2><a href={link.href} target="_blank" rel="noreferrer" className="mg-text-link">{t('teams.stream.openStream')}</a></div>}
    {link.embed && (loaded ? <iframe src={link.embed} title={compName} className="aspect-video w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      : <button className="mg-font flex aspect-video w-full items-center justify-center gap-2 bg-[rgb(var(--mg-header-deep))] text-white" onClick={() => setLoaded(true)}><Video aria-hidden="true" />{t('teams.stream.tapToLoad')}</button>)}
    {!link.embed && publicLayout && <a href={link.href} target="_blank" rel="noreferrer" className="mg-font flex aspect-video w-full items-center justify-center gap-2 bg-[rgb(var(--mg-header-deep))] text-white"><Video aria-hidden="true" />{t('teams.stream.openStream')}</a>}
    {publicLayout && <div className="live-stream-caption"><span className="mg-badge mg-badge-outline">{t('teams.stream.stream')}</span><strong>{compName}</strong><a href={link.href} target="_blank" rel="noreferrer">{t('teams.stream.fullScreen')}</a></div>}
  </div>;
}
