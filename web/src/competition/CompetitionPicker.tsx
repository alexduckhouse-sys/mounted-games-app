import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { api } from '../api';
import type { CompetitionPickerItem, CompetitionPickerPage } from '../types';
import { useCurrentCompetition } from './CurrentCompetitionContext';
import { CompetitionIcon } from './CompetitionIcon';
import { competitionIcon } from './icons';
import { competitionDateText, isOnToday } from '../lib/competitionDates';
import { displaySectionName } from '../lib/section';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import { CompetitionListSkeleton } from '../components/Skeletons';
import { DemoEventBadge } from '../components/DemoEventNotice';

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
  // The first page this phone saw last time shows while the list refreshes.
  const [saved] = useState(() => readSavedCopy<CompetitionPickerPage>(savedCopyKeys.picker(past)));
  const [state, setState] = useState({ items: saved?.data.items ?? [] as CompetitionPickerItem[], page: 0, hasMore: false, error: false, savedCopy: !!saved });
  const loading = state.page !== page;
  useEffect(() => {
    const controller = new AbortController();
    api.get<CompetitionPickerPage>('/competitions/picker', { params: { past, page }, signal: controller.signal })
      .then(({ data, headers }) => {
        if (controller.signal.aborted) return;
        const fallback = serviceWorkerSavedAt(headers);
        if (page === 1 && fallback === null) writeSavedCopy(savedCopyKeys.picker(past), data);
        const keepSaved = page === 1 && fallback !== null && saved != null && (fallback === 'unknown' || Date.parse(saved.savedAt) >= fallback.getTime());
        const fresh = keepSaved ? saved.data : data;
        setState((previous) => {
          // Page 1 replaces the saved list, which may still hold competitions that have since gone.
          const kept = page === 1 ? [] : previous.items;
          return {
            items: [...kept, ...fresh.items.filter((item) => !kept.some((existing) => existing.id === item.id))],
            page, hasMore: fresh.hasMore, error: false,
            savedCopy: (page > 1 && previous.savedCopy) || fallback !== null,
          };
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, page, error: true }));
      });
    return () => controller.abort();
  }, [past, page, saved]);

  const matches = state.items;
  const now = new Date();
  const onToday = past ? [] : matches.filter((item) => isOnToday(item.startDate, item.endDate, now));
  const later = matches.filter((item) => !onToday.includes(item));
  const choose = (competition: CompetitionPickerItem) => {
    setCurrent({ id: competition.id, name: competition.name });
    navigate(`/competitions/${competition.id}`);
    onClose?.();
  };
  return (
    <section className="mg-font mx-auto flex w-full max-w-xl flex-col gap-[22px] py-6" aria-labelledby={headingId}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 id={headingId} className="mg-h1">{past ? 'Past competitions' : 'Pick a competition'}</h1>
          {past && <p className="mg-lede">Results and toplists from earlier events.</p>}
        </div>
        {onClose && <button autoFocus onClick={onClose} className="mg-icon-btn" aria-label="Close competition picker"><X className="h-5 w-5" /></button>}
      </div>
      {state.savedCopy && !loading && <p role="status" className="mg-notice">Showing a saved list. It will refresh when your connection returns.</p>}
      <div className="flex flex-col gap-[22px]" aria-busy={loading}>
        {onToday.length > 0 && (
          <section className="flex flex-col gap-2.5" aria-label="On today">
            <h2 className="mg-eyebrow">On today</h2>
            {onToday.map((competition) => <TodayCard key={competition.id} competition={competition} selected={current?.id === competition.id} onChoose={() => choose(competition)} />)}
          </section>
        )}
        {later.length > 0 && (
          <section className="flex flex-col gap-2.5" aria-label={past ? 'Finished' : 'Coming up'}>
            <h2 className="mg-eyebrow">{past ? 'Finished' : 'Coming up'}</h2>
            <div className="mg-card mg-list">
              {later.map((competition) => <CompetitionRow key={competition.id} competition={competition} past={past} selected={current?.id === competition.id} onChoose={() => choose(competition)} />)}
            </div>
          </section>
        )}
        {loading && (state.items.length === 0 ? <CompetitionListSkeleton /> : <p role="status" className="mg-meta py-3 text-center">Checking for changes…</p>)}
        {!loading && state.error && <div className="mg-card flex flex-col items-start gap-3 p-4" role="alert"><p>Couldn’t load competitions. Check your connection and try again.</p><button className="mg-btn mg-btn-primary" onClick={onRetry}>Try again</button></div>}
        {!loading && !state.error && state.items.length === 0 && <p className="mg-card p-4">{past ? 'No past competitions yet.' : 'No competitions available yet.'}</p>}
        {!loading && !state.error && state.hasMore && <button className="mg-btn mg-btn-secondary w-full" onClick={() => setPage((value) => value + 1)}>Load more competitions</button>}
      </div>
      <Link to={past ? '/competitions' : '/competitions/past'} onClick={onClose} className="mg-text-link">{past ? 'Upcoming competitions' : 'Past competitions'}</Link>
    </section>
  );
}

