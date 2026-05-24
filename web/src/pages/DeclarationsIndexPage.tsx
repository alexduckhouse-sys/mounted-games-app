import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { api } from '../api';
import type { DeclarationForm } from '../types';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';

export function DeclarationsIndexPage() {
  const [forms, setForms] = useState<DeclarationForm[]>([]);
  const { current } = useCurrentCompetition();

  useEffect(() => {
    const params: Record<string, number> = {};
    if (current) params.competitionId = current.id;
    api.get<DeclarationForm[]>('/declaration-forms', { params }).then((r) => setForms(r.data));
  }, [current]);

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
      </div>
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
