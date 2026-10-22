import { useEffect, useState, type ReactNode } from 'react';
import { Megaphone, VolumeX } from 'lucide-react';
import { OverlayChips, ProducerBanner, ScoreCardOverlay } from './OverlayExtras';
import { useOverlay } from '../../hooks/useOverlay';
import { lookStyle } from '../../lib/overlays';
import type { ChatMessage, LiveStream } from '../../types';

/** New score cards or producer banners can be supplied as additional overlay items. */
export function OverlayLayer({ children }: { children: ReactNode }) {
  const { look } = useOverlay();
  return <div className={`mg-font mg-ov-${look.size} pointer-events-none absolute inset-0 text-white`} style={lookStyle(look)}>{children}</div>;
}
export function StreamNotice({ message, receivedAt, duration = 8000 }: { message: ChatMessage; receivedAt: number; duration?: number }) {
  const [visible, setVisible] = useState(() => Date.now() - receivedAt < duration);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), Math.max(0, duration - (Date.now() - receivedAt)));
    return () => clearTimeout(timer);
  }, [receivedAt, duration]);
  if (!visible) return null;
  return <div role="status" className="mg-stream-glass mg-stream-fade flex max-w-md gap-2 p-3 text-sm">
    {message.type === 2 && <Megaphone aria-hidden="true" className="h-5 w-5 shrink-0" />}
    <p><strong>{message.type === 2 ? 'Announcement' : message.authorName}</strong> · {message.body}</p>
  </div>;
}
export function StreamOverlays({ stream, label, reconnecting, muted, onSound, announcement, hideCaption = false, children }: {
  stream: LiveStream; label: string | null; reconnecting: boolean; muted: boolean; onSound: () => void;
  announcement?: { message: ChatMessage; receivedAt: number }; hideCaption?: boolean; children?: ReactNode;
}) {
  const { overlay, look, scoreCards } = useOverlay();
  // Off hides the now-racing strip; Auto and On show it, naming the heat when one is running.
  const showStrip = !hideCaption && overlay.stripMode !== 2 && look.elements.strip.show;
  const stripEdge = look.elements.strip.place === 'top' ? 'top-0 pt-12' : 'bottom-0';
  return <OverlayLayer>
    <OverlayChips stream={stream} look={look} live={<span className="mg-badge mg-badge-live">LIVE</span>} />
    {showStrip && <div className={`mg-ov-strip absolute left-0 right-0 ${stripEdge} flex items-center gap-2 px-3 py-2 text-xs sm:text-sm`}>
      <div className="min-w-0 flex-1 truncate"><span className="block text-[10px] uppercase tracking-wider text-[rgb(var(--mg-header-sub))]">{stream.caption ? 'Now' : label ? 'Now racing' : 'Live from'}</span>{label ?? `${stream.arenaName} · ${stream.angleName}`}</div>
      {stream.hasAudio && !stream.audioMuted && stream.status !== 1 && muted && <button className="mg-stream-glass pointer-events-auto flex min-h-11 shrink-0 items-center gap-1 px-2" onClick={onSound}><VolumeX aria-hidden="true" className="h-4 w-4" />Tap for sound</button>}
    </div>}
    <ProducerBanner stream={stream} overlay={overlay} look={look} />
    <ScoreCardOverlay stream={stream} overlay={overlay} look={look} cards={scoreCards} />
    {announcement && <div className="absolute left-3 right-3 top-14 flex justify-center"><StreamNotice key={`${announcement.message.id}-${announcement.receivedAt}`} {...announcement} /></div>}
    {reconnecting && stream.status !== 1 && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center bg-[rgb(var(--mg-header-deep)/0.7)]"><h3 className="text-2xl font-bold">Reconnecting…</h3><p className="text-sm">The signal dropped. Trying again.</p></div>}
    {stream.status === 1 && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center bg-[rgb(var(--mg-header-deep))]"><span className="mg-logo mb-3">MG</span><h3 className="text-3xl font-bold">Back soon</h3><p>The camera is being moved.</p><p className="mt-3 text-xs">{stream.arenaName} · {stream.angleName}</p></div>}
    {children}
  </OverlayLayer>;
}
