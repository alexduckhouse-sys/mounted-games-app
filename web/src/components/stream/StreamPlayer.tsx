import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize, Play, X } from 'lucide-react';
import type { ChatMessage, LiveStream } from '../../types';
import { StreamOverlays } from './StreamOverlays';

export function StreamPlayer({ media, stream, label, reconnecting = false, message, announcement }: {
  media: MediaStream | null; stream: LiveStream; label: string; reconnecting?: boolean; message?: string | null;
  announcement?: { message: ChatMessage; receivedAt: number };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [full, setFull] = useState(false);
  const [muted, setMuted] = useState(true);
  const [needsPlay, setNeedsPlay] = useState(false);
  const soundOff = muted || stream.status === 1 || stream.audioMuted;
  useEffect(() => {
    const video = videoRef.current!;
    let cancelled = false;
    // Safari needs these properties before srcObject, even when JSX supplied the attributes.
    video.muted = soundOff; video.playsInline = true; video.autoplay = true;
    video.srcObject = media;
    if (media) void video.play().then(() => { if (!cancelled) setNeedsPlay(false); }).catch(() => { if (!cancelled) setNeedsPlay(true); });
    return () => { cancelled = true; video.srcObject = null; };
  }, [media, full, soundOff]);
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
    containerRef.current?.querySelector<HTMLButtonElement>('[aria-label="Close full screen"]')?.focus();
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
  const player = <div ref={containerRef} className={`mg-font overflow-hidden bg-[rgb(var(--mg-header-deep))] text-white ${full ? 'fixed inset-0 z-[100]' : 'relative aspect-video rounded-2xl'}`} role={full ? 'dialog' : undefined} aria-modal={full || undefined} aria-label={full ? 'Live video' : undefined}>
    <video ref={videoRef} muted={soundOff} playsInline autoPlay className="h-full w-full object-contain" onClick={open} aria-label={`${stream.arenaName}, ${stream.angleName}`} />
    <StreamOverlays stream={stream} label={label} reconnecting={reconnecting} muted={muted} onSound={() => setMuted(false)} announcement={announcement}>
      <button className="mg-stream-control pointer-events-auto absolute right-3 top-3" aria-label={full ? 'Close full screen' : 'Open full screen'} onClick={full ? close : open}>{full ? <X /> : <Maximize />}</button>
      {needsPlay && <button className="mg-stream-control pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 !rounded-xl px-4" onClick={() => { void videoRef.current!.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true)); }}><Play /> Play</button>}
      {message && <p role="status" className="mg-stream-glass absolute left-3 right-3 top-1/2 p-3 text-center">{message}</p>}
    </StreamOverlays>
  </div>;
  return full ? <><div className="aspect-video rounded-2xl bg-[rgb(var(--mg-header-deep))]" />{createPortal(player, document.body)}</> : player;
}
