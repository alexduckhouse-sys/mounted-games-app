import { useCompetitionPrefetch } from '../hooks/useCompetitionPrefetch';
import { usePageWidth } from '../components/pageWidthState';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Clock, PinOff } from 'lucide-react';
import { Notice } from '../components/Notice';
import { PageProblem } from '../components/PageProblem';
import { api } from '../api';
import type { CompetitionNearYouPage, CompetitionPickerItem, CompetitionPickerPage } from '../types';
import { useCurrentCompetition } from './CurrentCompetitionContext';
import { CompetitionIcon } from './CompetitionIcon';
import { competitionIcon } from './icons';
import { competitionDateText, isOnToday } from '../lib/competitionDates';
import { displaySectionName } from '../lib/section';
import { distanceMap, distanceText, isNearYouPage, readEventsSort, writeEventsSort, type EventsSort } from '../lib/nearYou';
import { lastUpdatedText, readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, shouldNoticeSavedCopy, writeSavedCopy } from '../offline/savedCopies';
import { CompetitionListSkeleton } from '../components/Skeletons';
import { usePageHeader } from '../components/CompactPageBarContext';
import { useAuth } from '../auth/AuthContext';
import { CardDropdownRow } from '../components/CardDropdownRow';
import { RoundSearch } from '../components/RoundSearch';
import { RefineSwitchRow } from '../pages/refine/Refine';
import { useLanguage } from '../i18n/LanguageContext';
import type { Translate } from '../i18n/translate';
import '../components/sitePages.css';

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
  const { t } = useLanguage();
  usePageHeader({ title: past ? t('shell.events.titlePast') : t('shell.events.title'), plain: true });
  return null;
}

