import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronUp, SlidersHorizontal, Video } from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { nowPrefixLength, tickerFocusAfterChange, type TickerItem, type TickerKind } from '../lib/ticker';
import { useT } from '../i18n/LanguageContext';
import type { MessageKey } from '../i18n/en';
import { useTicker } from './TickerContext';
import { PAGE_WIDTH_CLASS, usePageWidthValue } from './pageWidthState';

const ROTATE_MS = 4500;
const ANNOUNCEMENT_HOLD_MS = 10_000;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The badge in front of each line; the dark dock keeps every badge readable in every theme. */
const KIND_BADGES: Record<TickerKind, { label: MessageKey; className: string; srLabel?: MessageKey } | null> = {
  live: { label: 'shell.ticker.badge.live', className: 'mg-badge-live' },
  next: { label: 'shell.ticker.badge.next', className: 'mg-badge-soft' },
  late: { label: 'shell.ticker.badge.late', className: 'mg-badge-late' },
  ontime: { label: 'shell.ticker.badge.ontime', className: 'mg-badge-soft' },
  break: { label: 'shell.ticker.badge.break', className: 'mg-badge-soft' },
  finals: { label: 'shell.ticker.badge.finals', className: 'mg-badge-soft' },
  result: { label: 'shell.ticker.badge.result', className: 'mg-badge-soft', srLabel: 'shell.ticker.badge.result' },
  announcement: { label: 'shell.ticker.badge.notice', className: 'mg-badge-notice', srLabel: 'shell.ticker.badge.announcement' },
  info: null,
};

/** A final that is on now gets the live badge; the "Now:" prefix is dropped because the badge says it. */
function badgeFor(item: TickerItem) {
  const nowLength = nowPrefixLength(item.text);
  const badge = item.kind === 'finals' && nowLength > 0 ? KIND_BADGES.live : KIND_BADGES[item.kind];
  return { badge, text: nowLength > 0 && badge?.className === 'mg-badge-live' ? item.text.slice(nowLength) : item.text };
}

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
const prefersReducedMotion = () => window.matchMedia?.(REDUCED_MOTION).matches ?? false;

function Line({ item, className }: { item: TickerItem; className: string }) {
  const t = useT();
  const { badge, text } = badgeFor(item);
  return (
    <span aria-hidden="true" className={className}>
      {badge && <span className={`mg-badge ${badge.className}`}>{t(badge.label)}</span>}
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </span>
  );
}

/**
 * The ticker dock just above the tab bar: one line that rolls through what is on now, delays, what is next and
 * organiser announcements, each new line pushing the last one up and out. The arrow opens every update above it;
 * a tap anywhere else closes that list. A page can put one button beside it (the timetable's filters). On a page
 * with no tab bar it sits at the bottom of the screen (`low`).
 */
