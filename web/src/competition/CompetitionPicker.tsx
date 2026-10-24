import { usePageWidth } from '../components/pageWidthState';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, History, PinOff, Search } from 'lucide-react';
import { api } from '../api';
import type { CompetitionPickerItem, CompetitionPickerPage } from '../types';
import { useCurrentCompetition } from './CurrentCompetitionContext';
import { CompetitionIcon } from './CompetitionIcon';
import { competitionIcon } from './icons';
import { competitionDateText, isOnToday } from '../lib/competitionDates';
import { displaySectionName } from '../lib/section';
import { lastUpdatedText, readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, shouldNoticeSavedCopy, writeSavedCopy } from '../offline/savedCopies';
import { CompetitionListSkeleton } from '../components/Skeletons';
import { usePageHeader } from '../components/CompactPageBarContext';
import { useAuth } from '../auth/AuthContext';

/** The events page: upcoming competitions, with the past ones a link away at the bottom. */
export function CompetitionPicker({ past = false }: { past?: boolean }) {
  usePageWidth('wide');
  const { user } = useAuth();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const refresh = () => setAttempt((n) => n + 1);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('online', refresh);
    };
  }, []);
  return <CompetitionList key={`${past}-${user?.id ?? 'public'}`} past={past} refresh={attempt} onRetry={() => setAttempt((n) => n + 1)} />;
}

function PlainHeader({ past }: { past: boolean }) {
  usePageHeader({ title: past ? 'Past competitions' : 'Competitions', plain: true });
  return null;
}