function CompetitionList({ onRetry, past, refresh }: { onRetry: () => void; past: boolean; refresh: number }) {
  const { t } = useLanguage();
  const headingId = useId();
  const { current, setCurrent, forget } = useCurrentCompetition();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [sortChoice, setSortChoice] = useState<EventsSort>(readEventsSort);
  const serverSearch = past ? search.trim() : '';
  const filterKey = past ? JSON.stringify([yearFilter, locationFilter, serverSearch, mineOnly]) : `upcoming-${sortChoice}`;
  const unfiltered = !mineOnly && yearFilter === 'all' && locationFilter === 'all' && !serverSearch;
  // Only the unfiltered public page is kept on this device; personal results stay in memory.
  const [saved] = useState(() => readSavedCopy<CompetitionPickerPage>(savedCopyKeys.picker(past)));
  const [state, setState] = useState({ key: filterKey, items: saved?.data.items ?? [] as CompetitionPickerItem[], page: 0, hasMore: false, error: false, savedCopy: !!saved, savedAt: saved?.savedAt ?? null as string | null,
    years: saved?.data.years ?? [] as number[], locations: saved?.data.locations ?? [] as string[],
    distances: {} as Record<number, number>, locationKnown: false });
  const loading = state.page !== page || state.key !== filterKey;
  useEffect(() => {
    const controller = new AbortController();
    const filters = past ? {
      ...(yearFilter !== 'all' ? { year: Number(yearFilter) } : {}),
      ...(locationFilter !== 'all' ? { location: locationFilter } : {}),
      ...(serverSearch ? { search: serverSearch } : {}),
    } : {};
    // The upcoming list is asked for ordered for this viewer (nearest first when we can tell roughly where they are, without
    // ever asking). That answer differs per person, so it is never cached; if it fails, the same public list as ever is used.
    const load = async (): Promise<{ data: CompetitionPickerPage; headers: unknown; nearYou: CompetitionNearYouPage | null }> => {
      if (!past && !mineOnly) {
        try {
          const response = await api.get<CompetitionNearYouPage>('/competitions/picker/near-you', {
            params: { page, ...(sortChoice === 'soonest' ? { sort: 'soonest' } : {}) }, signal: controller.signal,
          });
          if (isNearYouPage(response.data)) return { data: response.data, headers: {}, nearYou: response.data };
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
      }
      const response = await api.get<CompetitionPickerPage>(mineOnly ? '/competitions/picker/mine' : '/competitions/picker', { params: { past, page, ...filters }, signal: controller.signal });
      return { data: response.data, headers: response.headers, nearYou: null };
    };
    load()
      .then(({ data, headers, nearYou }) => {
        if (controller.signal.aborted) return;
        const fallback = mineOnly ? null : serviceWorkerSavedAt(headers as never);
        const located = nearYou?.locationKnown === true;
        // A list put in order for one person is not kept on the device as the public copy.
        if (unfiltered && page === 1 && fallback === null && !located) writeSavedCopy(savedCopyKeys.picker(past), data);
        const keepSaved = unfiltered && page === 1 && fallback !== null && saved != null && (fallback === 'unknown' || Date.parse(saved.savedAt) >= fallback.getTime());
        const fresh = keepSaved ? saved.data : data;
        setState((previous) => {
          const reset = page === 1 || previous.key !== filterKey;
          const kept = reset ? [] : previous.items;
          return {
            key: filterKey, items: [...kept, ...fresh.items.filter((item) => !kept.some((existing) => existing.id === item.id))],
            years: fresh.years ?? [], locations: fresh.locations ?? [],
            page, hasMore: fresh.hasMore, error: false,
            savedCopy: (page > 1 && previous.key === filterKey && previous.savedCopy) || fallback !== null,
            savedAt: fallback === null ? (page > 1 ? previous.savedAt : null) : keepSaved ? saved.savedAt : fallback === 'unknown' ? '' : fallback.toISOString(),
            distances: nearYou ? { ...(reset ? {} : previous.distances), ...distanceMap(nearYou) } : {},
            locationKnown: located,
          };
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous,
          ...(previous.key !== filterKey ? { items: [], savedCopy: false, savedAt: null, hasMore: false } : {}), key: filterKey, page, error: true }));
      });
    return () => controller.abort();
  }, [past, page, saved, filterKey, sortChoice, yearFilter, locationFilter, serverSearch, mineOnly, unfiltered, refresh]);

  const query = search.trim().toLowerCase();
  const items = state.key === filterKey ? state.items : [];
  const matches = !past && query ? items.filter((item) => `${item.name} ${item.location ?? ''}`.toLowerCase().includes(query)) : items;
  const years = state.years;
  const locations = state.locations;
  const now = new Date();
  const onToday = past ? [] : matches.filter((item) => isOnToday(item.startDate, item.endDate, now));
  const later = matches.filter((item) => !onToday.includes(item));
  // The archive is grouped by year, newest first as the server sends it; upcoming events are one "Coming up" list.
  const groups = past
    ? later.reduce<{ heading: string; items: CompetitionPickerItem[] }[]>((all, item) => {
      const year = new Date(item.startDate).getFullYear();
      const heading = Number.isNaN(year) ? t('shell.events.earlier') : String(year);
      const last = all[all.length - 1];
      if (last?.heading === heading) last.items.push(item); else all.push({ heading, items: [item] });
      return all;
    }, [])
    : [{ heading: t('shell.events.comingUp'), items: later }];
  // Pointing at or pressing a competition starts loading it, so it opens straight away on a slow connection.
  const { handlersFor } = useCompetitionPrefetch();
  const chooseSort = (next: EventsSort) => {
    if (next === sortChoice) return;
    writeEventsSort(next);
    setSortChoice(next);
    setPage(1);
  };
  const distanceOf = (competition: CompetitionPickerItem) => (state.key === filterKey && competition.id in state.distances ? distanceText(state.distances[competition.id]) : '');
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
      <h1 id={headingId} className="sr-only">{past ? t('shell.events.titlePast') : t('shell.events.title')}</h1>
      <div className="mg-band mg-band-header pb-3 pt-0">
        <RoundSearch band label={t('shell.events.search')} placeholder={t('shell.events.searchPlaceholder')} value={search} onChange={(text) => { setSearch(text); if (past) setPage(1); }} />
      </div>
      {!past && state.locationKnown && state.key === filterKey && (
        <div role="group" aria-label="Order of the list" className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={sortChoice === 'nearest'} onClick={() => chooseSort('nearest')}
            className={`sp-pill sp-pill-sm ${sortChoice === 'nearest' ? 'sp-pill-fill' : ''}`}>Nearest first</button>
          <button type="button" aria-pressed={sortChoice === 'soonest'} onClick={() => chooseSort('soonest')}
            className={`sp-pill sp-pill-sm ${sortChoice === 'soonest' ? 'sp-pill-fill' : ''}`}>Soonest first</button>
        </div>
      )}
      {past && (
        <div role="group" aria-label={t('shell.events.archiveFilters')}>
          <div className="sp-card">
            <CardDropdownRow label={t('shell.events.year')} value={yearFilter} onChange={(value) => { setYearFilter(value); setPage(1); }}
              options={[{ value: 'all', label: t('shell.events.allYears') }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} />
            <CardDropdownRow label={t('shell.events.location')} value={locationFilter} onChange={(value) => { setLocationFilter(value); setPage(1); }}
              options={[{ value: 'all', label: t('shell.events.allLocations') }, ...locations.map((r) => ({ value: r, label: r }))]} />
            <RefineSwitchRow label={t('shell.events.mine')} on={mineOnly} disabled={!user} onChange={(next) => { setMineOnly(next); setPage(1); }} />
          </div>
          {!user && <p className="sp-note">{t('shell.events.signInForClub')}</p>}
        </div>
      )}
      {current && (
        <button type="button" onClick={forgetCurrent} className="mg-btn mg-btn-secondary w-full">
          <PinOff className="h-4 w-4" aria-hidden="true" />{t('shell.events.forget')}<span className="sr-only">: {current.name}</span>
        </button>
      )}
      {!mineOnly && state.savedCopy && !loading && shouldNoticeSavedCopy(state.savedAt, true, now) && <Notice tone="info" icon={Clock}>{t('shell.events.refreshWhenOnline', { updated: lastUpdatedText(state.savedAt, now) })}</Notice>}
      <div className="flex flex-col gap-3.5" aria-busy={loading}>
        {onToday.length > 0 && (
          <section aria-label={t('shell.events.onToday')}>
            <h2 className="sp-sec sp-first">{t('shell.events.onToday')}</h2>
            <div className="mg-cards-grid flex flex-col gap-1.5">
              {onToday.map((competition) => <TodayCard key={competition.id} competition={competition} distance={distanceOf(competition)} selected={current?.id === competition.id} onChoose={() => choose(competition)} warm={handlersFor(competition.id)} />)}
            </div>
          </section>
        )}
        {later.length > 0 && groups.map((group) => (
          <section key={group.heading} aria-label={group.heading}>
            <h2 className="sp-sec sp-first">{group.heading}</h2>
            <div className="mg-lines mg-lines-grid">
              {group.items.map((competition) => <CompetitionRow key={competition.id} competition={competition} past={past} distance={distanceOf(competition)} selected={current?.id === competition.id} onChoose={() => choose(competition)} warm={handlersFor(competition.id)} />)}
            </div>
          </section>
        ))}
        {loading && state.items.length === 0 && <CompetitionListSkeleton />}
        {!loading && state.error && <PageProblem title={t('shell.events.loadFailed')} primaryLabel={t('common.tryAgain')} onPrimary={onRetry}>{t('shell.events.checkSignal')}</PageProblem>}
        {!loading && !state.error && state.items.length === 0 && <p className="mg-card p-4">{!unfiltered ? t('shell.events.noMatchFilters') : past ? t('shell.events.nonePast') : t('shell.events.noneYet')}</p>}
        {!loading && !state.error && state.items.length > 0 && matches.length === 0 && <p className="mg-card p-4">{t('shell.events.noMatchSearch')}{state.hasMore ? t('shell.events.loadMoreHint') : ''}</p>}
        {!loading && !state.error && state.hasMore && <button className="mg-btn mg-btn-secondary w-full" onClick={() => setPage((value) => value + 1)}>{t('shell.events.loadMore')}</button>}
        {!past && <p className="m-0 text-center"><Link to="/competitions/past" className="sp-link">{t('shell.events.titlePast')}</Link></p>}
      </div>
    </section>
  );
}

