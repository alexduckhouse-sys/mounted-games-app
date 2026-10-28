import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n/LanguageContext';
import { browserViewerDependencies, createStreamViewer } from '../../../live/streamViewer';
import type { StreamInvoke } from '../../../live/streamRuntime';
import type { LiveStream } from '../../../types';

/** A small muted picture. Safari wants muted, inline and autoplay set before the stream is attached. */
function PreviewVideo({ media, label }: { media: MediaStream | null; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.srcObject = media;
    if (media) void Promise.resolve().then(() => video.play()).catch(() => { /* A refused autoplay leaves the box dark; the list still works. */ });
    return () => { video.srcObject = null; };
  }, [media]);
  return (
    <span className="sx-preview" data-ready={media ? 'true' : 'false'}>
      <video ref={ref} muted playsInline autoPlay aria-label={label} />
    </span>
  );
}

/**
 * Its own viewer on the competition's hub, asking for the smallest simulcast layer (`q`, about 350 kbps) and
 * holding no wake lock, so a row of previews stays cheap on showground signal.
 */
function ViewerPreview({ stream, invoke, ready, label }: { stream: LiveStream; invoke: StreamInvoke; ready: number; label: string }) {
  const viewer = useRef<ReturnType<typeof createStreamViewer> | null>(null);
  const [media, setMedia] = useState<MediaStream | null>(null);
  useEffect(() => {
    const next = createStreamViewer(stream.competitionId, stream.id, { ...browserViewerDependencies(invoke), wakeLock: undefined });
    next.setQuality('q');
    viewer.current = next;
    const unsubscribe = next.subscribe(() => setMedia(next.getSnapshot().media));
    return () => { unsubscribe(); next.dispose(); if (viewer.current === next) viewer.current = null; };
  }, [stream.competitionId, stream.id, invoke]);
  useEffect(() => { viewer.current?.sync(ready, stream.generation); }, [ready, stream.generation, stream.competitionId, stream.id, invoke]);
  return <PreviewVideo media={media} label={label} />;
}

/**
 * A live thumbnail of one camera. The camera already playing in the big player reuses that picture: one hub
 * connection holds one viewer per stream, so a second viewer of the same stream would knock the big one off.
 */
export function CameraPreview({ stream, invoke, ready, monitorMedia }: {
  stream: LiveStream; invoke: StreamInvoke; ready: number;
  /** The big player's picture when it shows this camera; leave undefined to open a small viewer of its own. */
  monitorMedia?: MediaStream | null;
}) {
  const t = useT();
  const label = t('desk.stream.cam.preview', { angle: stream.angleName });
  return monitorMedia !== undefined
    ? <PreviewVideo media={monitorMedia} label={label} />
    : <ViewerPreview stream={stream} invoke={invoke} ready={ready} label={label} />;
}
