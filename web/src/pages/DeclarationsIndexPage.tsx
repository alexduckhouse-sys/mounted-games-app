import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, Trophy } from 'lucide-react';
import { api } from '../api';
import type { CompetitionSummary, DeclarationForm } from '../types';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';

export function DeclarationsIndexPage() {
  const [forms, setForms] = useState<DeclarationForm[]>([]);
  const [comps, setComps] = useState<CompetitionSummary[]>([]);
  const [pickComp, setPickComp] = useState(false);
  const { current } = useCurrentCompetition();

  useEffect(() => {
    const params: Record<string, number> = {};
    if (current) params.competitionId = current.id;
    api.get<DeclarationForm[]>('/declaration-forms', { params }).then((r) => setForms(r.data));
  }, [current]);

  useEffect(() => {
    if (pickComp && comps.length === 0) {
      api.get<CompetitionSummary[]>('/competitions').then((r) => setComps(r.data)).catch(() => {});
    }
  }, [pickComp, comps.length]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-brand-600" /> Declaration forms
        </h1>
        {current && (
          <span className="text-xs text-slate-500 dark:text-slate-300">
            Scoped to <span className="font-semibold">{current.name}</span>
          </span>
        )}
        {current ? (
          <Link
            to={`/competitions/${current.id}/declarations`}
            className="btn-primary !py-1.5 !px-3 text-sm"
            title={`Submit a dec form for ${current.name}`}
          >
            <Plus className="w-4 h-4" /> Submit dec form
          </Link>
        ) : (
          <button onClick={() => setPickComp(true)} className="btn-primary !py-1.5 !px-3 text-sm">
            <Plus className="w-4 h-4" /> Submit dec form
          </button>
        )}
      </div>

      {pickComp && !current && (
        <div className="card p-3 space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-brand-600" /> Pick a competition
          </h2>
          {comps.length === 0 ? (
            <p className="text-xs text-slate-500">No competitions yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {comps.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/competitions/${c.id}/declarations`}
                    className="flex items-center gap-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 px-1 rounded"
                  >
                    <span className="font-semibold flex-1 truncate text-sm">{c.name}</span>
                    <span className="text-[10px] text-slate-400">{new Date(c.startDate).toLocaleDateString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setPickComp(false)} className="btn-ghost !py-1 !px-2 text-xs">Cancel</button>
        </div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {forms.map((f) => (
          <Link key={f.id} to={`/competitions/${f.competitionId}/declarations`} className="card p-5 hover:shadow-lg">
            <h2 className="font-semibold">{f.teamName}</h2>
            <p className="text-xs text-slate-500">{f.competitionName}</p>
            <p className="text-xs text-slate-500 mt-1">
              Submitted {new Date(f.submittedAt).toLocaleDateString()} · {f.riders.length} riders
            </p>
          </Link>
        ))}
        {forms.length === 0 && (
          <div className="card p-5 text-sm text-slate-500">
            {current
              ? `No dec forms for ${current.name} yet.`
              : 'No dec forms yet. Open a competition to start one.'}
          </div>
        )}
      </div>
    </div>
  );
}
