import { Dropdown } from '../../components/Dropdown';
import { displaySectionName } from '../../lib/section';
import { TimetableBoard } from './TimetableBoard';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Trophy, Sparkles, X, AlertTriangle, Mic, Monitor, QrCode as QrCodeIcon } from 'lucide-react';
import { QrAccessModal } from '../../components/QrAccessModal';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { CompetitionDetail, StandingRow } from '../../types';
import { buildToplist, sectionScoreVersion } from '../../lib/toplist';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { ToplistView, type ToplistViewTab } from './ToplistView';
import { TackLeaderboard } from './TackLeaderboard';
import { HeatScores } from './HeatScores';
import { ToplistRowsSkeleton } from '../../components/Skeletons';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { SponsorStrip } from '../../components/SponsorStrip';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../../offline/savedCopies';
import { NumberField } from '../../components/NumberField';
import { PageGrid } from '../../components/PageGrid';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { formatPoints } from '../../lib/formatPoints';

type SectionSubTab = 'draw' | 'scores' | 'toplist';

const NO_ROWS: StandingRow[] = [];
const TOPLIST_VIEW_PREF_KEY = 'mg.prefs.toplistView';
const DEFAULT_AGE_GROUP_PREF_KEY = 'mg.prefs.defaultAgeGroup';
const VALID_TOPLIST_VIEWS = new Set<ToplistViewTab>(['finals', 'totals', 'sessions', 'games', 'heats']);

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

/** Puts the toplist's title and refresh button in the app header while the standalone page is showing. */
function ToplistHeader({ subtitle, onRefresh }: { subtitle: string; onRefresh: () => void }) {
  usePageHeader({ title: 'Toplist', subtitle, onRefresh, refreshLabel: 'Refresh toplist' });
  return null;
}

