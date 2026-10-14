import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Search, Trophy, X } from 'lucide-react';
import { api } from '../api';
import type { CompetitionSummary } from '../types';
import { useCurrentCompetition } from './CurrentCompetitionContext';

export function CompetitionPicker({ onClose }: { onClose?: () => void }) {
  const headingId = useId();
  const { current, setCurrent } = useCurrentCompetition();
  const navigate = useNavigate();
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [savedCopy, setSavedCopy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.get<CompetitionSummary[]>('/competitions', { params: { includeArchived } })
      .then(({ data, headers }) => { if (!cancelled) { setCompetitions(data); setSavedCopy(headers['x-mg-saved-copy'] === '1'); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [includeArchived, attempt]);

  useEffect(() => {
    const refresh = () => setAttempt((n) => n + 1);
    window.addEventListener('online', refresh);
    navigator.serviceWorker?.addEventListener('controllerchange', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      navigator.serviceWorker?.removeEventListener('controllerchange', refresh);
    };
  }, []);

  const matches = competitions.filter((c) => `${c.name} ${c.location ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.startDate.localeCompare(a.startDate));
  return (
    <section className="mx-auto w-full max-w-lg space-y-4 p-1 sm:p-4" aria-labelledby={headingId}>
      <div className="flex items-start gap-3">
        <Trophy className="mt-1 h-7 w-7 shrink-0 text-brand-600" />
        <div className="flex-1">
          <h1 id={headingId} className="text-2xl font-bold">Select a competition</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Choose the event you’re following to see its timetable.</p>
        </div>
        {onClose && <button onClick={onClose} className="btn-ghost min-h-11 min-w-11" aria-label="Close competition picker"><X className="h-5 w-5" /></button>}
      </div>
      <label className="relative block">
        <span className="sr-only">Search competitions</span>
        <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
        <input autoFocus={!!onClose} className="input min-h-12 !pl-10" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or location" />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Include archived competitions
      </label>
      {savedCopy && !loading && !error && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Showing a saved competition list. New events may be missing until your connection returns.</p>}
      <div className="space-y-3" aria-live="polite">
        {loading ? <p className="py-6 text-center text-slate-500">Loading competitions…</p> : error ? (
          <div className="card p-4 space-y-3" role="alert">
            <p>Couldn’t load competitions. Check your connection and try again.</p>
            <button className="btn-primary min-h-11" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        ) : matches.length === 0 ? <p className="card p-4">{query ? 'No competitions match your search.' : 'No competitions available yet.'}</p> : matches.map((c) => (
          <button key={c.id} className="card flex w-full items-center gap-3 p-4 text-left hover:border-brand-500 focus-visible:outline-brand-500" onClick={() => {
            setCurrent({ id: c.id, name: c.name });
            navigate(`/competitions/${c.id}`);
            onClose?.();
          }}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap gap-2 text-xs font-semibold text-brand-700 dark:text-brand-300">
                {c.isActive && !c.isArchived && <span>Live</span>}
                {c.isArchived && <span>Archived</span>}
                {current?.id === c.id && <span>Selected</span>}
              </div>
              <h2 className="break-words text-lg font-semibold">{c.name}</h2>
              {c.location && <p className="text-sm text-slate-600 dark:text-slate-300">{c.location}</p>}
              <p className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400"><CalendarDays className="h-4 w-4" />{new Date(c.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-brand-600" />
          </button>
        ))}
      </div>
      {!onClose && <Link to="/dashboard" className="inline-flex min-h-11 items-center text-sm text-brand-700 dark:text-brand-300 underline">Open dashboard</Link>}
    </section>
  );
}

export function CompetitionPickerDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} onCancel={onClose} aria-label="Select a competition" className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-4 text-slate-900 shadow-xl backdrop:bg-black/50 dark:bg-slate-900 dark:text-slate-100"><CompetitionPicker onClose={onClose} /></dialog>;
}
