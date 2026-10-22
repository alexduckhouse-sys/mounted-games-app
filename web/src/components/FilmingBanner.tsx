import { TriangleAlert } from 'lucide-react';
import { useFilmingOptOuts } from '../hooks/useFilmingOptOuts';
import { describeOptOut, upcomingOptOuts } from '../lib/filming';

/** Safeguarding notice for stream staff: riders in the heats about to race who asked not to be filmed close up. */
export function FilmingBanner({ competitionId, refreshKey }: { competitionId: number; refreshKey?: unknown }) {
  const items = upcomingOptOuts(useFilmingOptOuts(competitionId, refreshKey));
  if (items.length === 0) return null;
  return (
    <section className="mg-card flex flex-col gap-1 border-2 border-amber-500 p-3" aria-label="Riders who should not be filmed close up" role="status">
      {items.map((o) => (
        <p key={`${o.heatId}-${o.teamId}-${o.riderName}`} className="m-0 flex items-center gap-2 text-sm font-semibold">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          {describeOptOut(o)}
        </p>
      ))}
    </section>
  );
}
