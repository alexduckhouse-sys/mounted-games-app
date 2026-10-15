import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, Clock, Coffee, Hourglass, Info, Medal, Megaphone, Trophy, type LucideIcon } from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { tickerFocusAfterChange, type TickerItem, type TickerKind } from '../lib/ticker';
import { useTicker } from './TickerContext';

const ROTATE_MS = 4500;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * One colour family per kind: dark text on a pale chip in light themes, pale text on a deep chip in the dark theme.
 * Every pair is 900-on-100 or 100-on-950 (or the slate equivalents), comfortably above WCAG AA for small text.
 */
const KIND_STYLES: Record<TickerKind, { chip: string; icon: string; Icon: LucideIcon | null; srLabel?: string }> = {
  live: { chip: 'border-blue-200 bg-blue-100 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100', icon: '', Icon: null },
  next: { chip: 'border-brand-200 bg-brand-100 text-brand-900 dark:border-brand-700 dark:bg-brand-900 dark:text-brand-100', icon: '', Icon: Clock },
  late: { chip: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100', icon: '', Icon: Hourglass },
  ontime: { chip: 'border-green-200 bg-green-100 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100', icon: '', Icon: CircleCheck },
  break: { chip: 'border-slate-300 bg-slate-200 text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100', icon: '', Icon: Coffee },
  finals: { chip: 'border-violet-200 bg-violet-100 text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100', icon: 'text-amber-700 dark:text-amber-300', Icon: Trophy },
  result: { chip: 'border-teal-200 bg-teal-100 text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100', icon: '', Icon: Medal, srLabel: 'Result' },
  announcement: { chip: 'border-rose-200 bg-rose-100 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100', icon: '', Icon: Megaphone, srLabel: 'Announcement' },
  info: { chip: 'border-slate-200 bg-white/70 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100', icon: '', Icon: Info },
};

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
const prefersReducedMotion = () => window.matchMedia?.(REDUCED_MOTION).matches ?? false;

function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-600 dark:bg-blue-400" />
    </span>
  );
}

/** One line that rolls through what is on now, delays, what is next and organiser announcements. Tap for the live feed. */
export function TopBarTicker() {
  const { current } = useCurrentCompetition();
  const { items: published } = useTicker();
  const name = current?.name;
  const items = useMemo<TickerItem[]>(
    () => (published.length > 0 ? published : name ? [{ key: 'info', kind: 'info', text: name }] : []),
    [published, name],
  );
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);

  // Follow the list as it changes: keep the current line, or jump to an announcement that has just arrived.
  const [view, setView] = useState<{ items: TickerItem[]; activeKey: string | null }>(() => ({ items, activeKey: items[0]?.key ?? null }));
  let activeKey = view.activeKey;
  if (view.items !== items) {
    activeKey = tickerFocusAfterChange(view.items, items, view.activeKey);
    setView({ items, activeKey });
  }
  // With reduced motion there is no rotation: the most important line stays put.
  const index = reduceMotion ? 0 : Math.max(0, items.findIndex((item) => item.key === activeKey));

  useEffect(() => {
    if (reduceMotion || items.length < 2) return;
    const timer = setTimeout(() => {
      setView((cur) => (cur.items === items ? { items, activeKey: items[(index + 1) % items.length].key } : cur));
    }, ROTATE_MS);
    return () => clearTimeout(timer);
  }, [items, index, reduceMotion]);

  const active = items[index];
  if (!current || !active) return <span className="flex-1" />;
  const style = KIND_STYLES[active.kind];
  const Icon = style.Icon;
  return (
    <div className="relative flex min-w-0 flex-1">
      <ul className="sr-only" aria-label="Event updates">
        {items.map((item) => {
          const label = KIND_STYLES[item.kind].srLabel;
          return <li key={item.key}>{label ? `${label}: ${item.text}` : item.text}</li>;
        })}
      </ul>
      <Link
        to={`/competitions/${current.id}/chat`}
        aria-label="Open the live feed"
        title="Open the live feed"
        className={`flex min-h-11 min-w-0 flex-1 items-center rounded-xl border px-2.5 text-sm font-semibold !no-underline transition-colors duration-300 motion-reduce:transition-none ${style.chip}`}
      >
        <span key={active.key} aria-hidden="true" className="ticker-line flex min-w-0 items-center gap-1.5">
          {Icon ? <Icon className={`h-4 w-4 shrink-0 ${style.icon}`} strokeWidth={2.25} /> : <LiveDot />}
          <span className="truncate">{active.text}</span>
        </span>
      </Link>
    </div>
  );
}
