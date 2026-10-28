import { Link, useLocation } from 'react-router-dom';
import { Info, Ticket } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_BOTTOM_TABS, useUserPrefs } from '../lib/userPrefs';
import { useT } from '../i18n/LanguageContext';
import type { MessageKey } from '../i18n/en';
import { useCompetitionMeta } from './competitionMeta';
import { TAB_DEFS } from './bottomTabDefs';

/** The signed-in person's tab: their initials, and how many things are waiting on them. */
export interface MeTab {
  initials: string;
  count: number;
}

const GRID_COLS_CLASS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
};

const readAuth = useAuth;
const readCompetitionMeta = useCompetitionMeta;

function resolveCanOrganise(explicitCanOrganise?: boolean): boolean {
  if (typeof explicitCanOrganise === 'boolean') return explicitCanOrganise;
  try {
    return readAuth().canOrganise(readCompetitionMeta().meta ?? undefined);
  } catch {
    return false;
  }
}

/**
 * Competition bottom tabs. Defaults to Timetable, Toplists, Live stream and Details (plus Me when signed in),
 * and adapts to the user's chosen bottom bar shortcuts or role preset from Settings.
 * While entries are the only thing to do (`entryOnly`), the public gets just Enter and Details.
 */
export function BottomTabs({
  competitionId,
  me,
  entryOnly = false,
  canOrganise,
}: {
  competitionId: number;
  me?: MeTab;
  entryOnly?: boolean;
  canOrganise?: boolean;
}) {
  const t = useT();
  const { pathname } = useLocation();
  const { bottomTabs } = useUserPrefs();
  const userCanOrganise = resolveCanOrganise(canOrganise);
  const base = `/competitions/${competitionId}`;
  const onProfile = pathname === '/me' || pathname === '/me/';
  const inside = pathname === base || pathname.startsWith(`${base}/`);
  const rest = inside ? pathname.slice(base.length).replace(/^\/|\/$/g, '') : null;
  const section = rest?.split('/')[0];

  const visibleTabIds = bottomTabs.filter(
    (id) => !TAB_DEFS[id].organiserOnly || userCanOrganise
  );
  const effectiveTabIds =
    visibleTabIds.length >= 2 ? visibleTabIds : DEFAULT_BOTTOM_TABS;

  const tabs = entryOnly
    ? [
        {
          to: base,
          label: 'shell.tab.enter' as MessageKey,
          icon: Ticket,
          active: section === '' || section === 'enter',
        },
        {
          to: `${base}/details`,
          label: 'shell.tab.details' as MessageKey,
          icon: Info,
          active: section === 'details' || section === 'sponsors',
        },
      ]
    : effectiveTabIds.map((id) => {
        const def = TAB_DEFS[id];
        return {
          to: def.to(base),
          label: def.label,
          icon: def.icon,
          active: def.isActive(section),
        };
      });

  const totalCols = tabs.length + (me ? 1 : 0);
  const gridColsClass = GRID_COLS_CLASS[totalCols] ?? 'grid-cols-5';
  const compactClass = totalCols >= 6 ? ' mg-tab-compact' : '';

  return (
    <nav aria-label={t('shell.tabs.competition')} className="mg-tabs">
      <div className={`mx-auto grid max-w-xl ${gridColsClass}`}>
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.to}
            className={`mg-tab${compactClass}`}
            aria-current={tab.active ? 'page' : undefined}
          >
            <tab.icon
              className="h-[22px] w-[22px]"
              strokeWidth={tab.active ? 2.25 : 2}
              aria-hidden="true"
            />
            {t(tab.label)}
          </Link>
        ))}
        {me && (
          <Link
            to="/me"
            className={`mg-tab${compactClass}`}
            aria-current={onProfile ? 'page' : undefined}
          >
            <span className="relative inline-flex">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--mg-heading))] text-[10px] font-bold leading-none text-[rgb(var(--mg-surface))]"
              >
                {me.initials}
              </span>
              {me.count > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 -top-[3px] box-content flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[rgb(var(--mg-surface))] bg-[rgb(var(--mg-red))] px-0.5 text-[10px] font-bold leading-none text-white"
                >
                  {me.count}
                </span>
              )}
            </span>
            {t('shell.tab.me')}
            {me.count > 0 && <span className="sr-only">{t('shell.tab.meCount', { count: me.count })}</span>}
          </Link>
        )}
      </div>
    </nav>
  );
}