function CompetitionList({ onRetry, past, refresh }: { onRetry: () => void; past: boolean; refresh: number }) {
  const headingId = useId();
  const { current, setCurrent, forget } = useCurrentCompetition();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [mineOnly, setMineOnly] = useState(false);
  const serverSearch = past ? search.trim() : '';
  const filterKey = past ? JSON.stringify([yearFilter, locationFilter, serverSearch, mineOnly]) : 'upcoming';
  const unfiltered = !mineOnly && yearFilter === 'all' && locationFilter === 'all' && !serverSearch;
  // Only the unfiltered public page is kept on this device; personal results stay in memory.
  const [saved] = useState(() => readSavedCopy<CompetitionPickerPage>(savedCopyKeys.picker(past)));
  const [state, setState] = useState({ key: filterKey, items: saved?.data.items ?? [] as CompetitionPickerItem[], page: 0, hasMore: false, error: false, savedCopy: !!saved, savedAt: saved?.savedAt ?? null as string | null,
    years: saved?.data.years ?? [] as number[], locations: saved?.data.locations ?? [] as string[] });
  const loading = state.page !== page || state.key !== filterKey;
  useEffect(() => {
    const controller = new AbortController();
    const filters = past ? {
      ...(yearFilter !== 'all' ? { year: Number(yearFilter) } : {}),
      ...(locationFilter !== 'all' ? { location: locationFilter } : {}),
      ...(serverSearch ? { search: serverSearch } : {}),
    } : {};
    api.get<CompetitionPickerPage>(mineOnly ? '/competitions/picker/mine' : '/competitions/picker', { params: { past, page, ...filters }, signal: controller.signal })
      .then(({ data, headers }) => {
        if (controller.signal.aborted) return;
        const fallback = mineOnly ? null : serviceWorkerSavedAt(headers);
        if (unfiltered && page === 1 && fallback === null) writeSavedCopy(savedCopyKeys.picker(past), data);
        const keepSaved = unfiltered && page === 1 && fallback !== null && saved != null && (fallback === 'unknown' || Date.parse(saved.savedAt) >= fallback.getTime());
        const fresh = keepSaved ? saved.data : data;
        setState((previous) => {
          const kept = page === 1 || previous.key !== filterKey ? [] : previous.items;
          return {
            key: filterKey, items: [...kept, ...fresh.items.filter((item) => !kept.some((existing) => existing.id === item.id))],
            years: fresh.years ?? [], locations: fresh.locations ?? [],
            page, hasMore: fresh.hasMore, error: false,
            savedCopy: (page > 1 && previous.key === filterKey && previous.savedCopy) || fallback !== null,
            savedAt: fallback === null ? (page > 1 ? previous.savedAt : null) : keepSaved ? saved.savedAt : fallback === 'unknown' ? '' : fallback.toISOString(),
          };
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous,
          ...(previous.key !== filterKey ? { items: [], savedCopy: false, savedAt: null, hasMore: false } : {}), key: filterKey, page, error: true }));
      });
    return () => controller.abort();
  }, [past, page, saved, filterKey, yearFilter, locationFilter, serverSearch, mineOnly, unfiltered, refresh]);

  const query = search.trim().toLowerCase();
  const items = state.key === filterKey ? state.items : [];
  const matches = !past && query ? items.filter((item) => `${item.name} ${item.location ?? ''}`.toLowerCase().includes(query)) : items;
  const years = state.years;
  const locations = state.locations;
  const now = new Date();
  const onToday = past ? [] : matches.filter((item) => isOnToday(item.startDate, item.endDate, now));
  const later = matches.filter((item) => !onToday.includes(item));
  const choose = (competition: CompetitionPickerItem) => {
    setCurrent({ id: competition.id, name: competition.name });
    navigate(`/competitions/${competition.id}`);
  };
  const forgetCurrent = () => {
    forget();
    navigate('/events');
  };
  return (
    <section className="mg-font mx-auto flex w-full max-w-xl flex-col gap-3.5 pb-5 lg:max-w-none" aria-labelledby={headingId}>
      <PlainHeader past={past} />
      <h1 id={headingId} className="sr-only">{past ? 'Past competitions' : 'Competitions'}</h1>
      <div className="mg-band mg-band-header flex flex-col gap-2 pb-3 pt-0">
        <label className="mg-navy-field">
          <Search className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <span className="sr-only">Search competitions</span>
          <input type="search" placeholder="Name or venue" value={search} onChange={(event) => { setSearch(event.target.value); if (past) setPage(1); }} />
        </label>
        {past && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Archive filters">
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
              <span>Year</span>
              <select aria-label="Filter by year" value={yearFilter} onChange={(e) => { setYearFilter(e.target.value); setPage(1); }} className="rounded bg-white/15 px-2 py-1 text-xs text-white">
                <option value="all">All years</option>
                {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
              <span>Location</span>
              <select aria-label="Filter by location" value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }} className="rounded bg-white/15 px-2 py-1 text-xs text-white">
                <option value="all">All locations</option>
                {locations.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <button type="button" disabled={!user} aria-pressed={mineOnly} onClick={() => { setMineOnly((v) => !v); setPage(1); }} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${mineOnly ? 'bg-white text-[rgb(var(--mg-heading))]' : 'bg-white/15 text-white'}`}>
              My club / competitions I rode in
            </button>
          </div>
        )}
        {past && <Link to="/events" className="inline-flex min-h-11 items-center gap-1 self-start text-[13px] font-semibold !text-white !no-underline"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Back to upcoming competitions</Link>}
      </div>
      {current && (
        <button type="button" onClick={forgetCurrent} className="mg-btn mg-btn-secondary w-full">
          <PinOff className="h-4 w-4" aria-hidden="true" />Forget this competition<span className="sr-only">: {current.name}</span>
        </button>
      )}
      {!mineOnly && state.savedCopy && !loading && shouldNoticeSavedCopy(state.savedAt, true, now) && <p role="status" className="mg-notice">{lastUpdatedText(state.savedAt, now)}. We’ll refresh when you’re back online.</p>}
      <div className="flex flex-col gap-3.5" aria-busy={loading}>
        {onToday.length > 0 && (
          <section className="mg-sec" aria-label="On today">
            <div className="mg-sec-head"><h2>On today</h2></div>
            <div className="mg-cards-grid flex flex-col gap-1.5">
              {onToday.map((competition) => <TodayCard key={competition.id} competition={competition} selected={current?.id === competition.id} onChoose={() => choose(competition)} />)}
            </div>
          </section>
        )}
        {later.length > 0 && (
          <section className="mg-sec" aria-label={past ? 'Finished' : 'Coming up'}>
            <div className="mg-sec-head"><h2>{past ? 'Finished' : 'Coming up'}</h2></div>
            <div className="mg-lines mg-lines-grid">
              {later.map((competition) => <CompetitionRow key={competition.id} competition={competition} past={past} selected={current?.id === competition.id} onChoose={() => choose(competition)} />)}
            </div>
          </section>
        )}
        {loading && (state.items.length === 0 ? <CompetitionListSkeleton /> : <p role="status" className="mg-meta py-3 text-center">Checking for changes…</p>)}
        {!loading && state.error && <div className="mg-card flex flex-col items-start gap-3 p-4" role="alert"><p>Couldn’t load competitions. Check your connection and try again.</p><button className="mg-btn mg-btn-primary" onClick={onRetry}>Try again</button></div>}
        {!loading && !state.error && state.items.length === 0 && <p className="mg-card p-4">{!unfiltered ? 'No competitions match those filters.' : past ? 'No past competitions yet.' : 'No competitions available yet.'}</p>}
        {!loading && !state.error && state.items.length > 0 && matches.length === 0 && <p className="mg-card p-4">No competitions match that search.{state.hasMore ? ' Load more to search further back.' : ''}</p>}
        {!loading && !state.error && state.hasMore && <button className="mg-btn mg-btn-secondary w-full" onClick={() => setPage((value) => value + 1)}>Load more competitions</button>}
        {!past && <Link to="/competitions/past" className="mg-btn mg-btn-secondary w-full"><History className="h-4 w-4" aria-hidden="true" />See past competitions</Link>}
      </div>
    </section>
  );
}

/** "Open · Heat 2 on now in Arena 2", or "Heat 1 on now in the arena" when nothing more is known. */
function liveLine(live: NonNullable<CompetitionPickerItem['live']>) {
  const section = displaySectionName(live.sectionName);
  return `${section ? `${section} · ` : ''}${live.heatLabel} on now in ${live.arenaName ? live.arenaName : 'the arena'}`;
}

/** The small tag on a list row: entries open. */
function Tags({ competition }: { competition: CompetitionPickerItem }) {
  return competition.entriesOpen ? <span className="mg-tag mg-tag-ok">Entries open</span> : null;
}

function TodayCard({ competition, selected, onChoose }: { competition: CompetitionPickerItem; selected: boolean; onChoose: () => void }) {
  const details = [competition.location?.trim(), competitionDateText(competition.startDate, competition.endDate)].filter(Boolean).join(' · ');
  return (
    <div className={`mg-card flex flex-col gap-1.5 !rounded-[10px] py-3 pl-3.5 pr-3 ${competition.live ? 'shadow-[inset_3px_0_0_rgb(var(--mg-red))]' : ''}`}>
      <span className="flex min-w-0 items-center gap-2">
        {competition.live && <span className="mg-badge mg-badge-live !h-5 !rounded-[4px] !px-[7px] text-[11px] font-bold tracking-[0.06em]">LIVE</span>}
        <strong className="min-w-0 flex-1 break-words text-base font-bold leading-tight">{competition.name}</strong>
      </span>
      {details && <span className="mg-meta">{details}</span>}
      {competition.live && <span className="text-[13px]">{liveLine(competition.live)}</span>}
      {competition.entriesOpen && <span className="flex flex-wrap gap-1.5"><Tags competition={competition} /></span>}
      <button aria-pressed={selected} onClick={onChoose} className="mg-btn mg-btn-primary mt-1 !min-h-11 w-full !rounded-lg !text-[15px]">
        Open competition<span className="sr-only">: {competition.name}</span>
        <ChevronRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}

function CompetitionRow({ competition, past, selected, onChoose }: { competition: CompetitionPickerItem; past: boolean; selected: boolean; onChoose: () => void }) {
  const start = new Date(competition.startDate);
  const venue = competition.location?.trim();
  const multiDay = !!competition.endDate && competitionDateText(competition.startDate, competition.endDate) !== competitionDateText(competition.startDate, null);
  const when = past || multiDay || !venue ? competitionDateText(competition.startDate, competition.endDate, past) : null;
  return (
    <button aria-pressed={selected} onClick={onChoose} className={`mg-line grid-cols-[44px_minmax(0,1fr)_14px] !min-h-[60px] !gap-x-3 !py-2 ${selected ? 'shadow-[inset_4px_0_0_rgb(var(--mg-heading))]' : ''}`}>
      <span aria-hidden="true" className="flex flex-col items-center gap-0.5 text-[rgb(var(--mg-heading))]">
        <span className="mg-display text-[22px] font-bold leading-none">{Number.isNaN(start.getTime()) ? '–' : start.getDate()}</span>
        <span className="text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-[rgb(var(--mg-muted))]">{Number.isNaN(start.getTime()) ? '' : start.toLocaleDateString('en-GB', { month: 'short' })}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="mg-line-title min-w-0 !font-semibold">{competition.name}</strong>
          {competitionIcon(competition.icon).id !== 'flag' && <CompetitionIcon id={competition.icon} labelled className="shrink-0 text-base" />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[rgb(var(--mg-muted))]">
          <span className="min-w-0 truncate">{[when, venue].filter(Boolean).join(' · ')}</span>
          <Tags competition={competition} />
        </span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
      {selected && <span className="sr-only">(current competition)</span>}
    </button>
  );
}
