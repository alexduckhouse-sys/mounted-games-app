import { Link, useLocation } from 'react-router-dom';
import { Clock, Info, MessageSquare, Ticket, Trophy } from 'lucide-react';

/** The signed-in person's tab: their initials, and how many things are waiting on them. */
export interface MeTab { initials: string; count: number }

/**
 * Timetable, toplists, live feed and details (the sponsor page counts as details): the four places spectators move between inside a competition.
 * Signed-in people get a fifth tab, Me, which opens their profile.
 * While entries are the only thing to do (`entryOnly`), the public gets just Enter and Details: the others have nothing to show yet.
 */
export function BottomTabs({ competitionId, me, entryOnly = false }: { competitionId: number; me?: MeTab; entryOnly?: boolean }) {
  const { pathname } = useLocation();
  const base = `/competitions/${competitionId}`;
  const onProfile = pathname === '/me' || pathname === '/me/';
  const inside = pathname === base || pathname.startsWith(`${base}/`);
  const rest = inside ? pathname.slice(base.length).replace(/^\/|\/$/g, '') : null;
  const section = rest?.split('/')[0];
  const tabs = entryOnly ? [
    { to: base, label: 'Enter', icon: Ticket, active: section === '' || section === 'enter' },
    { to: `${base}/details`, label: 'Details', icon: Info, active: section === 'details' || section === 'sponsors' },
  ] : [
    // Heats and age-group timetables are reached from the timetable, so they keep it highlighted.
    { to: base, label: 'Timetable', icon: Clock, active: section === '' || section === 'session' || section === 'scoring' },
    { to: `${base}/toplists`, label: 'Toplists', icon: Trophy, active: section === 'toplists' },
    { to: `${base}/chat`, label: 'Live stream', icon: MessageSquare, active: section === 'chat' },
    { to: `${base}/details`, label: 'Details', icon: Info, active: section === 'details' || section === 'sponsors' },
  ];
  return (
    <nav aria-label="Competition" className="mg-tabs">
      <div className={`mx-auto grid max-w-xl ${tabs.length + (me ? 1 : 0) === 5 ? 'grid-cols-5' : tabs.length + (me ? 1 : 0) === 4 ? 'grid-cols-4' : tabs.length + (me ? 1 : 0) === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {tabs.map((tab) => (
          <Link key={tab.label} to={tab.to} className="mg-tab" aria-current={tab.active ? 'page' : undefined}>
            <tab.icon className="h-[22px] w-[22px]" strokeWidth={tab.active ? 2.25 : 2} aria-hidden="true" />
            {tab.label}
          </Link>
        ))}
        {me && (
          <Link to="/me" className="mg-tab" aria-current={onProfile ? 'page' : undefined}>
            <span className="relative inline-flex">
              <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--mg-heading))] text-[10px] font-bold leading-none text-[rgb(var(--mg-surface))]">{me.initials}</span>
              {me.count > 0 && (
                <span aria-hidden="true" className="absolute -right-1.5 -top-[3px] box-content flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[rgb(var(--mg-surface))] bg-[rgb(var(--mg-red))] px-0.5 text-[10px] font-bold leading-none text-white">{me.count}</span>
              )}
            </span>
            Me
            {me.count > 0 && <span className="sr-only">, {me.count} to do</span>}
          </Link>
        )}
      </div>
    </nav>
  );
}
