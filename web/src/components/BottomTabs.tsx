import { Link, useLocation } from 'react-router-dom';
import { Clock, Info, MessageSquare, Trophy } from 'lucide-react';

/** Timetable, toplists, live feed and details: the four places spectators move between inside a competition. */
export function BottomTabs({ competitionId }: { competitionId: number }) {
  const { pathname } = useLocation();
  const base = `/competitions/${competitionId}`;
  const rest = pathname.slice(base.length).replace(/^\/|\/$/g, '');
  const section = rest.split('/')[0];
  const tabs = [
    // Heats and age-group timetables are reached from the timetable, so they keep it highlighted.
    { to: base, label: 'Timetable', icon: Clock, active: section === '' || section === 'session' || section === 'scoring' },
    { to: `${base}/toplists`, label: 'Toplists', icon: Trophy, active: section === 'toplists' },
    { to: `${base}/chat`, label: 'Live & stream', icon: MessageSquare, active: section === 'chat' },
    { to: `${base}/details`, label: 'Details', icon: Info, active: section === 'details' },
  ];
  return (
    <nav aria-label="Competition" className="mg-tabs">
      <div className="mx-auto grid max-w-xl grid-cols-4">
        {tabs.map((tab) => (
          <Link key={tab.label} to={tab.to} className="mg-tab" aria-current={tab.active ? 'page' : undefined}>
            <tab.icon className="h-[22px] w-[22px]" strokeWidth={tab.active ? 2.25 : 2} aria-hidden="true" />
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
