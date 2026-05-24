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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <MessagesSquare className="w-6 h-6 text-brand-600" /> Live feeds
      </h1>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {comps.map((c) => (
          <Link key={c.id} to={`/competitions/${c.id}/chat`} className="card p-5 hover:shadow-lg">
            <h2 className="font-semibold">{c.name}</h2>
            <p className="text-xs text-slate-500">{c.location}</p>
            <p className="text-xs text-slate-500 mt-1">
              {c.isActive && !c.isArchived ? 'Live now' : 'View history'}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
