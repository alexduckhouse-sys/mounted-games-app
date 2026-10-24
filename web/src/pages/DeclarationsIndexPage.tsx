import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, Trophy, History, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { usePageWidth } from '../components/pageWidthState';
import type { CompetitionSummary, DeclarationForm } from '../types';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';

type View = 'current' | 'all';

const NO_FORMS: DeclarationForm[] = [];

export function DeclarationsIndexPage() {
  usePageWidth('wide');
  const { current } = useCurrentCompetition();
  const { user } = useAuth();
  const [view, setView] = useState<View>(current ? 'current' : 'all');
  // The list is stored with the view and competition it was fetched for; until a fetch for the
  // current ones has finished the page is loading.
  const [loaded, setLoaded] = useState<{ view: View; current: typeof current; forms: DeclarationForm[] } | null>(null);
  const isLoaded = loaded != null && loaded.view === view && loaded.current === current;
  const forms = isLoaded ? loaded.forms : NO_FORMS;
  const loading = !isLoaded;
  const [comps, setComps] = useState<CompetitionSummary[]>([]);
  const [pickComp, setPickComp] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const params: Record<string, number> = {};
    if (view === 'current' && current) params.competitionId = current.id;
    api.get<DeclarationForm[]>('/declaration-forms', { params })
      .then((r) => r.data)
      .catch(() => [] as DeclarationForm[])
      .then((list) => { if (!cancelled) setLoaded({ view, current, forms: list }); });
    return () => { cancelled = true; };
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
    <div className="skin mx-auto w-full max-w-4xl space-y-3 py-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="mg-h1 mg-h1-sm flex items-center gap-2">
          <ClipboardList className="h-6 w-6" aria-hidden="true" /> Declaration forms
        </h1>
        {current ? (
          <Link
            to={`/competitions/${current.id}/declarations`}
            className="mg-btn mg-btn-primary !min-h-10 !px-4 !text-[15px]"
            title={`Submit a dec form for ${current.name}`}
          >
            <Plus className="w-4 h-4" /> Submit dec form
          </Link>
        ) : (
          <button onClick={() => setPickComp(true)} className="mg-btn mg-btn-primary !min-h-10 !px-4 !text-[15px]">
            <Plus className="w-4 h-4" /> Submit dec form
          </button>
        )}
      </div>

      <div className="mg-seg">
        <button
          onClick={() => setView('current')}
          disabled={!current}
          className="mg-chip !min-h-10 !px-3 !text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          aria-pressed={view === 'current'}
          title={current ? `${current.name} only` : 'Open a competition to scope by it'}
        >
          <Trophy className="w-3.5 h-3.5" /> {current ? `Current · ${current.name}` : 'Current competition'}
        </button>
        <button
          onClick={() => setView('all')}
          className="mg-chip !min-h-10 !px-3 !text-sm"
          aria-pressed={view === 'all'}
          title="Every dec form across every competition"
        >
          <History className="w-3.5 h-3.5" /> All my forms
        </button>
      </div>

      {pickComp && !current && (
        <div className="mg-card space-y-2 p-3">
          <h2 className="mg-h2 flex items-center gap-2">
            <Trophy className="h-4 w-4" aria-hidden="true" /> Pick a competition
          </h2>
          {comps.length === 0 ? (
            <p className="mg-meta">No competitions yet.</p>
          ) : (
            <ul className="mg-list">
              {comps.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/competitions/${c.id}/declarations`}
                    className="mg-row !min-h-11 !gap-2 !px-1"
                  >
                    <span className="flex-1 truncate font-semibold">{c.name}</span>
                    <span className="mg-meta">{new Date(c.startDate).toLocaleDateString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setPickComp(false)} className="mg-btn mg-btn-secondary !min-h-10 !px-3 !text-sm">Cancel</button>
        </div>
      )}

      {loading ? (
        <p role="status" className="mg-meta">Loading…</p>
      ) : view === 'all' ? (
        <div className="space-y-4">
          {user && grouped.mine.size > 0 && (
            <section>
              <h2 className="mg-eyebrow mb-2">
                Mine ({Array.from(grouped.mine.values()).reduce((n, list) => n + list.length, 0)})
              </h2>
              <GroupedFormList groups={grouped.mine} expanded={expanded} onToggle={toggleExpanded} highlight />
            </section>
          )}
          {grouped.others.size > 0 && (
            <section>
              <h2 className="mg-eyebrow mb-2">
                Everyone else's locked forms ({Array.from(grouped.others.values()).reduce((n, list) => n + list.length, 0)})
              </h2>
              <GroupedFormList groups={grouped.others} expanded={expanded} onToggle={toggleExpanded} />
            </section>
          )}
          {grouped.mine.size === 0 && grouped.others.size === 0 && (
            <div className="mg-card mg-lede p-5">No dec forms yet.</div>
          )}
        </div>
      ) : (
        <div className="mg-card mg-list">
          {forms.map((f) => (
            <Link key={f.id} to={`/competitions/${f.competitionId}/declarations`} className="mg-row flex-col !items-start !justify-center !gap-0.5">
              <h2 className="mg-h2">{f.teamName}</h2>
              <p className="mg-meta">{f.competitionName}</p>
              <p className="mg-meta">
                Submitted {new Date(f.submittedAt).toLocaleDateString()} · {f.riders.length} riders
              </p>
            </Link>
          ))}
          {forms.length === 0 && (
            <div className="mg-lede p-5">
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
            className={`mg-card p-3 ${highlight ? 'border-l-4 !border-l-[rgb(var(--mg-heading))]' : ''}`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/competitions/${compId}`}
                className="mg-h2 flex-1 truncate hover:underline"
              >
                {compName}
              </Link>
              <span className="mg-meta">
                {list.length} form{list.length === 1 ? '' : 's'} · last {new Date(newest.submittedAt).toLocaleDateString()}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {list.map((f) => {
                const isOpen = expanded.has(f.id);
                return (
                  <li key={f.id} className="rounded-lg border border-[rgb(var(--mg-rule))] px-2 py-1">
                    <button
                      onClick={() => onToggle(f.id)}
                      className="flex min-h-11 w-full items-center gap-2 text-left"
                    >
                      <Users className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                      <span className="font-medium text-sm flex-1 truncate">{f.teamName}</span>
                      <span className="mg-meta hidden sm:inline">
                        {f.riders.length} rider{f.riders.length === 1 ? '' : 's'} · {new Date(f.submittedAt).toLocaleDateString()}
                      </span>
                      {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-[rgb(var(--mg-muted))]" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 text-[rgb(var(--mg-muted))]" aria-hidden="true" />}
                    </button>
                    {isOpen && (
                      <ul className="mg-list mt-1.5 text-[13px]">
                        {f.riders.map((r) => (
                          <li key={r.id} className="py-1 flex items-center gap-2">
                            <span className="w-5 font-mono text-[11px] text-[rgb(var(--mg-muted))]">{r.orderIndex + 1}.</span>
                            <span className="font-medium flex-1 truncate">{r.fullName}</span>
                            {r.horseName && <span className="mg-meta truncate">on {r.horseName}</span>}
                            {r.isCaptain && <span className="text-[11px] font-bold uppercase text-[rgb(var(--mg-late-ink))]">cap</span>}
                            {r.isReserve && <span className="text-[11px] font-bold uppercase text-[rgb(var(--mg-muted))]">res</span>}
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
