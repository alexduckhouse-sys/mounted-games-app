import { Dropdown } from '../../components/Dropdown';
import { displaySectionName } from '../../lib/section';
import { TimetableBoard } from './TimetableBoard';
import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { RaceListPicker } from '../../components/RacePicker';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { CompetitionDetail, StandingRow } from '../../types';
import type { FinalsBoundary } from '../../lib/tieBreak';
import { buildToplist, finalLineups, sectionScoreVersion } from '../../lib/toplist';
import { timetableRows } from '../../lib/timetableRows';
import { computeTimings } from '../../lib/time';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { ToplistView, type ToplistViewTab } from './ToplistView';
import { TackLeaderboard } from './TackLeaderboard';
import { HeatScores } from './HeatScores';
import { ToplistRowsSkeleton } from '../../components/Skeletons';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { SponsorStrip } from '../../components/SponsorStrip';
import { readSavedCopy, SAVED_STANDINGS_NOTICE_MS, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../../offline/savedCopies';
import { NumberField } from '../../components/NumberField';
import { Notice } from '../../components/Notice';
import { PageGrid } from '../../components/PageGrid';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { formatPoints } from '../../lib/formatPoints';
import { ProvisionalBadge } from '../../components/ProvisionalStatus';
import { useProvisionalState } from '../../hooks/useProvisionalState';
import { useHeldFor } from '../../hooks/useHeldFor';
import { getSectionProvisionalState } from '../../lib/provisionalResults';
import { useT } from '../../i18n/LanguageContext';

/** The three tabs of the age group page: the draw (Heats), the heat tables (Scores) and the Toplist. */
export type SectionSubTab = 'draw' | 'scores' | 'toplist';

const NO_ROWS: StandingRow[] = [];
const TOPLIST_VIEW_PREF_KEY = 'mg.prefs.toplistView';
const DEFAULT_AGE_GROUP_PREF_KEY = 'mg.prefs.defaultAgeGroup';
const VALID_TOPLIST_VIEWS = new Set<ToplistViewTab>(['finals', 'totals', 'sessions', 'heats', 'lineups', 'times']);

function readPreferredToplistView(): ToplistViewTab | null {
  try {
    const raw = localStorage.getItem(TOPLIST_VIEW_PREF_KEY)?.trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'total') return 'totals';
    return VALID_TOPLIST_VIEWS.has(raw as ToplistViewTab) ? (raw as ToplistViewTab) : null;
  } catch {
    return null;
  }
}

function defaultSectionId(competition: CompetitionDetail): number | null {
  if (competition.sections.length === 0) return null;
  const validSectionIds = new Set(competition.sections.map((s) => s.id));
  try {
    const rawFavs: unknown = JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]');
    if (Array.isArray(rawFavs)) {
      const followedTeamIds = new Set<number>();
      for (const item of rawFavs) {
        if (typeof item === 'number') {
          followedTeamIds.add(item);
        } else if (item && typeof item === 'object') {
          const entry = item as { competitionId?: number; teamId?: number };
          if ((entry.competitionId == null || entry.competitionId === competition.id) && typeof entry.teamId === 'number') {
            followedTeamIds.add(entry.teamId);
          }
        }
      }
      const followedTeam = competition.teams.find((t) => followedTeamIds.has(t.id) && validSectionIds.has(t.competitionSectionId));
      if (followedTeam) return followedTeam.competitionSectionId;
    }
  } catch { /* ignore invalid storage */ }

  try {
    const preferredAgeGroup = localStorage.getItem(DEFAULT_AGE_GROUP_PREF_KEY)?.trim().toLowerCase();
    if (preferredAgeGroup) {
      const matched = competition.sections.find(
        (s) => s.displayName.trim().toLowerCase() === preferredAgeGroup
          || displaySectionName(s.displayName).trim().toLowerCase() === preferredAgeGroup
          || s.ageGroup?.trim().toLowerCase() === preferredAgeGroup,
      );
      if (matched) return matched.id;
    }
  } catch { /* ignore invalid storage */ }

  const populatedSection = competition.sections.find(
    (s) =>
      competition.teams.some((t) => t.competitionSectionId === s.id)
      || competition.sessions.some((sess) => sess.competitionSectionId === s.id && sess.heats.length > 0),
  );
  return populatedSection?.id ?? competition.sections[0]?.id ?? null;
}

