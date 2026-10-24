import { Link, useLocation } from 'react-router-dom';

const ITEMS = [
  { to: '/seasons', label: 'Season tables', match: (path: string) => path.startsWith('/seasons') },
  { to: '/stats', label: 'Rider & pony stats', match: (path: string) => path.startsWith('/stats') },
  { to: '/competitions/past', label: 'Past competitions', match: (path: string) => path.startsWith('/competitions/past') },
] as const;

/** Shared switcher at the top of Seasons, Stats and Past competitions. */
export function ResultsStatsNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Results and statistics" className="mx-auto flex w-full max-w-xl flex-wrap gap-2 pb-1 pt-2 lg:max-w-none">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className="mg-chip !min-h-10 !px-3.5 !text-sm !no-underline hover:!no-underline"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
