import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Maximize2, Mic, Monitor, Pause, Play, QrCode as QrCodeIcon, Radio, SlidersHorizontal, Trophy } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { BibSwatch } from '../../components/BibSwatch';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { QrAccessModal } from '../../components/QrAccessModal';
import { SponsorBadge } from '../../components/SponsorBadge';
import { SponsorStrip } from '../../components/SponsorStrip';
import { StreamControlStrip } from '../../components/stream/StreamControlStrip';
import { usePageWidth } from '../../components/pageWidthState';
import { formatPoints } from '../../lib/formatPoints';
import { advanceTvStandingsOrSlide, paginateTvStandings } from '../../lib/tvStandingsPagination';
import { DIAGONAL_HIDDEN_LEFT, DIAGONAL_HIDDEN_RIGHT, DIAGONAL_SHOWN, EASE_IN, EASE_OUT } from '../../lib/motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { statusLetter } from '../../lib/resultStatus';
import { displaySectionName } from '../../lib/section';
import { buildToplist, sectionScoreVersion } from '../../lib/toplist';
import { localOrdinal as ordinal } from '../../lib/ordinalText';
import { resultStatusText } from '../../lib/toplistText';
import { useT } from '../../i18n/LanguageContext';
import type { MessageKey } from '../../i18n/en';
import type { Heat, Race, Session, StandingRow, Team } from '../../types';
import { useCompetition } from './context';
import { currentRaceIndex, raceLanes, racesInOrder } from '../../lib/raceLanes';
import { lanesOf } from './laneRules';
import { Notice } from '../../components/Notice';
import { HeatScores } from './HeatScores';
import { useHeldFor } from '../../hooks/useHeldFor';
import { SAVED_STANDINGS_NOTICE_MS } from '../../offline/savedCopies';

type TvSlide = 'lanes' | 'heat' | 'latest' | 'standings';

const SLIDES: { id: TvSlide; label: MessageKey }[] = [
  { id: 'lanes', label: 'screen.tv.slide.lanes' },
  { id: 'heat', label: 'screen.tv.slide.heat' },
  { id: 'latest', label: 'screen.tv.slide.latest' },
  { id: 'standings', label: 'screen.tv.slide.standings' },
];

const SLIDE_IDS = SLIDES.map((s) => s.id);
const CYCLE_INTERVAL_MS = 12_000;

const isRaceSession = (s: Session) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0;
const isHeatDone = (h: Heat) => Boolean(h.finishedAt) || (h.races.length > 0 && h.races.every((r) => r.isComplete));

function pickInitialSectionId(sessions: Session[], sectionIds: number[], requested: number): number | null {
  if (sectionIds.includes(requested)) return requested;
  const liveSession = sessions.find((s) => s.status === 1 && s.competitionSectionId != null && sectionIds.includes(s.competitionSectionId));
  if (liveSession?.competitionSectionId != null) return liveSession.competitionSectionId;
  return sectionIds[0] ?? null;
}

