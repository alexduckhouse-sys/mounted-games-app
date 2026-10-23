import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, Video } from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { tickerFocusAfterChange, type TickerItem, type TickerKind } from '../lib/ticker';
import { useTicker } from './TickerContext';

const ROTATE_MS = 4500;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The badge in front of each line; the dark strip keeps every badge readable in every theme. */
const KIND_BADGES: Record<TickerKind, { label: string; className: string; srLabel?: string } | null> = {
  live: { label: 'Live', className: 'mg-badge-live' },
  next: { label: 'Next', className: 'mg-badge-soft' },
  late: { label: 'Late', className: 'mg-badge-late' },
  ontime: { label: 'On time', className: 'mg-badge-soft' },
  break: { label: 'Break', className: 'mg-badge-soft' },
  finals: { label: 'Finals', className: 'mg-badge-soft' },
  result: { label: 'Result', className: 'mg-badge-soft', srLabel: 'Result' },
  announcement: { label: 'Notice', className: 'mg-badge-notice', srLabel: 'Announcement' },
  info: null,
};

/** A final that is on now gets the live badge; the "Now:" prefix is dropped because the badge says it. */
function badgeFor(item: TickerItem) {
  const now = item.text.startsWith('Now: ');
  const badge = item.kind === 'finals' && now ? KIND_BADGES.live : KIND_BADGES[item.kind];
  return { badge, text: now && badge?.className === 'mg-badge-live' ? item.text.slice(5) : item.text };
}

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
const prefersReducedMotion = () => window.matchMedia?.(REDUCED_MOTION).matches ?? false;

/** One line that rolls through what is on now, delays, what is next and organiser announcements. Tap for the live feed. */
export function TopBarTicker() {
  const { current } = useCurrentCompetition();
  // The header already shows the competition name, so the strip only appears when there is news.
  const { items, watchCompetitionId } = useTicker();
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);

  // Follow the list as it changes: keep the current line, or jump to an announcement that has just arrived.
  const [view, setView] = useState<{ items: TickerItem[]; activeKey: string | null }>(() => ({ items, activeKey: items[0]?.key ?? null }));
  let activeKey = view.activeKey;
  if (view.items !== items) {
    activeKey = tickerFocusAfterChange(view.items, items, view.activeKey);
    setView({ items, activeKey });
  }
  // With reduced motion nothing rotates by itself; the full list is one tap away.
  const index = Math.max(0, items.findIndex((item) => item.key === activeKey));
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const barRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const [openedAt, setOpenedAt] = useState(pathname);
  if (open && openedAt !== pathname) setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onPointer = (e: PointerEvent) => { if (!barRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, [open]);

  useEffect(() => {
    if (reduceMotion || open || items.length < 2) return;
    const timer = setTimeout(() => {
      setView((cur) => (cur.items === items ? { items, activeKey: items[(index + 1) % items.length].key } : cur));
    }, ROTATE_MS);
    return () => clearTimeout(timer);
  }, [items, index, reduceMotion, open]);

  const active = items[index] ?? (watchCompetitionId ? { key: 'stream', kind: 'info' as const, text: 'Live video' } : undefined);
  if (!current || !active) return null;
  const { badge, text } = badgeFor(active);
  const feed = `/competitions/${current.id}/chat`;
  const timetable = `/competitions/${current.id}`;
  const linkFor = (item: TickerItem) => {
    if (item.sessionId != null) return `${timetable}/session/${item.sessionId}`;
    return item.kind === 'late' || item.kind === 'ontime' ? timetable : feed;
  };
  const labelFor = (item: TickerItem) => (item.sessionId != null ? 'Open this session' : item.kind === 'late' || item.kind === 'ontime' ? 'Open the timetable' : 'Open the live feed');
  return (
    <div ref={barRef} className="relative">
      <ul className="sr-only" aria-label="Event updates">
        {items.map((item) => {
          const label = KIND_BADGES[item.kind]?.srLabel;
          return <li key={item.key}>{label ? `${label}: ${item.text}` : item.text}</li>;
        })}
      </ul>
      <div className="mg-strip-bar">
        <div className="mx-auto flex w-full max-w-5xl items-stretch">
          <Link to={linkFor(active)} aria-label={labelFor(active)} title={labelFor(active)} className="mg-strip min-w-0 flex-1">
            <span key={active.key} aria-hidden="true" className="ticker-line flex w-full min-w-0 items-center gap-2.5 pl-4 pr-1">
              {badge && <span className={`mg-badge ${badge.className}`}>{badge.label}</span>}
              <span className="min-w-0 flex-1 truncate">{text}</span>
            </span>
          </Link>
          {watchCompetitionId === current.id && (
            <Link to={`/competitions/${current.id}/chat`} aria-label="Watch the live video" className="mg-strip-watch mg-badge-live">
              <Video aria-hidden="true" className="h-4 w-4" /> Watch
            </Link>
          )}
          {items.length > 1 && (
            <button type="button" className="mg-strip-next" aria-expanded={open} aria-controls={panelId} aria-label={`All updates (${items.length})`} onClick={() => { setOpen((v) => !v); setOpenedAt(pathname); }}>
              <ChevronDown aria-hidden="true" className={`h-[18px] w-[18px] transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div id={panelId} className="mg-strip-panel">
          <ul className="mx-auto flex max-w-5xl flex-col">
            {items.map((item) => {
              const line = badgeFor(item);
              return (
                <li key={item.key}>
                  <Link to={linkFor(item)} className="mg-strip-item" onClick={() => setOpen(false)}>
                    {line.badge ? <span className={`mg-badge ${line.badge.className}`}>{line.badge.label}</span> : <span className="mg-badge mg-badge-soft">Info</span>}
                    <span className="min-w-0 flex-1">{line.text}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mx-auto max-w-5xl px-4 pb-3 pt-1">
            <Link to={`/competitions/${current.id}/chat`} className="mg-btn mg-btn-secondary w-full !min-h-11" onClick={() => setOpen(false)}>Open the live feed</Link>
          </div>
        </div>
      )}
    </div>
  );
}
