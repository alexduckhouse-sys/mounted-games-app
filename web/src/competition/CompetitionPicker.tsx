import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, X } from 'lucide-react';
import { api } from '../api';
import type { CompetitionPickerItem, CompetitionPickerPage } from '../types';
import { useCurrentCompetition } from './CurrentCompetitionContext';
import { competitionIcon } from './icons';

export function CompetitionPicker({ onClose, past = false }: { onClose?: () => void; past?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const refresh = () => setAttempt((n) => n + 1);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('online', refresh);
    };
  }, []);
  return <CompetitionList key={`${past}-${attempt}`} past={past} onClose={onClose} onRetry={() => setAttempt((n) => n + 1)} />;
}

function CompetitionList({ onClose, onRetry, past }: { onClose?: () => void; onRetry: () => void; past: boolean }) {
  const headingId = useId();
  const { current, setCurrent } = useCurrentCompetition();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ items: [] as CompetitionPickerItem[], page: 0, hasMore: false, error: false, savedCopy: false });
  const loading = state.page !== page;
  useEffect(() => {
    const controller = new AbortController();
    api.get<CompetitionPickerPage>('/competitions/picker', { params: { past, page }, signal: controller.signal })
      .then(({ data, headers }) => {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          items: [...previous.items, ...data.items.filter((item) => !previous.items.some((existing) => existing.id === item.id))],
          page, hasMore: data.hasMore, error: false,
          savedCopy: previous.savedCopy || headers['x-mg-saved-copy'] === '1',
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, page, error: true }));
      });
    return () => controller.abort();
  }, [past, page]);

  const formatDate = (date: string) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <section className="mx-auto w-full max-w-lg space-y-4 py-2 sm:py-4" aria-labelledby={headingId}>
      <div className="flex items-center gap-3">
        <h1 id={headingId} className="flex-1 text-2xl font-bold tracking-tight">{past ? 'Past competitions' : 'Select a competition'}</h1>
        {onClose && <button autoFocus onClick={onClose} className="btn-ghost min-h-11 min-w-11" aria-label="Close competition picker"><X className="h-5 w-5" /></button>}
      </div>
      {state.savedCopy && !loading && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Showing a saved list. It will refresh when your connection returns.</p>}
      <div className="space-y-3" aria-busy={loading}>
        {state.items.map((competition) => {
          const icon = competitionIcon(competition.icon);
          const selected = current?.id === competition.id;
          const endDate = competition.endDate ? formatDate(competition.endDate) : null;
          const startDate = formatDate(competition.startDate);
          return (
            <button key={competition.id} aria-pressed={selected} className={`flex min-h-24 w-full items-center gap-4 rounded-2xl border p-4 text-left shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${selected ? 'border-brand-500 bg-brand-50 dark:bg-brand-900' : 'border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'}`} onClick={() => {
              setCurrent({ id: competition.id, name: competition.name });
              navigate(`/competitions/${competition.id}`);
              onClose?.();
            }}>
              <span aria-hidden="true" className="flex w-14 shrink-0 items-center justify-center text-5xl leading-none">{icon.symbol}</span>
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="block break-words text-base font-semibold leading-snug">{competition.name}</span>
                <span className="flex items-start gap-1.5 text-sm text-slate-500 dark:text-slate-400"><CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span>{startDate}{endDate && endDate !== startDate ? ` – ${endDate}` : ''}</span></span>
              </span>
              <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-600" />
            </button>
          );
        })}
        {loading && <p role="status" className="py-6 text-center text-sm text-slate-500">Loading competitions…</p>}
        {!loading && state.error && <div className="card space-y-3 p-4" role="alert"><p>Couldn’t load competitions. Check your connection and try again.</p><button className="btn-primary min-h-11" onClick={onRetry}>Try again</button></div>}
        {!loading && !state.error && state.items.length === 0 && <p className="card p-4">{past ? 'No past competitions yet.' : 'No competitions available yet.'}</p>}
        {!loading && !state.error && state.hasMore && <button className="btn-ghost min-h-12 w-full" onClick={() => setPage((value) => value + 1)}>Load more competitions</button>}
      </div>
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
