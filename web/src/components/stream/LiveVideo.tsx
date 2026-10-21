import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Video } from 'lucide-react';
import type { ChatMessage, LiveStream, Session } from '../../types';
import { streamHeatLabel, streamLink } from '../../lib/streams';
import { browserViewerDependencies, createStreamViewer, type ViewerSnapshot } from '../../live/streamViewer';
import type { StreamInvoke } from '../../live/streamRuntime';
import { StreamChips } from './StreamChips';
import { StreamPlayer } from './StreamPlayer';

export function LiveVideo({ competitionId, streams, sessions, invoke, ready, messages, canBroadcast, fallback, competitionName, publicLayout = false, showPlaceholder = false }: {
  competitionId: number; streams: LiveStream[]; sessions: Session[]; invoke: StreamInvoke; ready: number;
  messages: { message: ChatMessage; receivedAt: number }[]; canBroadcast: boolean; fallback?: string | null; competitionName: string;
  publicLayout?: boolean; showPlaceholder?: boolean;
}) {
  const [selectedId, select] = useState<number | null>(null);
  const active = streams.filter((stream) => stream.status !== 2);
  const selected = active.find((stream) => stream.id === selectedId) ?? active[0];
  const label = selected ? selected.caption || streamHeatLabel(sessions, selected.arenaName) : null;
  return <section className={`flex min-h-0 flex-col ${publicLayout ? '' : 'gap-3'}`}>
    {!publicLayout && (selected || canBroadcast) && <div className="flex items-center gap-3"><h2 className="mg-h2 flex-1">Live video</h2>
      {canBroadcast && <Link to={`/competitions/${competitionId}/broadcast`} className="mg-btn mg-btn-primary !bg-[rgb(var(--mg-red))] !text-white"><Video aria-hidden="true" className="h-4 w-4" />Go live</Link>}
    </div>}
    {selected ? <>
      <div className={publicLayout && active.length > 1 ? 'pb-2' : ''}><StreamChips streams={active} selected={selected} onSelect={select} /></div>
      {typeof RTCPeerConnection === 'undefined' ? <p role="status" className="mg-card p-4">Live video is not supported in this browser.</p> : <ConnectedPlayer key={selected.id} stream={selected} invoke={invoke} ready={ready} announcement={messages.filter((item) => item.message.type === 2).at(-1)} captionBar={publicLayout} label={label} />}
    </> : fallback ? <CompStreamCard key={fallback} streamUrl={fallback} compName={competitionName} publicLayout={publicLayout} />
      : showPlaceholder ? <div className="live-stream-placeholder mg-card" role="status"><Video aria-hidden="true" /><strong>Stream hasn’t started</strong></div> : null}
  </section>;
}
function ConnectedPlayer({ stream, invoke, ready, announcement, captionBar, label }: {
  stream: LiveStream; invoke: StreamInvoke; ready: number;
  announcement?: { message: ChatMessage; receivedAt: number };
  captionBar?: boolean; label: string | null;
}) {
  const viewer = useRef<ReturnType<typeof createStreamViewer> | null>(null);
  const [snapshot, setSnapshot] = useState<ViewerSnapshot>({ media: null, state: 'connecting', message: null });
  useEffect(() => {
    const next = createStreamViewer(stream.competitionId, stream.id, browserViewerDependencies(invoke));
    viewer.current = next;
    const unsubscribe = next.subscribe(() => setSnapshot(next.getSnapshot()));
    return () => { unsubscribe(); next.dispose(); };
  }, [stream.competitionId, stream.id, invoke]);
  useEffect(() => { viewer.current!.sync(ready, stream.generation); }, [ready, stream.generation, stream.competitionId, stream.id, invoke]);
  return <StreamPlayer media={snapshot.media} stream={stream} label={label} reconnecting={snapshot.state === 'reconnecting'} message={snapshot.message || (snapshot.state === 'connecting' ? 'Connecting…' : null)} announcement={announcement} captionBar={captionBar} />;
}
export function CompStreamCard({ streamUrl, compName, publicLayout = false }: { streamUrl: string; compName: string; publicLayout?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const link = streamLink(streamUrl);
  if (!link) return null;
  return <div className={`mg-card overflow-hidden ${publicLayout ? 'live-stream-frame' : ''}`}>
    {!publicLayout && <div className="flex items-center justify-between gap-3 px-4 py-3"><h2 className="mg-h2">Stream</h2><a href={link.href} target="_blank" rel="noreferrer" className="mg-text-link">Open stream</a></div>}
    {link.embed && (loaded ? <iframe src={link.embed} title={compName} className="aspect-video w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      : <button className="mg-font flex aspect-video w-full items-center justify-center gap-2 bg-[rgb(var(--mg-header-deep))] text-white" onClick={() => setLoaded(true)}><Video aria-hidden="true" />Tap to load the stream</button>)}
    {!link.embed && publicLayout && <a href={link.href} target="_blank" rel="noreferrer" className="mg-font flex aspect-video w-full items-center justify-center gap-2 bg-[rgb(var(--mg-header-deep))] text-white"><Video aria-hidden="true" />Open stream</a>}
    {publicLayout && <div className="live-stream-caption"><span className="mg-badge mg-badge-outline">Stream</span><strong>{compName}</strong><a href={link.href} target="_blank" rel="noreferrer">Full screen</a></div>}
  </div>;
}