/** "Seniors Heat 2 in the arena", or "… in Main arena" when the arena has a name. */
function liveLine(live: NonNullable<CompetitionPickerItem['live']>) {
  const what = [displaySectionName(live.sectionName), live.heatLabel].filter(Boolean).join(' ');
  return `${what} in ${live.arenaName ? live.arenaName : 'the arena'}`;
}

function TodayCard({ competition, selected, onChoose }: { competition: CompetitionPickerItem; selected: boolean; onChoose: () => void }) {
  const groups = competition.ageGroupCount ?? 0;
  const details = [
    competitionDateText(competition.startDate, competition.endDate),
    competition.location?.trim(),
    groups > 0 ? `${groups} age ${groups === 1 ? 'group' : 'groups'}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <button aria-pressed={selected} onClick={onChoose} className={`mg-card flex w-full flex-col gap-3 !border-[1.5px] p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--mg-heading))] ${competition.live ? '!border-[rgb(var(--mg-red))]' : '!border-[rgb(var(--mg-control))]'}`}>
      {competition.live && (
        <span className="flex min-w-0 items-center gap-2">
          <span className="mg-badge mg-badge-live">Live</span>
          <span className="min-w-0 truncate text-[13px] font-medium text-[rgb(var(--mg-muted))]">{liveLine(competition.live)}</span>
        </span>
      )}
      <span className="flex flex-col gap-1">
        {competition.isDemo && <DemoEventBadge className="self-start" />}
        <span className="mg-display break-words text-2xl font-bold leading-tight text-[rgb(var(--mg-heading))]">{competition.name}</span>
        {details && <span className="text-sm leading-snug text-[rgb(var(--mg-body))]">{details}</span>}
      </span>
      <span className="mg-btn mg-btn-primary self-start">{selected ? 'Back to timetable' : 'Open timetable'}</span>
    </button>
  );
}

function CompetitionRow({ competition, past, selected, onChoose }: { competition: CompetitionPickerItem; past: boolean; selected: boolean; onChoose: () => void }) {
  const start = new Date(competition.startDate);
  const multiDay = !!competition.endDate && competitionDateText(competition.startDate, competition.endDate) !== competitionDateText(competition.startDate, null);
  const venue = competition.location?.trim();
  const when = past || multiDay || !venue ? competitionDateText(competition.startDate, competition.endDate, past) : null;
  return (
    <button aria-pressed={selected} onClick={onChoose} className={`mg-row ${selected ? 'shadow-[inset_4px_0_0_rgb(var(--mg-heading))]' : ''}`}>
      <span aria-hidden="true" className="flex w-11 shrink-0 flex-col items-center gap-0.5 text-[rgb(var(--mg-heading))]">
        <span className="mg-display text-[22px] font-bold leading-none">{Number.isNaN(start.getTime()) ? '–' : start.getDate()}</span>
        <span className="text-[11px] font-bold uppercase leading-none tracking-[0.06em]">{Number.isNaN(start.getTime()) ? '' : start.toLocaleDateString('en-GB', { month: 'short' })}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="break-words text-base font-semibold leading-tight">{competition.name}</span>
        {competition.isDemo && <DemoEventBadge className="self-start" />}
        <span className="mg-meta">{[when, venue].filter(Boolean).join(' · ')}</span>
      </span>
      {competitionIcon(competition.icon).id !== 'flag' && <CompetitionIcon id={competition.icon} labelled className="text-xl" />}
      {selected && <span className="sr-only">(current competition)</span>}
    </button>
  );
}

export function CompetitionPickerDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} onCancel={onClose} aria-label="Select a competition" className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl bg-[rgb(var(--mg-ground))] px-4 text-[rgb(var(--mg-ink))] shadow-xl backdrop:bg-[rgb(var(--mg-overlay)/0.55)]"><CompetitionPicker onClose={onClose} /></dialog>;
}
