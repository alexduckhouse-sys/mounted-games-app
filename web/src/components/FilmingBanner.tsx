import { useFilmingOptOuts } from '../hooks/useFilmingOptOuts';
import { describeOptOut, upcomingOptOuts } from '../lib/filming';
import { Notice } from './Notice';

/** Safeguarding notice for stream staff: riders in the heats about to race who asked not to be filmed close up. */
export function FilmingBanner({ competitionId, refreshKey }: { competitionId: number; refreshKey?: unknown }) {
  const items = upcomingOptOuts(useFilmingOptOuts(competitionId, refreshKey));
  if (items.length === 0) return null;
  return (
    <section aria-label="Riders who should not be filmed close up" role="status">
      <Notice role={null}>
        <strong className="block">Don’t film close up</strong>
        {items.map((o) => (
          <span key={`${o.heatId}-${o.teamId}-${o.riderName}`} className="block">{describeOptOut(o)}</span>
        ))}
      </Notice>
    </section>
  );
}
