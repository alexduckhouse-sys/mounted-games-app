import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Clock, Eye, MapPin, Megaphone } from 'lucide-react';
import type { LiveStream, StreamOverlay } from '../../types';
import { bannerShowsIn, type OverlayLook, type OverlayPlace } from '../../lib/overlays';
import type { QueuedScoreCard } from '../../lib/scoreCard';

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

/** The latest card for this stream's arena, while it's due on screen: from the delay until the delay plus its length. */
function useDueCard(cards: QueuedScoreCard[], arenaName: string, delayMs: number, defaultLengthMs: number): QueuedScoreCard | null {
  const arena = arenaName.trim();
  const card = cards.filter((c) => c.arenaName === '' || c.arenaName === arena).at(-1) ?? null;
  // A producer can change how long this card stays up.
  const lengthMs = card?.seconds ? card.seconds * 1000 : defaultLengthMs;
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!card) return;
    const show = card.receivedAt + delayMs;
    const hide = show + lengthMs;
    // The next edge after what's on screen now: showing, then hiding. A card already due shows at once.
    const next = now < show ? show : now < hide ? hide : null;
    if (next === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [card, delayMs, lengthMs, now]);
  if (!card || now < card.receivedAt + delayMs || now >= card.receivedAt + delayMs + lengthMs) return null;
  return card;
}

/** The whole heat table after the race just scored, with what it added and who moved. */
export function ScoreCardOverlay({ stream, overlay, look, cards }: { stream: LiveStream; overlay: StreamOverlay; look: OverlayLook; cards: QueuedScoreCard[] }) {
  const due = useDueCard(cards, stream.arenaName, overlay.scoreCardDelaySeconds * 1000, overlay.scoreCardSeconds * 1000);
  if (!due || overlay.scoreCardMode === 2 || !look.elements.scoreCard.show) return null;
  const { card } = due;
  const where = look.elements.scoreCard.place === 'bottom' ? 'mg-ov-card-bottom' : 'mg-ov-card-right';
  return (
    <section className={`mg-ov-card mg-stream-fade ${where}`} aria-label={`Results: ${due.heading}`}>
      <header>
        <strong>{due.heading}</strong>
        <span>after {card.raceName} (race {card.raceNumber} of {card.raceCount})</span>
      </header>
      <ol>
        {card.rows.filter((row) => !due.hiddenTeamIds?.includes(row.teamId)).map((row) => (
          <li key={row.teamId}>
            <span className="mg-ov-card-place">{row.place}</span>
            <span className="mg-ov-card-team">{due.names?.[row.teamId] ?? row.teamName}</span>
            {row.change === 'up' && <ArrowUp className="mg-ov-card-up" aria-label="moved up" />}
            {row.change === 'down' && <ArrowDown className="mg-ov-card-down" aria-label="moved down" />}
            <span className={`mg-ov-card-added ${row.eliminated ? 'is-out' : ''}`}>{row.eliminated ? 'E' : `+${row.added}`}</span>
            <span className="mg-ov-card-total">{row.total}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