/** Puts the page's title and refresh button in the app header while the Scores or Toplist tab is showing. (The Heats tab's timetable sets its own.) */
function TabHeader({ title, subtitle, refreshLabel, onRefresh }: { title: string; subtitle: string; refreshLabel: string; onRefresh: () => void }) {
  usePageHeader({ title, subtitle, onRefresh, refreshLabel });
  return null;
}

/** The age group menu, in the header band. */
function AgeGroupSelect({ sections, value, teamCount, seamless = false, onChange }: { sections: { id: number; displayName: string }[]; value: number | null; teamCount: number; seamless?: boolean; onChange: (id: number) => void }) {
  const t = useT();
  const current = sections.find((s) => s.id === value);
  const options = sections.map((sec) => ({ value: String(sec.id), label: displaySectionName(sec.displayName) }));
  return (
    <div className={`mg-band-header pt-0 ${seamless ? 'pb-1.5' : 'pb-3'}`}>
      <Dropdown label={t('competition.timetable.ageGroup')} value={value == null ? '' : String(value)} options={options} onChange={(id) => onChange(Number(id))} buttonClassName="relative flex h-7 w-full items-center gap-2 rounded-lg border-0 bg-white/[.07] pl-3 pr-2 text-left before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        <span className="min-w-0 truncate text-[15px] font-semibold leading-none">{displaySectionName(current?.displayName)}</span>
        <span aria-hidden="true" className="h-[3px] w-[3px] shrink-0 rounded-full bg-[rgb(var(--mg-header-sub))]" />
        <span className="flex-1 text-[13px] font-medium leading-none text-[rgb(var(--mg-header-sub))]">{t('competition.scoring.teamCount', { count: teamCount })}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
      </Dropdown>
    </div>
  );
}

