import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Trophy } from 'lucide-react';
import type { CompetitionSummary } from '../types';

export function CompetitionsPage() {
  const [comps, setComps] = useState<CompetitionSummary[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => {
    api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived } })
      .then((r) => setComps(r.data));
  }, [includeArchived]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-brand-600" /> Competitions
        </h1>
        <label className="text-xs flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <input
            type="checkbox" checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Archived
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {comps.map((c) => (
          <Link key={c.id} to={`/competitions/${c.id}`} className="card p-3 hover:shadow-lg transition">
            <div className="flex items-center justify-between">
              <span className={`pill ${c.isActive && !c.isArchived ? 'bg-arena-live text-yellow-900' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100'}`}>
                {c.isActive && !c.isArchived ? 'Live' : c.isArchived ? 'Archived' : 'Past'}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{new Date(c.startDate).toLocaleDateString()}</span>
            </div>
            <h2 className="font-semibold mt-1.5 text-sm truncate">{c.name}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{c.location}</p>
            <div className="mt-1.5 flex gap-2.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span>{c.sectionCount} sec</span>
              <span>{c.teamCount} teams</span>
              <span>{c.sessionCount} sess</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
