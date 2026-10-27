import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Star, UserRound } from 'lucide-react';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useT } from '../i18n/LanguageContext';
import { globalTabsPath, GLOBAL_EVENTS, GLOBAL_ME } from '../lib/routes';

const readCurrentCompetition = useCurrentCompetition;

/**
 * The tab bar for pages outside a competition: Events, Following and Me.
 * There is no Live tab here, because the live feed belongs to a competition. Me opens the dashboard.
 * The shop sits under Me without lighting a tab, because it belongs to nobody in particular.
 */
export function GlobalTabs({ meCount = 0 }: { meCount?: number }) {
  const t = useT();
  const { pathname } = useLocation();
  const path = globalTabsPath(pathname);
  let hasCurrentCompetition = false;
  try {
    const { current } = readCurrentCompetition();
    hasCurrentCompetition = current != null;
  } catch {
    // Rendered outside CurrentCompetitionProvider in standalone unit tests
  }
  if (path === '/me' && hasCurrentCompetition) return null;

  const tabs = [
    { to: '/events', id: 'events', label: t('shell.tab.events'), icon: CalendarDays, active: GLOBAL_EVENTS.includes(path) },
    { to: '/following', id: 'following', label: t('shell.tab.following'), icon: Star, active: path === '/following' },
    { to: '/me', id: 'me', label: t('shell.tab.me'), icon: UserRound, active: GLOBAL_ME.includes(path) && path !== '/shop' },
  ];
  return (
    <nav aria-label={t('shell.tabs.main')} className="mg-tabs">
      <div className="mx-auto grid max-w-xl grid-cols-3">
        {tabs.map((tab) => (
          <Link key={tab.id} to={tab.to} className="mg-tab" aria-current={tab.active ? 'page' : undefined}>
            <span className="relative inline-flex">
              <tab.icon className="h-[22px] w-[22px]" strokeWidth={tab.active ? 2.25 : 2} fill={tab.active && tab.id === 'following' ? 'currentColor' : 'none'} aria-hidden="true" />
              {tab.id === 'me' && meCount > 0 && (
                <span aria-hidden="true" className="absolute -right-2 -top-1 box-content flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[rgb(var(--mg-surface))] bg-[rgb(var(--mg-red))] px-0.5 text-[10px] font-bold leading-none text-white">{meCount}</span>
              )}
            </span>
            {tab.label}
            {tab.id === 'me' && meCount > 0 && <span className="sr-only">{t('shell.tab.meCount', { count: meCount })}</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}