/** Laptop version of the age group menu: every age group listed down the left, with its team count. */
function AgeGroupRail({ sections, teams, value, onChange }: {
  sections: { id: number; displayName: string }[];
  teams: { competitionSectionId: number; isHorsConcours?: boolean }[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const t = useT();
  return (
    <nav aria-label={t('competition.scoring.ageGroups')} className="mg-card overflow-hidden">
      <h2 className="mg-display border-b-2 border-[rgb(var(--mg-heading))] px-3 py-2 text-[15px] font-bold uppercase tracking-[0.05em] text-[rgb(var(--mg-heading))]">{t('competition.scoring.ageGroups')}</h2>
      <ul className="m-0 list-none p-0">
        {sections.map((sec) => {
          const count = teams.filter((t) => t.competitionSectionId === sec.id && !t.isHorsConcours).length;
          const on = sec.id === value;
          return (
            <li key={sec.id} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
              <button type="button" aria-current={on ? 'true' : undefined} onClick={() => onChange(sec.id)}
                className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-[15px] ${on ? 'bg-[rgb(var(--mg-tint))] font-bold text-[rgb(var(--mg-heading))]' : 'font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}`}>
                <span className="min-w-0 flex-1 truncate">{displaySectionName(sec.displayName)}</span>
                <span className="shrink-0 text-xs text-[rgb(var(--mg-muted))]">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * One page per age group: the navy age group bar, then three tabs. Heats is the draw, Scores holds the heat tables
 * and Toplist the standings. The menu opens it on Heats (`startOn`). The Toplists bottom tab shows the toplist alone,
 * with no tab row: its Show sheet (beside the ticker dock) offers the heat scores as "Scores by heat".
 */
export function ScoringTab({ startOn = 'draw' }: { startOn?: SectionSubTab }) {
  const t = useT();
  const { competition, reload } = useCompetition();
  const { canManage } = useAuth();
  usePageWidth('wide');
  const desktop = useIsDesktop();
  // The age group lives in the URL (?section=ID) so the menu can link straight to one.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = Number(searchParams.get('section'));
  const sectionId = competition.sections.find((s) => s.id === requestedSection)?.id ?? defaultSectionId(competition);
  const [subTab, setSubTab] = useState<SectionSubTab>(startOn);
  const [showFinals, setShowFinals] = useState(false);
  const [chosenView, setChosenView] = useState<ToplistViewTab | null>(readPreferredToplistView);
  const chooseView = (view: ToplistViewTab) => {
    setChosenView(view);
    try { localStorage.setItem(TOPLIST_VIEW_PREF_KEY, view); } catch { /* storage blocked */ }
  };

  const [retry, setRetry] = useState(0);
  const scoreVersion = useMemo(() => sectionScoreVersion(competition.sessions, sectionId), [competition.sessions, sectionId]);
  // Team/section refreshes also invalidate HC, withdrawal, bonus and tie-rule information.
  const refreshSource = useMemo(() => ({ competitionId: competition.id, scoreVersion, teams: competition.teams, sections: competition.sections }),
    [competition.id, scoreVersion, competition.teams, competition.sections]);
  const [standingsBySection, setStandingsBySection] = useState<Record<number, { source: typeof refreshSource; rows: StandingRow[]; error: boolean; savedCopy: boolean }>>({});
  // While the first answer for this age group is on its way, show the copy this phone saved last time.
  const savedStandings = useMemo(
    () => (sectionId == null ? null : readSavedCopy<StandingRow[]>(savedCopyKeys.standings(competition.id, sectionId))),
    [competition.id, sectionId],
  );
  const currentResult = sectionId == null ? null : standingsBySection[sectionId] ?? null;
  const standingsError = currentResult?.error === true;
  // Official totals include cross-section results, tack bonuses and organiser tie decisions.
  // Keep the last official response while refreshing; session sums cannot reproduce those rules.
  const standings = !standingsError && currentResult ? currentResult.rows : savedStandings?.data ?? NO_ROWS;
  const standingsStale = currentResult ? currentResult.savedCopy || currentResult.source !== refreshSource : savedStandings != null;
  const standingsLoading = sectionId != null && !currentResult && !savedStandings && standings.length === 0;
  // Old standings are on screen for a moment on every refresh; only say so if it lasts half a minute.
  const showSavedNotice = useHeldFor(standingsStale, SAVED_STANDINGS_NOTICE_MS);
  // Whether this age group's finished results are still open to queries, held for a review, or official.
  const provisional = useProvisionalState((now) => getSectionProvisionalState(competition.sessions, sectionId, now));
  useEffect(() => {
    if (sectionId == null) return;
    let cancelled = false;
    const key = savedCopyKeys.standings(competition.id, sectionId);
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then((r) => {
        if (cancelled) return;
        const fallback = serviceWorkerSavedAt(r.headers);
        if (fallback === null) writeSavedCopy(key, r.data);
        // The service worker's fallback can be older than what this page saved from a later visit.
        const local = fallback === null ? null : readSavedCopy<StandingRow[]>(key);
        const preferLocal = local != null && (fallback === 'unknown' || Date.parse(local.savedAt) >= (fallback as Date).getTime());
        const rows = preferLocal ? local.data : r.data;
        setStandingsBySection((prev) => ({
          ...prev,
          [sectionId]: { source: refreshSource, rows, error: false, savedCopy: fallback !== null },
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setStandingsBySection((prev) => {
          const existing = prev[sectionId];
          // A failed refresh keeps the list on screen rather than blanking it.
          if (existing && !existing.error) {
            return { ...prev, [sectionId]: { ...existing, savedCopy: true } };
          }
          const local = readSavedCopy<StandingRow[]>(key);
          const entry = local
            ? { source: refreshSource, rows: local.data, error: false, savedCopy: true }
            : { source: refreshSource, rows: [], error: true, savedCopy: false };
          return { ...prev, [sectionId]: entry };
        });
      });
    return () => { cancelled = true; };
  }, [competition.id, sectionId, refreshSource, retry]);

  const section = competition.sections.find((s) => s.id === sectionId) ?? null;
  const sectionName = displaySectionName(section?.displayName);
  const list = useMemo(
    () => buildToplist(standings, competition.sessions, competition.teams, sectionId ?? -1, section?.finalistCount),
    [standings, competition.sessions, competition.teams, sectionId, section?.finalistCount],
  );
  const progress = list.sessionsTotal === 0 ? null
    : list.sessionsDone === list.sessionsTotal ? (list.sessionsTotal === 1 ? t('competition.scoring.afterOne') : t('competition.scoring.afterAll', { n: list.sessionsTotal }))
    : list.sessionsDone > 0 ? t('competition.scoring.afterSome', { done: list.sessionsDone, total: list.sessionsTotal }) : null;
  const chooseSection = (id: number) => setSearchParams({ section: String(id) }, { replace: true });
  const sectionSessions = useMemo(
    () => competition.sessions
      .filter((s) => s.competitionSectionId === sectionId && (s.kind ?? (s.isBreak ? 1 : 0)) === 0)
      .sort((a, b) => a.orderIndex - b.orderIndex),
    [competition.sessions, sectionId],
  );
  // "Finals": the teams drawn into each final, names only. "Times": the age group's planned heat times, in time order.
  const lineups = useMemo(() => finalLineups(competition.sessions, competition.teams, sectionId ?? -1), [competition.sessions, competition.teams, sectionId]);
  const times = useMemo(() => {
    const ids = new Set(sectionSessions.map((s) => s.id));
    return timetableRows(competition.sessions, computeTimings(competition.sessions), true)
      .filter((row) => ids.has(row.session.id))
      .sort((a, b) => (a.scheduled?.getTime() ?? Infinity) - (b.scheduled?.getTime() ?? Infinity) || a.session.orderIndex - b.session.orderIndex || a.heatIndex - b.heatIndex);
  }, [competition.sessions, sectionSessions]);
  const notices = (
    <>
      {standingsLoading && !savedStandings && <ToplistRowsSkeleton />}
      {showSavedNotice && <Notice tone="info">{t('competition.scoring.savedStandings')}</Notice>}
      {standingsError && <Notice actionLabel={t('common.tryAgain')} onAction={() => { if (sectionId != null) setStandingsBySection((prev) => { const next = { ...prev }; delete next[sectionId]; return next; }); setRetry((n) => n + 1); }}>{t('competition.scoring.loadFailed')}</Notice>}
      {sectionId != null && !standingsLoading && !standingsError && standings.length === 0 && lineups.length === 0 && times.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">{t('competition.scoring.noResults')}</p>}
    </>
  );
  const sectionLabel = `${t('competition.scoring.toplist')}${sectionName ? `, ${sectionName}` : ''}`;
  const teamCount = competition.teams.filter((t) => t.competitionSectionId === sectionId && !t.isHorsConcours).length;
  const rail = desktop && competition.sections.length > 1
    ? <AgeGroupRail sections={competition.sections} teams={competition.teams} value={sectionId} onChange={chooseSection} /> : null;
  // Finals are due once every session in the age group is done. The PA desk, TV kiosk and QR codes are in the menu.
  const finalsDue = list.sessionsTotal > 0 && list.sessionsDone === list.sessionsTotal;
  const finalsButton = canManage(competition) && sectionId != null && finalsDue && (
    <button type="button" onClick={() => setShowFinals(true)} className="mg-card flex min-h-14 w-full items-center gap-3 px-4 text-left">
      <span className="flex-1 font-semibold text-[rgb(var(--mg-heading))]">Create finals</span>
      <ChevronRight className="h-[18px] w-[18px] text-[rgb(var(--mg-muted))]" aria-hidden="true" />
    </button>
  );
  const finalsModal = (
    <>
      {showFinals && sectionId != null && (
        <FinalsModal
          sectionId={sectionId}
          onClose={() => setShowFinals(false)}
          onCreated={() => { setShowFinals(false); reload(); }}
        />
      )}
    </>
  );

  // The Toplists page is the toplist alone: only the age group stays in the navy band, and "Scores by heat" is in its
  // Show sheet. The age group page from the menu keeps its Heats · Scores · Toplist row.
  const showTabs = startOn !== 'toplist';
  const ageGroups = !rail && competition.sections.length > 1 && <AgeGroupSelect sections={competition.sections} value={sectionId} teamCount={teamCount} seamless={showTabs} onChange={chooseSection} />;
  if (sectionId == null) {
    const empty = (
      <div className={`mx-auto flex w-full flex-col ${rail ? '' : 'max-w-[560px] lg:max-w-3xl'}`}>
        <h1 className="mg-h1 mg-h1-sm py-3">{t('competition.scoring.ageGroups')}</h1>
        {ageGroups}
        <p className="mg-card mt-3 p-4 text-[rgb(var(--mg-muted))]">{t('competition.scoring.noAgeGroups')}</p>
        {finalsButton && <div className="pt-4">{finalsButton}</div>}
        {finalsModal}
      </div>
    );
    return rail ? <PageGrid variant="left" aside={rail} asideLabel={t('competition.scoring.ageGroups')} className="pt-3">{empty}</PageGrid> : empty;
  }

  // The Toplists page leads with Toplist; from the menu Heats comes first.
  const subTabs: [SectionSubTab, string][] = startOn === 'toplist'
    ? [['toplist', t('competition.scoring.toplist')], ['draw', t('competition.scoring.heats')], ['scores', t('competition.scoring.scores')]]
    : [['draw', t('competition.scoring.heats')], ['scores', t('competition.scoring.scores')], ['toplist', t('competition.scoring.toplist')]];
  // The tabs sit in the navy bar under the age group on phones; beside the age group rail on a laptop they are plain.
  const tabBar = showTabs && (
    <div className={rail ? 'pb-3' : 'mg-band-header pb-2.5 pt-1'}>
      <div className="mg-seg" role="group" aria-label={t('competition.scoring.viewGroup')}>
        {subTabs.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={subTab === id} onClick={() => setSubTab(id)}>{label}</button>
        ))}
      </div>
    </div>
  );
  // The navy band (age group, and the tabs where they show) stays pinned under the header as the page scrolls,
  // so the age group can be changed from anywhere down a long toplist.
  const band = (ageGroups || tabBar) ? <div className={rail ? '' : 'sticky top-[var(--mg-shell-h,0px)] z-20'}>{ageGroups}{tabBar}</div> : null;

  const scores = (
    <div className="flex flex-col gap-4 pt-3" role="region" aria-label={t('competition.scoring.heatScoresRegion')}>
      {sectionSessions.flatMap((s) => {
        const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
        if (heats.length === 0) return [];
        const isRaceFinals = heats.some((h) => Boolean(h.raceRoundStage) && h.raceRoundId != null);
        if (isRaceFinals) {
          return [<HeatScores key={`session-${s.id}`} session={s} heats={heats} activeHeatId={heats[0].id} embedded />];
        }
        return heats.map((h) => (
          <HeatScores key={`heat-${h.id}`} session={s} heats={heats} activeHeatId={h.id} embedded />
        ));
      })}
      {sectionSessions.every((s) => s.heats.length === 0) && (
        <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">{t('competition.scoring.noHeats')}</p>
      )}
    </div>
  );

  const toplist = (
    // One 12px gap above and between the notices, the provisional pill and the list, so the spaces never add up.
    // The toplist leaves out the "Official" pill (official is the normal state); provisional and review warnings stay.
    <section aria-label={sectionLabel} className="flex flex-col gap-3 pt-3">
      <div className="flex flex-col gap-2.5 empty:hidden">{notices}</div>
      {standings.length > 0 && provisional && provisional.status !== 'official' && <div><ProvisionalBadge state={provisional} /></div>}
      {/* The rows fade in over the placeholder they replace, rather than popping in. */}
      {/* Before any standings the planned times and drawn finals still show; the toplist itself waits for results. */}
      {(standings.length > 0 || lineups.length > 0 || times.length > 0) && <div key={sectionId} className="mg-settle"><ToplistView list={list} section={section} competitionId={competition.id} teams={competition.teams} chosenView={chosenView} onChooseView={chooseView} heatTables={sectionSessions.some((s) => s.heats.length > 0) ? scores : undefined} finalLineups={lineups} times={times} /></div>}
      {sectionId != null && <div className="empty:hidden"><TackLeaderboard competitionId={competition.id} sectionId={sectionId} refresh={retry} /></div>}
    </section>
  );
  const board = subTab === 'draw' ? (
    <TimetableBoard sectionId={sectionId} title={sectionName || t('competition.timetable.ageGroup')} bandExtra={band} lead={finalsButton || undefined} />
  ) : (
    <div className={`mx-auto flex w-full flex-col ${rail ? '' : 'max-w-[560px] lg:max-w-3xl'}`}>
      {subTab === 'toplist'
        ? <TabHeader title={t('competition.scoring.toplist')} subtitle={[competition.name, progress].filter(Boolean).join(' · ')} refreshLabel={t('competition.scoring.refreshToplist')} onRefresh={() => setRetry((n) => n + 1)} />
        : <TabHeader title={sectionName || t('competition.timetable.ageGroup')} subtitle={competition.name} refreshLabel={t('competition.scoring.refreshScores')} onRefresh={reload} />}
      {band}
      {subTab === 'toplist' ? (
        <div className="flex flex-col gap-3">
          {toplist}
          <SponsorStrip placement="Results" />
          {finalsButton && <div className="pt-1">{finalsButton}</div>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {scores}
          {finalsButton}
        </div>
      )}
    </div>
  );

  return (
    <>
      {rail ? <PageGrid variant="left" aside={rail} asideLabel={t('competition.scoring.ageGroups')} className="pt-3">{board}</PageGrid> : board}
      {finalsModal}
    </>
  );
}

interface FinalsModalProps { sectionId: number; onClose: () => void; onCreated: () => void }

function FinalsModal({ sectionId, onClose, onCreated }: FinalsModalProps) {
  const { competition } = useCompetition();
  const [topN, setTopN] = useState(6);
  const [lanes, setLanes] = useState(6);
  const [name, setName] = useState('');
  // The finals session planned for this age group (made in the creator), if heats haven't been made in it yet: reusing it keeps its B and C race lists.
  const planned = competition.sessions.find((x) => x.competitionSectionId === sectionId && (x.kind ?? 0) === 0 && x.status === 0
    && x.heats.length === 0 && /^finals\s*·/i.test(x.name.trim()));
  // Lettered finals already on the timetable with nobody in them (an imported event): fill those from the toplist instead.
  const toFill = competition.sessions.find((x) => x.competitionSectionId === sectionId && (x.kind ?? 0) === 0 && x.status === 0
    && x.heats.length > 0 && x.heats.every((h) => /^[A-Z] Final$/i.test((h.label ?? '').trim()) && h.entries.length === 0));
  const fillLanes = toFill?.lanesPerHeat ?? 6;
  // Filled best first by letter (A, B, C), whatever order they run in.
  const fillNames = toFill ? toFill.heats.map((h) => (h.label ?? '').trim().replace(/^./, (c) => c.toUpperCase())).sort() : [];
  const [races, setRaces] = useState(planned?.plannedRaces?.length ? planned.plannedRaces.join('\n') : 'Litter Lifter\nFlag\nBottle\nMug\nBall and Cone');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);

  useEffect(() => {
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then((r) => setStandings(r.data))
      .catch(() => setStandings([]));
  }, [competition.id, sectionId]);

  const seats = toFill ? toFill.heats.length * fillLanes : topN;
  const boundaryLanes = toFill ? fillLanes : lanes;
  // The server says whether the cut at the last seat is settled (countback, last race or the organiser's order), not just level on points.
  // Loading until the answer for the current seats arrives; null if it couldn't be checked (then points alone decide, as before).
  const boundaryKey = `${competition.id}:${sectionId}:${seats}:${boundaryLanes}`;
  const [fetched, setFetched] = useState<{ key: string; data: FinalsBoundary | null } | null>(null);
  useEffect(() => {
    if (seats < 1) return;
    let cancelled = false;
    api.get<FinalsBoundary>(`/competitions/${competition.id}/finals/boundary`, { params: { topN: seats, sectionId, lanesPerHeat: boundaryLanes } })
      .then((r) => { if (!cancelled) setFetched({ key: boundaryKey, data: r.data ?? null }); })
      .catch(() => { if (!cancelled) setFetched({ key: boundaryKey, data: null }); });
    return () => { cancelled = true; };
  }, [competition.id, sectionId, seats, boundaryLanes, boundaryKey]);
  const boundary: FinalsBoundary | null | undefined = seats < 1 ? null : fetched?.key === boundaryKey ? fetched.data : undefined;
  const runoff = useMemo(() => {
    if (standings.length <= seats || boundary === undefined) return null;
    const cutoff = standings[seats - 1];
    const next = standings[seats];
    if (cutoff.totalPoints !== next.totalPoints) return null;
    if (boundary) {
      const cut = boundary.boundaries?.find((b) => b.cutoff === seats);
      if (!boundary.tied || (cut && cut.settled)) return null;
    }
    const tied = standings.filter((s) => s.totalPoints === cutoff.totalPoints);
    const seatsLeft = seats - standings.slice(0, seats).filter((s) => s.totalPoints > cutoff.totalPoints).length;
    return { tied, points: cutoff.totalPoints, seatsLeft };
  }, [standings, seats, boundary]);

  async function fill() {
    if (!toFill) return;
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/sessions/${toFill.id}/populate-finals`);
      onCreated();
    } catch (e) {
      const m = (e as { response?: { data?: string | { message?: string } } }).response?.data;
      const text = typeof m === 'string' ? m : m?.message;
      setErr(text || 'Couldn’t fill the finals. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setErr(null);
    const raceNames = races.split('\n').map((r) => r.trim()).filter(Boolean);
    if (raceNames.length === 0) { setErr('Add at least one race.'); return; }
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/finals`, {
        competitionSectionId: sectionId,
        topN, raceNames, lanesPerHeat: lanes, name: name.trim() || null,
        ...(planned ? { existingSessionId: planned.id } : {}),
      });
      onCreated();
    } catch (e) {
      const m = (e as { response?: { data?: string } }).response?.data;
      setErr(typeof m === 'string' ? m : 'Couldn’t create the finals. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Create finals" onClose={onClose}>
      {({ close }) => (
        <>
        <div className="flex flex-col gap-3">
          {toFill ? (
            <p className="text-sm">
              The {listNames(fillNames)} {fillNames.length === 1 ? 'is' : 'are'} already on the timetable. Teams go in from the toplist,
              up to {fillLanes} in each, best first into the {fillNames[0]}.
            </p>
          ) : (<>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">Teams in the A final</span>
              <NumberField  min={1} max={50} className="input mt-1 text-sm"
                value={topN} onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Lanes per heat</span>
              <NumberField  min={1} max={20} className="input mt-1 text-sm"
                value={lanes} onChange={(e) => setLanes(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold">Session name (optional)</span>
            <input className="input mt-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="block">
            <RaceListPicker
              label="Races"
              ariaLabel="Races"
              races={races.split('\n').map((r) => r.trim()).filter(Boolean)}
              onChange={(next) => setRaces(next.join('\n'))}
            />
          </div>
          </>)}

          {runoff && (
            <Notice>
              Runoff needed: {runoff.tied.length} teams tied on {formatPoints(runoff.points)} pts at position {topN}, with only {runoff.seatsLeft}{' '}
              {runoff.seatsLeft === 1 ? 'spot' : 'spots'} left. Run a tie-breaker first: {runoff.tied.map((t) => `${t.teamName} (${formatPoints(t.totalPoints)})`).join(', ')}.
            </Notice>
          )}

          {err && <Notice>{err}</Notice>}
        </div>
        <div className="kit-acts">
          <button type="button" onClick={toFill ? fill : submit} disabled={busy} className="kit-pill kit-pill-fill">
            <Sparkles className="h-4 w-4" aria-hidden="true" /> {toFill ? (busy ? 'Filling…' : 'Fill the finals') : (busy ? 'Creating…' : 'Create finals')}
          </button>
          <button type="button" onClick={() => close()} className="kit-pill">Cancel</button>
        </div>
        </>
      )}
    </Sheet>
  );
}

/** "A Final", "A Final and B Final", "A Final, B Final and C Final". */
function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