/** The age group menu, in the header band. */
function AgeGroupSelect({ sections, value, teamCount, seamless = false, onChange }: { sections: { id: number; displayName: string }[]; value: number | null; teamCount: number; seamless?: boolean; onChange: (id: number) => void }) {
  const current = sections.find((s) => s.id === value);
  const options = sections.map((sec) => ({ value: String(sec.id), label: displaySectionName(sec.displayName) }));
  return (
    <div className={`mg-band-header pt-2.5 ${seamless ? 'pb-1.5' : 'pb-2.5'}`}>
      <Dropdown label="Age group" value={value == null ? '' : String(value)} options={options} onChange={(id) => onChange(Number(id))} buttonClassName="flex min-h-10 w-full items-stretch overflow-hidden rounded-lg border border-[rgb(var(--mg-header-line))] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        <span className="mg-display flex min-w-0 flex-1 items-baseline gap-2 self-center px-3 text-base font-bold uppercase leading-none tracking-[0.04em]">
          <span className="truncate">{displaySectionName(current?.displayName)}</span>
          <span className="shrink-0 text-xs font-medium normal-case tracking-normal text-[rgb(var(--mg-header-sub))]">{teamCount} {teamCount === 1 ? 'team' : 'teams'}</span>
        </span>
        <span aria-hidden="true" className="flex w-11 shrink-0 items-center justify-center border-l border-[rgb(var(--mg-header-line))] bg-white/10"><ChevronDown className="h-[18px] w-[18px]" /></span>
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
  return (
    <nav aria-label="Age groups" className="mg-card overflow-hidden">
      <h2 className="mg-display border-b-2 border-[rgb(var(--mg-heading))] px-3 py-2 text-[15px] font-bold uppercase tracking-[0.05em] text-[rgb(var(--mg-heading))]">Age groups</h2>
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

export function ScoringTab({ toplistOnly = false }: { toplistOnly?: boolean }) {
  const { competition, reload } = useCompetition();
  const { canManage } = useAuth();
  usePageWidth('wide');
  const desktop = useIsDesktop();
  // The age group lives in the URL (?section=ID) so the menu can link straight to one.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = Number(searchParams.get('section'));
  const sectionId = competition.sections.find((s) => s.id === requestedSection)?.id ?? defaultSectionId(competition);
  const [subTab, setSubTab] = useState<SectionSubTab>('draw');
  const [showToplist, setShowToplist] = useState(toplistOnly);
  const [showFinals, setShowFinals] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
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
    : list.sessionsDone === list.sessionsTotal ? (list.sessionsTotal === 1 ? 'After session 1' : `After all ${list.sessionsTotal} sessions`)
    : list.sessionsDone > 0 ? `After session ${list.sessionsDone} of ${list.sessionsTotal}` : null;
  const chooseSection = (id: number) => setSearchParams({ section: String(id) }, { replace: true });
  const notices = (
    <>
      {standingsLoading && !savedStandings && <ToplistRowsSkeleton />}
      {standingsStale && <p role="status" className="text-sm text-[rgb(var(--mg-muted))]">Showing saved standings while results refresh.</p>}
      {standingsError && <div role="alert" className="mg-card flex flex-col items-start gap-3 p-4"><p>Couldn’t load results. Check your connection and try again.</p><button className="mg-btn mg-btn-secondary" onClick={() => { if (sectionId != null) setStandingsBySection((prev) => { const next = { ...prev }; delete next[sectionId]; return next; }); setRetry((n) => n + 1); }}>Try again</button></div>}
      {sectionId != null && !standingsLoading && !standingsError && standings.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">No results yet.</p>}
    </>
  );
  const sectionLabel = `Toplist${sectionName ? `, ${sectionName}` : ''}`;
  const teamCount = competition.teams.filter((t) => t.competitionSectionId === sectionId && !t.isHorsConcours).length;
  const rail = desktop && competition.sections.length > 1
    ? <AgeGroupRail sections={competition.sections} teams={competition.teams} value={sectionId} onChange={chooseSection} /> : null;
  const sectionHeats = useMemo(() => {
    if (sectionId == null) return [];
    const out: { session: typeof competition.sessions[number]; orderedHeats: typeof competition.sessions[number]['heats']; heat: typeof competition.sessions[number]['heats'][number] }[] = [];
    const sessions = competition.sessions
      .filter((s) => s.competitionSectionId === sectionId && (s.kind ?? (s.isBreak ? 1 : 0)) === 0)
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    for (const s of sessions) {
      const orderedHeats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      const seenRounds = new Set<number>();
      for (const h of orderedHeats) {
        if (h.raceRoundStage && h.raceRoundId != null) {
          if (seenRounds.has(h.raceRoundId)) continue;
          seenRounds.add(h.raceRoundId);
        }
        out.push({ session: s, orderedHeats, heat: h });
      }
    }
    return out;
  }, [competition, sectionId]);
  // The page version draws its own tab band edge to edge on phones, so its notices sit in their own column above it.
  const toplist = toplistOnly ? (
    <section aria-label={sectionLabel} className="flex flex-col">
      <div className="flex flex-col gap-2.5 pt-3 empty:hidden">{notices}</div>
      {standings.length > 0 && <ToplistView list={list} section={section} standalone={!rail} competitionId={competition.id} teams={competition.teams} heats={sectionHeats} chosenView={chosenView} onChooseView={chooseView} />}
      {sectionId != null && <div className="pt-3"><TackLeaderboard competitionId={competition.id} sectionId={sectionId} refresh={retry} /></div>}
    </section>
  ) : (
    <section aria-label={sectionLabel} className="flex flex-col gap-2.5">
      {notices}
      {standings.length > 0 && <ToplistView list={list} section={section} competitionId={competition.id} teams={competition.teams} heats={sectionHeats} chosenView={chosenView} onChooseView={chooseView} />}
      {sectionId != null && <TackLeaderboard competitionId={competition.id} sectionId={sectionId} refresh={retry} />}
    </section>
  );
  const sectionQuery = sectionId != null ? `?section=${sectionId}` : '';
  const finalsButton = canManage(competition) && (
    <div className="flex flex-wrap items-center gap-2" role="region" aria-label="Organiser quick actions">
      {sectionId != null && (
        <button type="button" onClick={() => setShowFinals(true)} className="mg-btn mg-btn-primary">
          <Sparkles className="h-4 w-4" /> Create finals
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowQrModal(true)}
        className="mg-btn mg-btn-secondary"
      >
        <QrCodeIcon className="h-4 w-4" aria-hidden="true" /> QR Access
      </button>
      <Link
        to={`/competitions/${competition.id}/commentary${sectionQuery}`}
        className="mg-btn mg-btn-secondary"
      >
        <Mic className="h-4 w-4" aria-hidden="true" /> PA Commentator
      </Link>
      <Link
        to={`/competitions/${competition.id}/tv${sectionQuery}`}
        className="mg-btn mg-btn-secondary"
      >
        <Monitor className="h-4 w-4" aria-hidden="true" /> TV Kiosk
      </Link>
    </div>
  );
  const finalsModal = (
    <>
      <AnimatePresence>
        {showFinals && sectionId != null && (
          <FinalsModal
            sectionId={sectionId}
            onClose={() => setShowFinals(false)}
            onCreated={() => { setShowFinals(false); reload(); }}
          />
        )}
      </AnimatePresence>
      <QrAccessModal
        open={showQrModal}
        onClose={() => setShowQrModal(false)}
        competitionId={competition.id}
        competitionName={competition.name}
        sectionId={sectionId}
        canWrite={canManage(competition)}
      />
    </>
  );

  const ageGroups = !rail && competition.sections.length > 1 && <AgeGroupSelect sections={competition.sections} value={sectionId} teamCount={teamCount} seamless={toplistOnly && standings.length > 0} onChange={chooseSection} />;
  const sectionSessions = useMemo(
    () => competition.sessions
      .filter((s) => s.competitionSectionId === sectionId && (s.kind ?? (s.isBreak ? 1 : 0)) === 0)
      .sort((a, b) => a.orderIndex - b.orderIndex),
    [competition.sessions, sectionId],
  );

  if (toplistOnly || sectionId == null) {
    const page = (
      <div className={`mx-auto flex w-full flex-col ${rail ? '' : 'max-w-[560px] lg:max-w-3xl'}`}>
        {toplistOnly && <ToplistHeader subtitle={[competition.name, progress].filter(Boolean).join(' · ')} onRefresh={() => setRetry((n) => n + 1)} />}
        {!toplistOnly && <h1 className="mg-h1 mg-h1-sm py-3">Age groups</h1>}
        {ageGroups}
        <div className="flex flex-col gap-3">
          {sectionId == null ? <p className="mg-card mt-3 p-4 text-[rgb(var(--mg-muted))]">No age groups yet.</p> : toplist}
          {sectionId != null && <SponsorStrip placement="Results" />}
          {finalsButton && <div className="pt-1">{finalsButton}</div>}
        </div>
        {finalsModal}
      </div>
    );
    return rail ? <PageGrid variant="left" aside={rail} asideLabel="Age groups" className="pt-3">{page}</PageGrid> : page;
  }

  const subTabs: [SectionSubTab, string][] = [
    ['draw', 'Draw / Heats'],
    ['scores', 'Heat Scores'],
    ['toplist', 'Toplist'],
  ];

  const leadControls = (
          <div className="flex flex-col gap-3">
            <div className="mg-seg" role="group" aria-label="Section view">
              {subTabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={subTab === id}
                  onClick={() => {
                    setSubTab(id);
                    if (id === 'toplist') setShowToplist(true);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {subTab === 'draw' && (
              <>
                <button type="button" className="mg-tint-link" aria-expanded={showToplist} onClick={() => setShowToplist((v) => !v)}>
                  <Trophy aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1">{showToplist ? 'Hide toplist' : `Show ${sectionName ? `${sectionName} ` : ''}toplist`}</span>
                  <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${showToplist ? 'rotate-90' : ''}`} />
                </button>
                <AnimatePresence initial={false}>
                  {showToplist && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      {toplist}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {subTab === 'scores' && (
              <div className="flex flex-col gap-4" role="region" aria-label="Section heat scores">
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
                  <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">No heats drawn for this section yet.</p>
                )}
              </div>
            )}

            {subTab === 'toplist' && toplist}

            {finalsButton}
          </div>
  );
  const board = subTab === 'draw' ? (
    <TimetableBoard sectionId={sectionId} title={sectionName || 'Age group'} bandExtra={ageGroups} lead={leadControls} />
  ) : (
    <div className="mx-auto flex w-full flex-col gap-3">{ageGroups}{leadControls}</div>
  );

  return (
    <>
      {rail ? <PageGrid variant="left" aside={rail} asideLabel="Age groups" className="pt-3">{board}</PageGrid> : board}
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
  const [races, setRaces] = useState('Litter Lifter\nFlag\nBottle\nMug\nBall and Cone');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);

  useEffect(() => {
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then((r) => setStandings(r.data))
      .catch(() => setStandings([]));
  }, [competition.id, sectionId]);

  const runoff = useMemo(() => {
    if (standings.length <= topN) return null;
    const cutoff = standings[topN - 1];
    const next = standings[topN];
    if (cutoff.totalPoints !== next.totalPoints) return null;
    const tied = standings.filter((s) => s.totalPoints === cutoff.totalPoints);
    const seatsLeft = topN - standings.slice(0, topN).filter((s) => s.totalPoints > cutoff.totalPoints).length;
    return { tied, points: cutoff.totalPoints, seatsLeft };
  }, [standings, topN]);

  async function submit() {
    setErr(null);
    const raceNames = races.split('\n').map((r) => r.trim()).filter(Boolean);
    if (raceNames.length === 0) { setErr('Add at least one race.'); return; }
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/finals`, {
        competitionSectionId: sectionId,
        topN, raceNames, lanesPerHeat: lanes, name: name.trim() || null,
      });
      onCreated();
    } catch (e) {
      const m = (e as { response?: { data?: string } }).response?.data;
      setErr(typeof m === 'string' ? m : 'Could not create finals.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-3"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
        className="card w-full max-w-md max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-800">
          <Sparkles className="w-4 h-4 text-brand-600" />
          <h3 className="font-semibold text-sm flex-1">Create finals</h3>
          <button onClick={onClose} className="btn-ghost !py-1 !px-1.5"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">Top N teams</span>
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
          <label className="block">
            <span className="text-xs font-semibold">Races (one per line)</span>
            <textarea rows={5} className="input mt-1 text-sm font-mono" value={races} onChange={(e) => setRaces(e.target.value)} />
          </label>

          {runoff && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 p-2 text-[12px]">
              <div className="flex items-center gap-1.5 font-semibold mb-1">
                <AlertTriangle className="w-4 h-4" /> Runoff needed
              </div>
              <p className="text-[11px]">
                {runoff.tied.length} teams tied on {formatPoints(runoff.points)} pts at position {topN}, with only {runoff.seatsLeft}{' '}
                {runoff.seatsLeft === 1 ? 'spot' : 'spots'} left. Run a tie-breaker first:
              </p>
              <ul className="mt-1 space-y-0.5">
                {runoff.tied.map((t) => (
                  <li key={t.teamId} className="flex items-center justify-between text-[11px]">
                    <span className="truncate">{t.teamName}</span>
                    <span className="font-mono">{formatPoints(t.totalPoints)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {err && <div className="text-xs text-rose-600">{err}</div>}
        </div>
        <div className="flex items-center gap-2 p-3 border-t border-slate-200 dark:border-slate-800">
          <button onClick={onClose} className="btn-ghost !py-1.5 !px-3 text-xs">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn-primary !py-1.5 !px-3 text-xs ml-auto">
            <Sparkles className="w-3.5 h-3.5" /> {busy ? 'Creating…' : 'Create finals'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