export function TopBarTicker({ low = false }: { low?: boolean }) {
  const t = useT();
  const cap = PAGE_WIDTH_CLASS[usePageWidthValue()];
  const { current } = useCurrentCompetition();
  // The header already shows the competition name, so the line only appears when there is news.
  const { items, watchCompetitionId, dockAction } = useTicker();
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
  const dockRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const [openedAt, setOpenedAt] = useState(pathname);
  if (open && openedAt !== pathname) setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onPointer = (e: PointerEvent) => { if (!dockRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, [open]);

  const active = items[index] ?? (watchCompetitionId ? { key: 'stream', kind: 'info' as const, text: t('shell.ticker.liveVideo') } : undefined);
  // The line that was showing before, so the new one can push it up and out.
  const [shown, setShown] = useState<{ current: TickerItem | undefined; previous: TickerItem | null }>({ current: active, previous: null });
  if (shown.current?.key !== active?.key) setShown({ current: active, previous: shown.current ?? null });
  const previous = shown.current?.key === active?.key ? shown.previous : shown.current ?? null;

  const holdMs = active?.kind === 'announcement' ? ANNOUNCEMENT_HOLD_MS : ROTATE_MS;
  useEffect(() => {
    if (reduceMotion || open || items.length < 2) return;
    const timer = setTimeout(() => {
      setView((cur) => (cur.items === items ? { items, activeKey: items[(index + 1) % items.length].key } : cur));
    }, holdMs);
    return () => clearTimeout(timer);
  }, [items, index, holdMs, reduceMotion, open]);

  if (!current || (!active && !dockAction)) return null;
  const feed = `/competitions/${current.id}/chat`;
  const timetable = `/competitions/${current.id}`;
  const linkFor = (item: TickerItem) => {
    if (item.sessionId != null) return `${timetable}/session/${item.sessionId}`;
    return item.kind === 'late' || item.kind === 'ontime' ? timetable : feed;
  };
  const labelFor = (item: TickerItem) => (item.sessionId != null ? t('shell.ticker.openSession') : item.kind === 'late' || item.kind === 'ontime' ? t('shell.ticker.openTimetable') : t('shell.ticker.openFeed'));
  const pushing = previous != null && !reduceMotion;
  return (
    <div className={`mg-dock${low ? ' mg-dock-low' : ''}`}>
      <div ref={dockRef} className={`mx-auto ${cap} mg-dock-row`}>
        {active && (
          <div className="mg-dock-wrap">
            <ul className="sr-only" aria-label={t('shell.ticker.updates')}>
              {items.map((item) => {
                const srLabel = KIND_BADGES[item.kind]?.srLabel;
                const label = srLabel ? t(srLabel) : undefined;
                return <li key={item.key}>{label ? `${label}: ${item.text}` : item.text}</li>;
              })}
            </ul>
            {open && (
              <div id={panelId} className="mg-strip-panel">
                <ul className="flex flex-col">
                  {items.map((item) => {
                    const line = badgeFor(item);
                    return (
                      <li key={item.key}>
                        <Link to={linkFor(item)} className="mg-strip-item" onClick={() => setOpen(false)}>
                          {line.badge ? <span className={`mg-badge ${line.badge.className}`}>{t(line.badge.label)}</span> : <span className="mg-badge mg-badge-soft">{t('shell.ticker.badge.info')}</span>}
                          <span className="min-w-0 flex-1">{line.text}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <div className="px-3 pb-3 pt-2">
                  <Link to={feed} className="mg-btn mg-btn-secondary w-full !min-h-11" onClick={() => setOpen(false)}>{t('shell.ticker.openFeed')}</Link>
                </div>
              </div>
            )}
            <div className="mg-strip-bar">
              <Link to={linkFor(active)} aria-label={labelFor(active)} title={labelFor(active)} className="mg-strip min-w-0 flex-1">
                <span className="mg-dock-stage">
                  {pushing && <Line key={`out-${active.key}`} item={previous} className="ticker-line ticker-out" />}
                  <Line key={active.key} item={active} className={`ticker-line${pushing ? ' ticker-in' : ''}`} />
                </span>
              </Link>
              {watchCompetitionId === current.id && (
                <Link to={feed} aria-label={t('shell.ticker.watchLabel')} className="mg-strip-watch mg-badge-live">
                  <Video aria-hidden="true" className="h-4 w-4" /> {t('shell.ticker.watch')}
                </Link>
              )}
              {items.length > 1 && (
                <button type="button" className="mg-strip-next" aria-expanded={open} aria-controls={panelId} aria-label={t('shell.ticker.allUpdates', { count: items.length })} onClick={() => { setOpen((v) => !v); setOpenedAt(pathname); }}>
                  <ChevronUp aria-hidden="true" className={`h-[18px] w-[18px] transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} strokeWidth={2.2} />
                </button>
              )}
            </div>
          </div>
        )}
        {dockAction && (
          <button type="button" className="mg-dock-action" aria-label={dockAction.count > 0 ? `${dockAction.label}, ${dockAction.count} set` : dockAction.label} onClick={() => { setOpen(false); dockAction.onClick(); }}>
            <SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
            {dockAction.count > 0 && <span className="mg-dock-count" aria-hidden="true">{dockAction.count}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
