import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { api } from '../api';
import type { CompetitionSummary } from '../types';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';

export function ChatIndexPage() {
  const [comps, setComps] = useState<CompetitionSummary[]>([]);
  const { current } = useCurrentCompetition();

  useEffect(() => {
    if (current) return;
    api.get<CompetitionSummary[]>('/competitions').then((r) => setComps(r.data));
  }, [current]);

  if (current) {
    return <Navigate to={`/competitions/${current.id}/chat`} replace />;
  }

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3 py-4">
      <h1 className="mg-h1 mg-h1-sm flex items-center gap-2">
        <MessagesSquare className="h-6 w-6" aria-hidden="true" /> Live feeds
      </h1>
      <div className="mg-card mg-list">
        {comps.map((c) => (
          <Link key={c.id} to={`/competitions/${c.id}/chat`} className="mg-row">
            <span className="min-w-0 flex-1">
              <span className="mg-h2 block truncate">{c.name}</span>
              <span className="mg-meta block">{c.location}</span>
              <span className="mg-meta block font-semibold">
                {c.isActive && !c.isArchived ? 'Live now' : 'View history'}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
