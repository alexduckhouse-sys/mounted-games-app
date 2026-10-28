import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { buildIssueGroups } from '../operations/readiness';
import { eventHasStarted, sortTotal } from '../operations/hubData';
import type { CompetitionReadiness } from '../operations/types';
import type { CompetitionDetail } from '../../types';

/** The organiser's way into Before the day from the event home, with what is left to sort. Gone once the first session starts. */
export function BeforeTheDayRow({ competition }: { competition: CompetitionDetail }) {
  const { canOrganise } = useAuth();
  const show = canOrganise(competition) && !eventHasStarted(competition);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    api.get<CompetitionReadiness>(`/competitions/${competition.id}/operations/readiness`)
      .then(({ data }) => { if (!cancelled) setCount(sortTotal(data, buildIssueGroups(data, competition.id), `/competitions/${competition.id}`)); })
      .catch(() => { if (!cancelled) setCount(null); });
    return () => { cancelled = true; };
  }, [show, competition.id]);
  if (!show) return null;
  return (
    <div className="sp-card mt-3" role="list" aria-label="Organiser">
      <Link className="sp-row" to={`/competitions/${competition.id}/operations`}>
        <span className="sp-grow">
          <span className="sp-t1 !font-medium">Before the day</span>
          {count != null && count > 0 && <span className="sp-t2 !text-[rgb(var(--mg-late-ink))] !font-semibold">{count === 1 ? '1 thing to sort' : `${count} things to sort`}</span>}
        </span>
        <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
      </Link>
    </div>
  );
}