export function TvKioskPage() {
  usePageWidth('full');
  const t = useT();
  const { competition, connected = false, standingsVersion = 0, ready, sponsors = [] } = useCompetition();
  const { canOrganise } = useAuth();
  const canControlStreams = canOrganise(competition);
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionIds = useMemo(() => competition.sections.map((s) => s.id), [competition.sections]);
  const requestedSection = Number(searchParams.get('section'));
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(() =>
    pickInitialSectionId(competition.sessions, sectionIds, requestedSection),
  );
  const [autoFollowLive, setAutoFollowLive] = useState(() => !sectionIds.includes(requestedSection));
  const [showStreamControls, setShowStreamControls] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  const liveSectionId = useMemo(() => {
    const live = competition.sessions.find(
      (s) => s.status === 1 && s.competitionSectionId != null && sectionIds.includes(s.competitionSectionId),
    );
    return live?.competitionSectionId ?? null;
  }, [competition.sessions, sectionIds]);

  const sectionId = useMemo(() => {
    if (autoFollowLive && liveSectionId != null && !sectionIds.includes(requestedSection)) {
      return liveSectionId;
    }
    if (selectedSectionId != null && sectionIds.includes(selectedSectionId)) {
      return selectedSectionId;
    }
    return pickInitialSectionId(competition.sessions, sectionIds, requestedSection);
  }, [autoFollowLive, liveSectionId, requestedSection, selectedSectionId, sectionIds, competition.sessions]);

  const [slide, setSlide] = useState<TvSlide>('lanes');
  const [standingsPage, setStandingsPage] = useState(0);
  const still = useStillMotion();
  const [playing, setPlaying] = useState(true);
  const [standingsBySection, setStandingsBySection] = useState<Record<number, { rows: StandingRow[]; source: typeof refreshSource; failed?: boolean }>>({});

  usePageHeader({
    title: t('screen.tv.title'),
    subtitle: competition.name,
    backTo: `/competitions/${competition.id}/scoring${sectionId != null ? `?section=${sectionId}` : ''}`,
    backLabel: t('screen.tv.backToScoring'),
  });

  const scoreVersion = useMemo(
    () => sectionScoreVersion(competition.sessions, sectionId),
    [competition.sessions, sectionId],
  );

  const refreshSource = useMemo(() => ({ competitionId: competition.id, scoreVersion, teams: competition.teams, sections: competition.sections, ready, standingsVersion }),
    [competition.id, scoreVersion, competition.teams, competition.sections, ready, standingsVersion]);

  useEffect(() => {
    if (sectionId == null) return;
    let cancelled = false;
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then((r) => {
        if (!cancelled && Array.isArray(r.data)) {
          setStandingsBySection((prev) => ({ ...prev, [sectionId]: { rows: r.data, source: refreshSource } }));
        }
      })
      .catch(() => { if (!cancelled) setStandingsBySection((prev) => ({ ...prev,
        [sectionId]: { rows: prev[sectionId]?.rows ?? [], source: refreshSource, failed: true },
      })); });
    return () => { cancelled = true; };
  }, [competition.id, sectionId, refreshSource]);

  // The rotation stays on the standings slide until every page of teams has been shown.
  const rotation = useRef({ slide, page: standingsPage, rows: 0 });
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const now = rotation.current;
      const step = advanceTvStandingsOrSlide<TvSlide>({
        currentSlide: now.slide, slides: SLIDE_IDS, standingsSlide: 'standings', currentPage: now.page, totalRows: now.rows,
      });
      setStandingsPage(step.nextPage);
      setSlide(step.nextSlide);
    }, CYCLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  const chooseSection = (nextId: number) => {
    setAutoFollowLive(false);
    setSelectedSectionId(nextId);
    setSearchParams({ section: String(nextId) }, { replace: true });
  };

  const stepSlide = (delta: -1 | 1) => {
    setStandingsPage(0);
    setSlide((current) => {
      const idx = SLIDES.findIndex((s) => s.id === current);
      return SLIDES[(idx + delta + SLIDES.length) % SLIDES.length].id;
    });
  };

  const section = competition.sections.find((s) => s.id === sectionId) ?? null;
  const sectionName = displaySectionName(section?.displayName) || t('screen.tv.allSections');

  const teamById = useMemo(() => {
    const map = new Map<number, Team>();
    for (const t of competition.teams) map.set(t.id, t);
    return map;
  }, [competition.teams]);

  const currentStandings = sectionId == null ? null : standingsBySection[sectionId];
  const standings = useMemo(() => currentStandings?.rows ?? [], [currentStandings]);
  const standingsStale = currentStandings?.failed || currentStandings?.source !== refreshSource;
  // Old standings are on screen for a moment on every refresh; only say so if it lasts half a minute.
  const savedNotice = useHeldFor(standingsStale && standings.length > 0, SAVED_STANDINGS_NOTICE_MS);

  const standingByTeamId = useMemo(() => {
    const map = new Map<number, StandingRow>();
    for (const row of standings) map.set(row.teamId, row);
    return map;
  }, [standings]);

  const toplist = useMemo(
    () => buildToplist(standings, competition.sessions, competition.teams, sectionId ?? -1, section?.finalistCount),
    [standings, competition.sessions, competition.teams, sectionId, section?.finalistCount],
  );

  // Ordered standings rows: if no races have been scored yet, still list every team in the section in order.
  const orderedStandingRows = useMemo(() => {
    if (toplist.rows.length > 0) {
      return toplist.rows.map((row) => {
        const team = teamById.get(row.teamId);
        const st = standingByTeamId.get(row.teamId);
        const detail = toplist.detail.get(row.teamId);
        const heatPoints = detail?.qualifyingPoints ?? (row.points - (detail?.final?.points ?? 0));
        const finalsPoints = detail?.final?.points ?? 0;
        return {
          teamId: row.teamId,
          rank: toplist.started ? row.position : null,
          joint: row.joint,
          bibColour: team?.bibColour ?? st?.bibColour ?? null,
          teamName: row.teamName,
          heatPoints,
          finalsPoints,
          totalPoints: row.points,
        };
      });
    }
    const sectionTeams = competition.teams
      .filter((t) => (sectionId == null || t.competitionSectionId === sectionId) && !t.isHorsConcours)
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return sectionTeams.map((t, index) => ({
      teamId: t.id,
      rank: index + 1,
      joint: false,
      bibColour: t.bibColour ?? null,
      teamName: t.displayName,
      heatPoints: 0,
      finalsPoints: 0,
      totalPoints: 0,
    }));
  }, [toplist, teamById, standingByTeamId, competition.teams, sectionId]);

  const standingsView = paginateTvStandings(orderedStandingRows, standingsPage);
  useEffect(() => {
    rotation.current = { slide, page: standingsView.pageIndex, rows: orderedStandingRows.length };
  }, [slide, standingsView.pageIndex, orderedStandingRows.length]);

  // Heats in running order for the selected section (or all sections if none in selected section).
  const orderedHeats = useMemo(() => {
    const filterSessions = (secId: number | null) =>
      competition.sessions
        .filter((s) => isRaceSession(s) && (secId == null || s.competitionSectionId === secId))
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex);

    let sessions = filterSessions(sectionId);
    if (sessions.length === 0 && sectionId != null) sessions = filterSessions(null);

    const list: { session: Session; heat: Heat; indexInSession: number }[] = [];
    for (const s of sessions) {
      const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      heats.forEach((h, idx) => {
        if (h.entries.length > 0 || h.races.length > 0) {
          list.push({ session: s, heat: h, indexInSession: idx });
        }
      });
    }
    return list;
  }, [competition.sessions, sectionId]);

  const { currentHeatItem, nextHeatItem } = useMemo(() => {
    if (orderedHeats.length === 0) return { currentHeatItem: null, nextHeatItem: null };
    const activeIdx = orderedHeats.findIndex(({ session, heat }) => session.status === 1 && !isHeatDone(heat));
    const firstOpenIdx = activeIdx >= 0 ? activeIdx : orderedHeats.findIndex(({ heat }) => !isHeatDone(heat));
    const currentIdx = firstOpenIdx >= 0 ? firstOpenIdx : orderedHeats.length - 1;
    return {
      currentHeatItem: orderedHeats[currentIdx] ?? null,
      nextHeatItem: orderedHeats[currentIdx + 1] ?? null,
    };
  }, [orderedHeats]);

  const latestRaceItem = useMemo(() => {
    let found: { session: Session; heat: Heat; race: Race } | null = null;
    for (const { session, heat } of orderedHeats) {
      const races = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      for (const race of races) {
        if (race.isComplete || race.results.length > 0) {
          found = { session, heat, race };
        }
      }
    }
    return found;
  }, [orderedHeats]);

  return (
    <div className="flex min-h-[82vh] flex-col justify-between gap-4 rounded-xl bg-[rgb(var(--mg-surface))] p-4 shadow-sm sm:p-6">
      {standingsStale && (standings.length ? savedNotice && <Notice tone="info">{t('competition.scoring.savedStandings')}</Notice> : <Notice tone="info">{t('screen.tv.waitingStandings')}</Notice>)}
      {/* Top TV Header & Controls */}
      <header className="flex flex-col gap-3 border-b-2 border-[rgb(var(--mg-heading))] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                connected
                  ? 'bg-[rgb(var(--mg-ok))] text-white'
                  : 'bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]'
              }`}
            >
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              {connected ? t('screen.tv.feedLive') : t('screen.tv.feedStandby')}
            </span>
            <div>
              <h1 className="mg-display m-0 text-2xl font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))] sm:text-3xl">
                {competition.name} · {sectionName}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {competition.sections.length > 1 && (
              <>
                <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
                  <span>{t('teams.list.section')}</span>
                  <select
                    aria-label={t('screen.tv.sectionFilter')}
                    value={sectionId ?? ''}
                    onChange={(e) => chooseSection(Number(e.target.value))}
                    className="min-h-10 rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] px-2.5 py-1.5 text-sm font-semibold text-[rgb(var(--mg-ink))]"
                  >
                    {competition.sections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {displaySectionName(sec.displayName)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  aria-pressed={autoFollowLive}
                  onClick={() => {
                    const next = !autoFollowLive;
                    setAutoFollowLive(next);
                    if (next) {
                      if (liveSectionId != null) setSelectedSectionId(liveSectionId);
                      setSearchParams({}, { replace: true });
                    }
                  }}
                  className={`mg-btn !min-h-10 !px-3 text-xs font-bold ${
                    autoFollowLive ? 'mg-btn-primary' : 'mg-btn-secondary'
                  }`}
                >
                  {t('screen.tv.autoFollow')}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => stepSlide(-1)}
              aria-label={t('screen.tv.prevSlide')}
              className="mg-btn mg-btn-secondary !min-h-10 !px-2.5"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-pressed={!playing}
              aria-label={playing ? t('screen.tv.pauseRotation') : t('screen.tv.resumeRotation')}
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
            >
              {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {playing ? t('screen.tv.pause') : t('teams.stream.play')}
            </button>
            <button
              type="button"
              onClick={() => stepSlide(1)}
              aria-label={t('screen.tv.nextSlide')}
              className="mg-btn mg-btn-secondary !min-h-10 !px-2.5"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>

            {canControlStreams && (<button
              type="button"
              aria-pressed={showStreamControls}
              onClick={() => setShowStreamControls((v) => !v)}
              className={`mg-btn !min-h-10 !px-3 text-xs font-bold ${
                showStreamControls ? 'mg-btn-primary' : 'mg-btn-secondary'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> {t('screen.tv.streamControls')}
            </button>)}

            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
            >
              <QrCodeIcon className="h-4 w-4" aria-hidden="true" /> {t('screen.tv.qrAccess')}
            </button>

            <button
              type="button"
              onClick={() => {
                if (typeof document !== 'undefined') {
                  if (document.fullscreenElement && document.exitFullscreen) {
                    void document.exitFullscreen().catch(() => {});
                  } else {
                    void document.documentElement.requestFullscreen?.()?.catch(() => {});
                  }
                }
              }}
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" /> {t('teams.stream.fullScreen')}
            </button>

            <Link
              to={`/competitions/${competition.id}/commentary${sectionId != null ? `?section=${sectionId}` : ''}`}
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
            >
              <Mic className="h-4 w-4" aria-hidden="true" /> {t('screen.tv.paDesk')}
            </Link>
            <Link
              to={`/competitions/${competition.id}/scoring${sectionId != null ? `?section=${sectionId}` : ''}`}
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
            >
              {t('screen.tv.scoring')}
            </Link>
          </div>
        </div>

        {canControlStreams && showStreamControls && (
          <StreamControlStrip
            competitionId={competition.id}
            arenaName={currentHeatItem?.session.arenaName}
            sectionId={sectionId}
            activeHeatId={currentHeatItem?.heat.id}
            compact
          />
        )}

        {/* Slide selector pills + Top Sponsor Logos */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="mg-seg" role="group" aria-label={t('screen.tv.slideGroup')}>
            {SLIDES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={slide === s.id}
                onClick={() => setSlide(s.id)}
              >
                {t(s.label)}
              </button>
            ))}
          </div>

          {sponsors.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-label={t('screen.tv.sponsorsLabel')}>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">{t('screen.tv.sponsoredBy')}</span>
              {sponsors.slice(0, 4).map((sp) => (
                <div key={sp.id} className="rounded border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-2 py-1">
                  <SponsorBadge sponsor={sp} />
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Main Slide Body */}
      <main className="flex-1 py-2">
        {/* Each slide wipes off on a slant and the next wipes on behind it, like the replay band on the stream. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={slide}
            initial={still ? false : { clipPath: DIAGONAL_HIDDEN_LEFT }}
            animate={{ clipPath: DIAGONAL_SHOWN, transition: { duration: 0.46, ease: EASE_OUT } }}
            exit={still ? undefined : { clipPath: DIAGONAL_HIDDEN_RIGHT, transition: { duration: 0.34, ease: EASE_IN } }}
          >
            {slide === 'lanes' && (
              <section aria-label={t('screen.tv.laneDrawLabel')} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <HeatLaneCard
                  badge={t('screen.tv.badgeRing')}
                  item={currentHeatItem}
                  teamById={teamById}
                  standingByTeamId={standingByTeamId}
                  laneHatbands={competition.laneHatbands}
                  emptyText={t('screen.tv.emptyRing')}
                />
                <HeatLaneCard
                  badge={t('screen.tv.badgeNext')}
                  item={nextHeatItem}
                  teamById={teamById}
                  standingByTeamId={standingByTeamId}
                  laneHatbands={competition.laneHatbands}
                  emptyText={t('screen.tv.emptyNext')}
                />
              </section>
            )}

            {slide === 'heat' && (
              <section aria-label={t('screen.tv.slide.heat')} className="mg-card overflow-hidden p-4">
                {currentHeatItem ? (
                  <HeatScores
                    session={currentHeatItem.session}
                    heats={currentHeatItem.session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex)}
                    activeHeatId={currentHeatItem.heat.id}
                    embedded
                  />
                ) : (
                  <p className="p-4 text-base text-[rgb(var(--mg-muted))]">{t('screen.tv.noActiveHeat')}</p>
                )}
              </section>
            )}

            {slide === 'latest' && (
              <section aria-label={t('screen.tv.slide.latest')} className="mg-card overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                    <h2 className="mg-display m-0 text-xl font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
                      {t('screen.tv.slide.latest')}
                    </h2>
                  </div>
                  {latestRaceItem && (
                    <span className="text-sm font-bold text-[rgb(var(--mg-body))]">
                      {latestRaceItem.session.name} · {latestRaceItem.heat.label || t('screen.tv.heatFallback')} · {latestRaceItem.race.name}
                    </span>
                  )}
                </div>
                {!latestRaceItem ? (
                  <p className="p-6 text-base text-[rgb(var(--mg-muted))]">{t('screen.tv.noResults')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="mg-display border-b border-[rgb(var(--mg-rule))] text-xs font-bold uppercase tracking-[0.05em] text-[rgb(var(--mg-muted))]">
                          <th scope="col" className="py-2.5 pl-4 pr-2">{t('screen.tv.colPlace')}</th>
                          <th scope="col" className="py-2.5 px-2">{t('screen.tv.colBib')}</th>
                          <th scope="col" className="py-2.5 px-2">{t('competition.toplist.team')}</th>
                          <th scope="col" className="py-2.5 px-2 text-right">{t('screen.tv.colRacePts')}</th>
                          <th scope="col" className="py-2.5 pl-2 pr-4 text-right">{t('screen.tv.colTotalPts')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgb(var(--mg-rule-soft))]">
                        {latestRaceItem.race.results
                          .slice()
                          .sort((a, b) => {
                            if (a.isSitOut !== b.isSitOut) return a.isSitOut ? 1 : -1;
                            if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
                            return (a.placing ?? 999) - (b.placing ?? 999) || b.points - a.points;
                          })
                          .map((res) => {
                            const team = teamById.get(res.teamId);
                            const st = standingByTeamId.get(res.teamId);
                            const placeText = res.isSitOut
                              ? 'S'
                              : res.eliminated
                                ? (statusLetter(true, res.status) ?? 'E')
                                : res.placing != null
                                  ? ordinal(res.placing)
                                  : '—';
                            return (
                              <tr key={res.id || res.teamId} className="text-base">
                                <td className="mg-display py-3 pl-4 pr-2 text-xl font-bold text-[rgb(var(--mg-heading))]">
                                  <span title={res.eliminated ? (resultStatusText(true, res.status, t) ?? undefined) : undefined}>{placeText}</span>
                                </td>
                                <td className="py-3 px-2">
                                  <BibSwatch colour={team?.bibColour ?? st?.bibColour} />
                                </td>
                                <td className="py-3 px-2 font-bold text-[rgb(var(--mg-ink))]">{res.teamName}</td>
                                <td className="mg-display py-3 px-2 text-right text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                                  +{formatPoints(res.points)}
                                </td>
                                <td className="mg-display py-3 pl-2 pr-4 text-right text-lg font-semibold tabular-nums text-[rgb(var(--mg-body))]">
                                  {formatPoints(st?.totalPoints ?? res.points)}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {slide === 'standings' && (
              <section aria-label={t('screen.tv.slide.standings')} className="mg-card overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                    <h2 className="mg-display m-0 text-xl font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
                      {t('screen.tv.standingsTitle', { section: sectionName })}
                    </h2>
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
                    {t('competition.scoring.teamCount', { count: orderedStandingRows.length })}
                    {standingsView.hasMultiplePages && <span className="ml-2 font-semibold normal-case tracking-normal" data-testid="tv-standings-page">{standingsView.pageLabel}</span>}
                  </span>
                </div>

                {orderedStandingRows.length === 0 ? (
                  <p className="p-6 text-base text-[rgb(var(--mg-muted))]">{t('screen.tv.noTeams')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="mg-display border-b border-[rgb(var(--mg-rule))] text-xs font-bold uppercase tracking-[0.05em] text-[rgb(var(--mg-muted))]">
                          <th scope="col" className="py-2.5 pl-4 pr-2">{t('screen.tv.colRank')}</th>
                          <th scope="col" className="py-2.5 px-2">{t('screen.tv.colBib')}</th>
                          <th scope="col" className="py-2.5 px-2">{t('competition.toplist.team')}</th>
                          <th scope="col" className="py-2.5 px-2 text-right">{t('screen.tv.colHeatPts')}</th>
                          <th scope="col" className="py-2.5 px-2 text-right">{t('screen.tv.colFinalsPts')}</th>
                          <th scope="col" className="py-2.5 pl-2 pr-4 text-right">{t('screen.tv.colTotalPts')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgb(var(--mg-rule-soft))]">
                        {standingsView.rows.map((row) => (
                          <tr key={row.teamId} className="text-base">
                            <td className="mg-display py-3 pl-4 pr-2 text-xl font-bold text-[rgb(var(--mg-heading))]">
                              {row.rank == null ? '—' : `${ordinal(row.rank)}${row.joint ? '=' : ''}`}
                            </td>
                            <td className="py-3 px-2">
                              <BibSwatch colour={row.bibColour} />
                            </td>
                            <td className="py-3 px-2 font-bold text-[rgb(var(--mg-ink))]">{row.teamName}</td>
                            <td className="mg-display py-3 px-2 text-right text-lg font-semibold tabular-nums text-[rgb(var(--mg-body))]">
                              {formatPoints(row.heatPoints)}
                            </td>
                            <td className="mg-display py-3 px-2 text-right text-lg font-semibold tabular-nums text-[rgb(var(--mg-body))]">
                              {formatPoints(row.finalsPoints)}
                            </td>
                            <td className="mg-display py-3 pl-2 pr-4 text-right text-2xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                              {formatPoints(row.totalPoints)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Sponsor Strip */}
      <footer className="border-t border-[rgb(var(--mg-rule-soft))] pt-3">
        <SponsorStrip placement="Results" />
      </footer>

      <QrAccessModal
        open={showQrModal}
        onClose={() => setShowQrModal(false)}
        competitionId={competition.id}
        competitionName={competition.name}
        sectionId={sectionId}
        canWrite={canControlStreams}
      />
    </div>
  );
}

function HeatLaneCard({
  badge,
  item,
  teamById,
  standingByTeamId,
  laneHatbands,
  emptyText,
}: {
  badge: string;
  item: { session: Session; heat: Heat; indexInSession: number } | null;
  teamById: Map<number, Team>;
  standingByTeamId: Map<number, StandingRow>;
  laneHatbands: string[] | null | undefined;
  emptyText: string;
}) {
  const t = useT();
  if (!item) {
    return (
      <div className="mg-card flex flex-col justify-center p-6">
        <span className="text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">{badge}</span>
        <p className="mt-2 text-base text-[rgb(var(--mg-muted))]">{emptyText}</p>
      </div>
    );
  }

  const { session, heat, indexInSession } = item;
  const races = racesInOrder(heat);
  const nextOpenRace = races.find((r) => !r.isComplete);
  // The lanes for that race as the scorer and the commentary desk show them: rotated, with sit-outs marked.
  const lanes = raceLanes(heat, currentRaceIndex(heat) ?? Math.max(races.length - 1, 0), lanesOf(session), laneHatbands);

  return (
    <div className="mg-card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3">
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-red))]">{badge}</span>
          <h2 className="mg-display m-0 text-xl font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
            {session.name} · {heat.label || t('competition.timetable.heat', { n: indexInSession + 1 })}
          </h2>
        </div>
        <div className="text-right text-xs font-semibold text-[rgb(var(--mg-body))]">
          {session.arenaName && <span className="block">{session.arenaName}</span>}
          {nextOpenRace && <span className="block font-bold text-[rgb(var(--mg-heading))]">{t('screen.tv.nextRace', { name: nextOpenRace.name })}</span>}
        </div>
      </div>

      {lanes.length === 0 ? (
        <p className="p-4 text-sm text-[rgb(var(--mg-muted))]">{t('screen.tv.noLanes')}</p>
      ) : (
        <ol className="m-0 divide-y divide-[rgb(var(--mg-rule-soft))] list-none p-0">
          {lanes.map(({ entry, lane, sitting }) => {
            const team = teamById.get(entry.teamId);
            const st = standingByTeamId.get(entry.teamId);
            return (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="mg-display min-w-16 shrink-0 whitespace-nowrap text-lg font-bold uppercase text-[rgb(var(--mg-heading))]">
                    {sitting ? t('screen.tv.sitsOut') : t('competition.toplist.lane', { n: lane })}
                  </span>
                  <BibSwatch colour={entry.bibColour ?? team?.bibColour ?? st?.bibColour} />
                  <div className="min-w-0">
                    <span className="block truncate text-lg font-bold text-[rgb(var(--mg-ink))]">{entry.teamName}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="mg-display text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                    {formatPoints(st?.totalPoints ?? 0)}
                  </span>
                  <span className="ml-1 text-xs font-semibold text-[rgb(var(--mg-muted))]">{t('screen.tv.pts')}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