/** "Open · Heat 2 on now in Arena 2", or "Heat 1 on now in the arena" when nothing more is known. */
function liveLine(live: NonNullable<CompetitionPickerItem['live']>, t: Translate) {
  const section = displaySectionName(live.sectionName);
  return `${section ? `${section} · ` : ''}${t('shell.events.liveLine', { heat: live.heatLabel, arena: live.arenaName ? live.arenaName : t('shell.events.theArena') })}`;
}

/** The small tag on a list row: entries open. */
function Tags({ competition }: { competition: CompetitionPickerItem }) {
  const { t } = useLanguage();
  return competition.entriesOpen ? <span className="mg-tag mg-tag-ok">{t('shell.events.entriesOpen')}</span> : null;
}

type WarmHandlers = ReturnType<ReturnType<typeof useCompetitionPrefetch>['handlersFor']>;

function TodayCard({ competition, distance, selected, onChoose, warm }: { competition: CompetitionPickerItem; distance: string; selected: boolean; onChoose: () => void; warm: WarmHandlers }) {
  const { t } = useLanguage();
  const details = [competition.location?.trim(), competitionDateText(competition.startDate, competition.endDate), distance].filter(Boolean).join(' · ');
  return (
    <div className={`mg-card flex flex-col gap-1.5 !rounded-[10px] py-3.5 pl-3.5 pr-3 ${competition.live ? 'shadow-[inset_3px_0_0_rgb(var(--mg-red))]' : ''}`}>
      <span className="flex min-w-0 items-center gap-2">
        {competition.live && <span className="mg-badge mg-badge-live !h-5 !rounded-[4px] !px-[7px] text-[11px] font-bold tracking-[0.06em]">{t('shell.events.liveBadge')}</span>}
        <strong className="min-w-0 flex-1 break-words text-lg font-bold leading-tight">{competition.name}</strong>
      </span>
      {details && <span className="mg-meta">{details}</span>}
      {competition.live && <span className="text-[15px]">{liveLine(competition.live, t)}</span>}
      <button aria-pressed={selected} onClick={onChoose} {...warm} className="sp-pill sp-pill-fill mt-1.5 self-start">
        {t('shell.events.open')}<span className="sr-only">: {competition.name}</span>
      </button>
    </div>
  );
}

