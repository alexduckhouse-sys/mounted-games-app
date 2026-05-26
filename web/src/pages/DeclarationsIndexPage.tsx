import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, Trophy, History, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import type { CompetitionSummary, DeclarationForm } from '../types';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';

type View = 'current' | 'all';

export function DeclarationsIndexPage() {
  const { current } = useCurrentCompetition();
  const { user } = useAuth();
  const [view, setView] = useState<View>(current ? 'current' : 'all');
  const [forms, setForms] = useState<DeclarationForm[]>([]);
  const [comps, setComps] = useState<CompetitionSummary[]>([]);
  const [pickComp, setPickComp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    const params: Record<string, number> = {};
    if (view === 'current' && current) params.competitionId = current.id;
    api.get<DeclarationForm[]>('/declaration-forms', { params })
      .then((r) => setForms(r.data))
      .catch(() => setForms([]))
      .finally(() => setLoading(false));
  }, [view, current]);

  useEffect(() => {
    if (pickComp && comps.length === 0) {
      api.get<CompetitionSummary[]>('/competitions').then((r) => setComps(r.data)).catch(() => {});
    }
  }, [pickComp, comps.length]);

  // Group by competition for the "All" view so users with history across many
  // comps can scan quickly. Mine vs theirs split: forms the viewer submitted
  // are shown first, then everyone else's locked forms (read-only).
  const grouped = useMemo(() => {
    const mine: DeclarationForm[] = [];
    const others: DeclarationForm[] = [];
    for (const f of forms) {
      if (user && f.submittedByUserId === user.id) mine.push(f); else others.push(f);
    }
    function groupByComp(list: DeclarationForm[]): Map<string, DeclarationForm[]> {
      const m = new Map<string, DeclarationForm[]>();
      for (const f of list) {
        const key = `${f.competitionId}|${f.competitionName}`;
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push(f);
      }
      return m;
    }
    return { mine: groupByComp(mine), others: groupByComp(others) };
  }, [forms, user]);

  function toggleExpanded(id: number) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-brand-600" /> Declaration forms
        </h1>
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

      <div className="card p-1.5 flex items-center gap-1">
        <button
          onClick={() => setView('current')}
          disabled={!current}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 ${
            view === 'current'
              ? 'bg-brand-600 text-white shadow-soft'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
          title={current ? `${current.name} only` : 'Open a competition to scope by it'}
        >
          <Trophy className="w-3.5 h-3.5" /> {current ? `Current — ${current.name}` : 'Current comp'}
        </button>
        <button
          onClick={() => setView('all')}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 ${
            view === 'all'
              ? 'bg-brand-600 text-white shadow-soft'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          title="Every dec form across every competition"
        >
          <History className="w-3.5 h-3.5" /> All my forms
        </button>
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

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : view === 'all' ? (
        <div className="space-y-4">
          {user && grouped.mine.size > 0 && (
            <section>
              <h2 className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1 px-1">
                Mine ({Array.from(grouped.mine.values()).reduce((n, list) => n + list.length, 0)})
              </h2>
              <GroupedFormList groups={grouped.mine} expanded={expanded} onToggle={toggleExpanded} highlight />
            </section>
          )}
          {grouped.others.size > 0 && (
            <section>
              <h2 className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1 px-1">
                Everyone else's locked forms ({Array.from(grouped.others.values()).reduce((n, list) => n + list.length, 0)})
              </h2>
              <GroupedFormList groups={grouped.others} expanded={expanded} onToggle={toggleExpanded} />
            </section>
          )}
          {grouped.mine.size === 0 && grouped.others.size === 0 && (
            <div className="card p-5 text-sm text-slate-500">No dec forms yet.</div>
          )}
        </div>
      ) : (
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
      )}
    </div>
  );
}

function GroupedFormList({
  groups, expanded, onToggle, highlight,
}: {
  groups: Map<string, DeclarationForm[]>;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  highlight?: boolean;
}) {
  return (
    <div className="space-y-2">
      {Array.from(groups.entries()).map(([key, list]) => {
        const [compIdStr, compName] = key.split('|');
        const compId = parseInt(compIdStr, 10);
        const newest = list.reduce((max, f) =>
          new Date(f.submittedAt) > new Date(max.submittedAt) ? f : max, list[0]);
        return (
          <div
            key={key}
            className={`card p-3 ${highlight ? 'border-l-4 border-brand-500' : ''}`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/competitions/${compId}`}
                className="font-semibold text-sm hover:text-brand-700 dark:hover:text-brand-300 flex-1 truncate"
              >
                {compName}
              </Link>
              <span className="text-[10px] text-slate-500">
                {list.length} form{list.length === 1 ? '' : 's'} · last {new Date(newest.submittedAt).toLocaleDateString()}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {list.map((f) => {
                const isOpen = expanded.has(f.id);
                return (
                  <li key={f.id} className="rounded-md border border-slate-200 dark:border-slate-700/70 px-2 py-1.5">
                    <button
                      onClick={() => onToggle(f.id)}
                      className="w-full flex items-center gap-2 text-left"
                    >
                      <Users className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                      <span className="font-medium text-sm flex-1 truncate">{f.teamName}</span>
                      <span className="text-[10px] text-slate-500 hidden sm:inline">
                        {f.riders.length} rider{f.riders.length === 1 ? '' : 's'} · {new Date(f.submittedAt).toLocaleDateString()}
                      </span>
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                    </button>
                    {isOpen && (
                      <ul className="mt-1.5 text-[11px] divide-y divide-slate-100 dark:divide-slate-700/60">
                        {f.riders.map((r) => (
                          <li key={r.id} className="py-1 flex items-center gap-2">
                            <span className="font-mono text-[9px] text-slate-400 w-4">{r.orderIndex + 1}.</span>
                            <span className="font-medium flex-1 truncate">{r.fullName}</span>
                            {r.horseName && <span className="text-slate-500 truncate">on {r.horseName}</span>}
                            {r.isCaptain && <span className="text-[9px] uppercase font-bold text-amber-600">cap</span>}
                            {r.isReserve && <span className="text-[9px] uppercase font-bold text-slate-500">res</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
