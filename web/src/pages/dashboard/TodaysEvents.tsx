import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { competitionDateText, isOnToday } from '../../lib/competitionDates';
import type { CompetitionPickerItem } from '../../types';

/** Competitions running today or this week, with whether a heat is on and a link straight in. */
export function TodaysEvents({ events, loaded }: { events: CompetitionPickerItem[]; loaded: boolean }) {
  const now = new Date();
  return (
    <section aria-label="Today’s events" className="flex flex-col gap-2">
      <div className="mg-section-head"><h2>Today’s events</h2>{events.length > 0 && <span>{events.length}</span>}</div>
      {!loaded && <p role="status" className="mg-meta px-1">Looking for what’s on…</p>}
      {loaded && events.length === 0 && <p className="mg-meta px-1">Nothing is on today or this week.</p>}
      {events.length > 0 && (
        <ul className="mg-card mg-list">
          {events.map((event) => {
            const today = isOnToday(event.startDate, event.endDate, now);
            const line = event.live
              ? `${[event.live.sectionName, event.live.heatLabel, event.live.arenaName].filter(Boolean).join(' · ')} on now`
              : [today ? 'Today' : competitionDateText(event.startDate, event.endDate), event.location].filter(Boolean).join(' · ');
            return (
              <li key={event.id}>
                <Link to={`/competitions/${event.id}`} className="mg-row !min-h-16" aria-label={`Jump in to ${event.name}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold leading-tight">{event.name}</span>
                    <span className="block truncate text-sm text-[rgb(var(--mg-muted))]">{line}</span>
                  </span>
                  {event.live && <span className="mg-badge mg-badge-live">Live</span>}
                  <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-dash))]" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