function CompetitionRow({ competition, past, distance, selected, onChoose, warm }: { competition: CompetitionPickerItem; past: boolean; distance: string; selected: boolean; onChoose: () => void; warm: WarmHandlers }) {
  const { t, locale } = useLanguage();
  const start = new Date(competition.startDate);
  const venue = competition.location?.trim();
  const multiDay = !!competition.endDate && competitionDateText(competition.startDate, competition.endDate) !== competitionDateText(competition.startDate, null);
  const when = past || multiDay || !venue ? competitionDateText(competition.startDate, competition.endDate, past) : null;
  return (
    <button aria-pressed={selected} onClick={onChoose} {...warm} className={`mg-line grid-cols-[44px_minmax(0,1fr)_14px] !min-h-[60px] !gap-x-3 !py-2 ${selected ? 'shadow-[inset_4px_0_0_rgb(var(--mg-heading))]' : ''}`}>
      <span aria-hidden="true" className="flex flex-col items-center gap-0.5 text-[rgb(var(--mg-heading))]">
        <span className="mg-display text-[22px] font-bold leading-none">{Number.isNaN(start.getTime()) ? '–' : start.getDate()}</span>
        <span className="text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-[rgb(var(--mg-muted))]">{Number.isNaN(start.getTime()) ? '' : start.toLocaleDateString(locale, { month: 'short' })}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="mg-line-title min-w-0 !font-semibold">{competition.name}</strong>
          {competitionIcon(competition.icon).id !== 'flag' && <CompetitionIcon id={competition.icon} labelled className="shrink-0 text-base" />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[rgb(var(--mg-muted))]">
          <span className="min-w-0 truncate">{[when, venue, distance].filter(Boolean).join(' · ')}</span>
          <Tags competition={competition} />
        </span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
      {selected && <span className="sr-only">{t('shell.events.current')}</span>}
    </button>
  );
}
