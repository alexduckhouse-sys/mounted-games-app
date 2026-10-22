import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { AlertTriangle, Clock, Eye, MapPin, Megaphone } from 'lucide-react';
import type { LiveStream, StreamOverlay } from '../../types';
import { bannerShowsIn, type OverlayLook, type OverlayPlace } from '../../lib/overlays';

const CORNERS: Partial<Record<OverlayPlace, string>> = {
  'top-left': 'left-3 top-3', 'top-right': 'right-3 top-3', 'bottom-left': 'left-3 bottom-14', 'bottom-right': 'right-3 bottom-14',
};

function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function ClockChip() {
  const time = useMinuteClock();
  return <span className="mg-ov-chip"><Clock aria-hidden="true" />{time}</span>;
}

/** The small corner pieces a producer can switch on: viewer count, arena, clock and logo. */
export function OverlayChips({ stream, look, live }: { stream: LiveStream; look: OverlayLook; live: ReactNode }) {
  // The LIVE badge always leads the top-left corner; the producer's chips join whichever corner they chose.
  const corners = new Map<string, ReactElement[]>([[CORNERS['top-left']!, [<span key="live">{live}</span>]]]);
  const add = (place: OverlayPlace, element: ReactElement) => {
    const corner = CORNERS[place];
    if (corner) corners.set(corner, [...(corners.get(corner) ?? []), element]);
  };
  const { logo, viewers, arena, clock } = look.elements;
  if (logo.show && look.logoUrl) add(logo.place, <img key="logo" className="mg-ov-logo" src={look.logoUrl} alt="" />);
  if (viewers.show) add(viewers.place, <span key="viewers" className="mg-ov-chip"><Eye aria-hidden="true" />{stream.viewerCount} watching</span>);
  if (arena.show) add(arena.place, <span key="arena" className="mg-ov-chip"><MapPin aria-hidden="true" />{stream.arenaName}</span>);
  if (clock.show) add(clock.place, <ClockChip key="clock" />);
  return <>{[...corners].map(([corner, items]) => (
    <div key={corner} className={`absolute flex flex-wrap items-center gap-2 ${corner}`}>{items}</div>
  ))}</>;
}

/** The producer's banner, in the chosen style and position, on streams from the arenas it's meant for. */
export function ProducerBanner({ stream, overlay, look }: { stream: LiveStream; overlay: StreamOverlay; look: OverlayLook }) {
  if (!look.elements.banner.show || !bannerShowsIn(overlay, stream.arenaName)) return null;
  const edge = look.elements.banner.place === 'top' ? 'top-12' : 'bottom-12';
  const text = overlay.bannerText!;
  if (overlay.bannerStyle === 2) {
    return <div role="status" className="absolute inset-x-3 top-1/3 flex justify-center">
      <div className="mg-ov-alert mg-stream-fade"><AlertTriangle aria-hidden="true" /><strong>{text}</strong></div>
    </div>;
  }
  if (overlay.bannerStyle === 1) {
    return <div role="status" className={`mg-ov-lower mg-stream-fade absolute inset-x-0 ${edge}`}><Megaphone aria-hidden="true" /><span>{text}</span></div>;
  }
  return <div role="status" className={`mg-ov-ticker absolute inset-x-0 ${edge}`} aria-label={text}>
    <span aria-hidden="true">{text}</span>
  </div>;
}
