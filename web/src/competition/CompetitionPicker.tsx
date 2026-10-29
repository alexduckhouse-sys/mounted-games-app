import { useCompetitionPrefetch } from '../hooks/useCompetitionPrefetch';
import { usePageWidth } from '../components/pageWidthState';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Clock, SlidersHorizontal, X } from 'lucide-react';
import { Notice } from '../components/Notice';
import { PageProblem } from '../components/PageProblem';
import { api } from '../api';
import type { CompetitionPickerItem, CompetitionPickerPage } from '../types';
import { useCurrentCompetition } from './CurrentCompetitionContext';
import { CompetitionIcon } from './CompetitionIcon';
import { competitionDateText, isOnToday } from '../lib/competitionDates';
import { displaySectionName } from '../lib/section';
import { lastUpdatedText, readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, shouldNoticeSavedCopy, writeSavedCopy } from '../offline/savedCopies';
import { CompetitionListSkeleton } from '../components/Skeletons';
import { usePageHeader } from '../components/CompactPageBarContext';
import { useAuth } from '../auth/AuthContext';
import { Sheet } from '../components/Sheet';
import { useDockAction } from '../components/TickerContext';
import { RoundSearch } from '../components/RoundSearch';
import { RefineSwitchRow } from '../pages/refine/Refine';
import { useLanguage } from '../i18n/LanguageContext';
import type { Translate } from '../i18n/translate';
import '../components/sitePages.css';
import '../components/filterKit.css';
import './CompetitionPicker.css';

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
  const { t, locale } = useLanguage();
  const headingId = useId();
  const { current, setCurrent } = useCurrentCompetition();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
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
    // Upcoming events come soonest first, the same list for everyone.
    api.get<CompetitionPickerPage>(mineOnly ? '/competitions/picker/mine' : '/competitions/picker', { params: { past, page, ...filters }, signal: controller.signal })
      .then(({ data, headers }) => {
        if (controller.signal.aborted) return;
        const fallback = mineOnly ? null : serviceWorkerSavedAt(headers as never);
        if (unfiltered && page === 1 && fallback === null) writeSavedCopy(savedCopyKeys.picker(past), data);
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
          };
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous,
          ...(previous.key !== filterKey ? { items: [], savedCopy: false, savedAt: null, hasMore: false } : {}), key: filterKey, page, error: true }));
      });
    return () => controller.abort();
  }, [past, page, saved, filterKey, yearFilter, locationFilter, serverSearch, mineOnly, unfiltered, refresh]);

  const filterCount = (yearFilter !== 'all' ? 1 : 0) + (locationFilter !== 'all' ? 1 : 0) + (mineOnly ? 1 : 0);
  // On the archive the filters open from the button beside the ticker dock; the inline button stays when there is no dock.
  const archiveFiltersLabel = t('shell.events.archiveFilters');
  const docked = useDockAction(past ? { label: archiveFiltersLabel, icon: 'filters', count: filterCount, onClick: () => setSheetOpen(true) } : null);
  const items = state.key === filterKey ? state.items : [];
  const matches = items;
  const years = state.years;
  const locations = state.locations;
  const now = new Date();
  const onToday = past ? [] : matches.filter((item) => isOnToday(item.startDate, item.endDate, now));
  const later = matches.filter((item) => !onToday.includes(item));
  // Pointing at or pressing a competition starts loading it, so it opens straight away on a slow connection.
  const { handlersFor } = useCompetitionPrefetch();
  const choose = (competition: CompetitionPickerItem) => {
    setCurrent({ id: competition.id, name: competition.name });
    navigate(`/competitions/${competition.id}`);
  };
  // The archive is grouped by year, newest first as the server sends it; upcoming events by month, soonest first,
  // with the year only when it isn't this one.
  const headingFor = (startDate: string) => {
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return past ? t('shell.events.earlier') : t('shell.events.comingUp');
    if (past) return String(start.getFullYear());
    return start.toLocaleDateString(locale, start.getFullYear() === now.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
  };
  const groups = later.reduce<{ heading: string; items: CompetitionPickerItem[] }[]>((all, item) => {
    const heading = headingFor(item.startDate);
    const last = all[all.length - 1];
    if (last?.heading === heading) last.items.push(item); else all.push({ heading, items: [item] });
    return all;
  }, []);
  const groupList = groups.map((group) => {
    const rows = (
      <div className="cp-list">
        {group.items.map((competition) => <CompetitionRow key={competition.id} competition={competition} past={past} selected={current?.id === competition.id} onChoose={() => choose(competition)} warm={handlersFor(competition.id)} />)}
      </div>
    );
    return past ? (
      <section key={group.heading} className="cp-enter" aria-label={group.heading}>
        <h2 className="cp-heading">{group.heading}{!(state.hasMore && group === groups[groups.length - 1]) && <small>{t('shell.events.yearCount', { count: group.items.length })}</small>}</h2>
        {rows}
      </section>
    ) : (
      <div key={group.heading} className="cp-group">
        <h3 className="cp-heading">{group.heading}</h3>
        {rows}
      </div>
    );
  });
  return (
    <section className="mg-font mx-auto flex w-full max-w-xl flex-col gap-3.5 pb-5 lg:max-w-none" aria-labelledby={headingId}>
      <PlainHeader past={past} />
      <h1 id={headingId} className="sr-only">{past ? t('shell.events.titlePast') : t('shell.events.title')}</h1>
      {past && (
        <div className="mg-band mg-band-header py-3">
          <div className="fk-find fk-band">
            <RoundSearch band label={t('shell.events.search')} placeholder={t('shell.events.searchPlaceholder')} value={search} onChange={(text) => { setSearch(text); setPage(1); }} />
            {!docked && <button type="button" className="fk-fbtn" aria-label={filterCount ? `${t('shell.events.archiveFilters')}, ${filterCount} set` : t('shell.events.archiveFilters')} onClick={() => setSheetOpen(true)}>
              <SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
              {filterCount > 0 && <span className="fk-count" aria-hidden="true">{filterCount}</span>}
            </button>}
          </div>
        </div>
      )}
      {past && filterCount > 0 && (
        <div className="fk-chips" role="group" aria-label={t('shell.events.archiveFilters')}>
          {yearFilter !== 'all' && <button type="button" className="fk-chip" aria-label={`Remove ${yearFilter}`} onClick={() => { setYearFilter('all'); setPage(1); }}>{yearFilter}<X aria-hidden="true" size={15} strokeWidth={2.2} /></button>}
          {locationFilter !== 'all' && <button type="button" className="fk-chip" aria-label={`Remove ${locationFilter}`} onClick={() => { setLocationFilter('all'); setPage(1); }}>{locationFilter}<X aria-hidden="true" size={15} strokeWidth={2.2} /></button>}
          {mineOnly && <button type="button" className="fk-chip" aria-label={`Remove ${t('shell.events.mine')}`} onClick={() => { setMineOnly(false); setPage(1); }}>{t('shell.events.mine')}<X aria-hidden="true" size={15} strokeWidth={2.2} /></button>}
        </div>
      )}
      {!mineOnly && state.savedCopy && !loading && shouldNoticeSavedCopy(state.savedAt, true, now) && <Notice tone="info" icon={Clock}>{t('shell.events.refreshWhenOnline', { updated: lastUpdatedText(state.savedAt, now) })}</Notice>}
      <div className={`cp-stack ${onToday.length > 0 ? 'cp-split' : ''}`} aria-busy={loading}>
        {onToday.length > 0 && (
          <section className="cp-enter cp-today" aria-label={t('shell.events.onToday')}>
            <h2 className="sr-only">{t('shell.events.onToday')}</h2>
            {onToday.map((competition) => <TodayCard key={competition.id} competition={competition} selected={current?.id === competition.id} onChoose={() => choose(competition)} warm={handlersFor(competition.id)} />)}
          </section>
        )}
        {later.length > 0 && (past ? groupList : (
          <section className="cp-enter" aria-label={t('shell.events.comingUp')}>
            <h2 className="sr-only">{t('shell.events.comingUp')}</h2>
            {groupList}
          </section>
        ))}
        {loading && state.items.length === 0 && <CompetitionListSkeleton />}
        {!loading && state.error && <PageProblem title={t('shell.events.loadFailed')} primaryLabel={t('common.tryAgain')} onPrimary={onRetry}>{t('shell.events.checkSignal')}</PageProblem>}
        {!loading && !state.error && state.items.length === 0 && <p className="mg-card p-4">{!unfiltered ? t('shell.events.noMatchFilters') : past ? t('shell.events.nonePast') : t('shell.events.noneYet')}</p>}
        {!loading && !state.error && state.hasMore && <button className="mg-btn mg-btn-secondary w-full" onClick={() => setPage((value) => value + 1)}>{t('shell.events.loadMore')}</button>}
        {!past && <p className="cp-more"><Link to="/competitions/past" className="sp-link cp-past">{t('shell.events.titlePast')}<ChevronRight aria-hidden="true" className="h-4 w-4 cp-chevron" /></Link></p>}
      </div>
      {past && sheetOpen && (
        <Sheet title={t('shell.events.archiveFilters')} className="fk-sheet" onClose={() => setSheetOpen(false)}>
          {({ close }) => (
            <>
              {years.length > 0 && (
                <div className="fk-group" role="group" aria-label={t('shell.events.year')}>
                  <span className="fk-label" aria-hidden="true">{t('shell.events.year')}</span>
                  <div className="fk-pills">
                    {['all', ...years.map(String)].map((value) => (
                      <button key={value} type="button" className="fk-pill" aria-pressed={yearFilter === value} onClick={() => { setYearFilter(value); setPage(1); }}>{value === 'all' ? t('shell.events.allYears') : value}</button>
                    ))}
                  </div>
                </div>
              )}
              {locations.length > 0 && (
                <div className="fk-group" role="group" aria-label={t('shell.events.location')}>
                  <span className="fk-label" aria-hidden="true">{t('shell.events.location')}</span>
                  <div className="fk-pills">
                    {['all', ...locations].map((value) => (
                      <button key={value} type="button" className="fk-pill" aria-pressed={locationFilter === value} onClick={() => { setLocationFilter(value); setPage(1); }}>{value === 'all' ? t('shell.events.allLocations') : value}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="sp-card">
                <RefineSwitchRow label={t('shell.events.mine')} on={mineOnly} disabled={!user} onChange={(next) => { setMineOnly(next); setPage(1); }} />
              </div>
              {!user && <p className="sp-note m-0">{t('shell.events.signInForClub')}</p>}
              <button type="button" className="kit-pill kit-pill-fill fk-show" onClick={() => close()}>Done</button>
            </>
          )}
        </Sheet>
      )}
    </section>
  );
}

/** What is on, then where: "Heat 2 on now" over "Open · Arena 2". The second line is left out when neither is known. */
function liveParts(live: NonNullable<CompetitionPickerItem['live']>, t: Translate) {
  const place = [displaySectionName(live.sectionName), live.arenaName?.trim()].filter(Boolean).join(' · ');
  return { heat: t('shell.events.liveHeat', { heat: live.heatLabel }), place };
}

function LiveLines({ text }: { text: string }) {
  const [heat, place] = text.split('\n');
  return <><span className="cp-live-heat">{heat}</span>{place && <span className="cp-live-place">{place}</span>}</>;
}

/** The live line: the heat on now, and under it the section and arena. When they change, the old words fade out over
    the new ones fading in, in the same spot. */
export function LiveText({ heat, place }: { heat: string; place?: string }) {
  const text = place ? `${heat}\n${place}` : heat;
  const [shown, setShown] = useState(text);
  const [previous, setPrevious] = useState<string | null>(null);
  if (text !== shown) {
    setPrevious(shown);
    setShown(text);
  }
  // The fade lasts 200ms; the old words go just after (and at once to the eye with reduced motion, which hides them).
  useEffect(() => {
    if (previous === null) return undefined;
    const timer = window.setTimeout(() => setPrevious(null), 220);
    return () => window.clearTimeout(timer);
  }, [previous]);
  return (
    <span className="cp-swap">
      {previous !== null && <span key={`out-${previous}`} aria-hidden="true" className="cp-swap-out"><LiveLines text={previous} /></span>}
      <span key={shown} className={previous !== null ? 'cp-swap-in' : undefined}><LiveLines text={shown} /></span>
    </span>
  );
}

type WarmHandlers = ReturnType<ReturnType<typeof useCompetitionPrefetch>['handlersFor']>;

function TodayCard({ competition, selected, onChoose, warm }: { competition: CompetitionPickerItem; selected: boolean; onChoose: () => void; warm: WarmHandlers }) {
  const { t } = useLanguage();
  const details = [competition.location?.trim(), competitionDateText(competition.startDate, competition.endDate)].filter(Boolean).join(' · ');
  return (
    <div className="cp-now">
      <span className="cp-now-top">
        {competition.live
          ? <span className="mg-badge mg-badge-live cp-now-badge !h-5 !rounded-[4px] !px-[7px] text-[11px] font-bold tracking-[0.06em]">{t('shell.events.liveBadge')}</span>
          : <span className="cp-now-tag">{t('shell.events.onToday')}</span>}
        <CompetitionIcon id={competition.icon} labelled className="text-[18px]" />
      </span>
      <strong className="cp-now-name">{competition.name}</strong>
      {details && <span className="cp-now-meta">{details}</span>}
      {competition.live && <span className="cp-now-line"><LiveText {...liveParts(competition.live, t)} /></span>}
      <button aria-pressed={selected} onClick={onChoose} {...warm} className="cp-now-open">
        {t('shell.events.open')}<span className="sr-only">: {competition.name}</span>
      </button>
    </div>
  );
}

function CompetitionRow({ competition, past, selected, onChoose, warm }: { competition: CompetitionPickerItem; past: boolean; selected: boolean; onChoose: () => void; warm: WarmHandlers }) {
  const { t, locale } = useLanguage();
  const start = new Date(competition.startDate);
  return (
    <button aria-pressed={selected} onClick={onChoose} {...warm} className={`cp-row ${selected ? 'cp-row-current' : ''}`}>
      {/* Upcoming events sit under a month heading, so the date shows the weekday; the archive is by year, so it shows the month. */}
      <span aria-hidden="true" className="cp-date">
        <span className="cp-dow">{Number.isNaN(start.getTime()) ? '' : start.toLocaleDateString(locale, past ? { month: 'short' } : { weekday: 'short' })}</span>
        <span className="cp-day">{Number.isNaN(start.getTime()) ? '–' : start.getDate()}</span>
      </span>
      <span className="cp-body">
        <strong className="cp-title">{competition.name}</strong>
        {/* The list stays a plain directory: venue, end date and entry status are inside the competition. The date column
            is hidden from screen readers, so they get the full dates here. */}
        <span className="sr-only">{competitionDateText(competition.startDate, competition.endDate, past)}</span>
      </span>
      {/* Flags have a column of their own, so they line up down the list whatever the name's length. */}
      <span className="cp-icon">
        <CompetitionIcon id={competition.icon} labelled className="text-[16px]" />
      </span>
      <ChevronRight className="h-3.5 w-3.5 cp-chevron" aria-hidden="true" />
      {selected && <span className="sr-only">{t('shell.events.current')}</span>}
    </button>
  );
}
