import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useTicker } from './TickerContext';

const ROTATE_MS = 4500;

/** One line that rolls through what is on now, delays and organiser announcements. Tap for the live feed. */
export function TopBarTicker() {
  const { current } = useCurrentCompetition();
  const { items } = useTicker();
  const [index, setIndex] = useState(0);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const text = items.length > 0 ? items[index % items.length] : current?.name ?? '';

  useEffect(() => {
    if (items.length < 2 || reduceMotion) return;
    const timer = setInterval(() => setIndex((n) => n + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [items, reduceMotion]);

  if (!current) return <span className="flex-1" />;
  return (
    <Link to={`/competitions/${current.id}/chat`} className="flex min-h-11 min-w-0 flex-1 items-center rounded-xl bg-brand-100 px-3 text-sm font-semibold text-brand-800 !no-underline dark:bg-brand-900 dark:text-brand-100" title="Open the live feed">
      <span className="sr-only">{items.length > 0 ? items.join('. ') : current.name}</span>
      <span key={text} aria-hidden="true" className="ticker-line block truncate">{text}</span>
    </Link>
  );
}
