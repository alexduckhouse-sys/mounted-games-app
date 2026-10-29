import { clubLabel } from '../../lib/clubName';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Mic, Monitor, QrCode as QrCodeIcon, Radio, Sparkles, Trophy, Users } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { BibSwatch, HatbandSwatch } from '../../components/BibSwatch';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { QrAccessModal } from '../../components/QrAccessModal';
import { usePageWidth } from '../../components/pageWidthState';
import { formatPoints } from '../../lib/formatPoints';
import { useLanguage, useT } from '../../i18n/LanguageContext';
import { localOrdinal } from '../../lib/ordinalText';
import { parseBibAndFlag } from '../../lib/bib';
import { currentRaceIndex, raceLanes, racesInOrder } from '../../lib/raceLanes';
import { lanesOf } from './laneRules';
import { statusLetter } from '../../lib/resultStatus';
import { publicRiderName } from '../../lib/riderNames';
import { displaySectionName } from '../../lib/section';
import { buildToplist, sectionScoreVersion } from '../../lib/toplist';
import { useLiveHub } from '../../live/useLiveHub';
import type { DeclarationForm, Heat, Session, StandingRow, Team } from '../../types';
import { useCompetition } from './context';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useDockAction } from '../../components/TickerContext';
import { RefineChoiceRow, RefineList } from '../refine/Refine';
import { DeskOverlays } from './streamControls/DeskOverlays';
import { CommentatorBriefingCard } from './CommentatorBriefingCard';
import { useHeldFor } from '../../hooks/useHeldFor';
import { SAVED_STANDINGS_NOTICE_MS } from '../../offline/savedCopies';

type DeskMode = 'split' | 'lanes' | 'standings';

const isRaceSession = (s: Session) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0;
const isHeatDone = (h: Heat) => Boolean(h.finishedAt) || (h.races.length > 0 && h.races.every((r) => r.isComplete));

function defaultDeskSectionId(sessions: Session[], sectionIds: number[], requested: number): number | null {
  if (sectionIds.includes(requested)) return requested;
  const active = sessions.find((s) => s.status === 1 && s.competitionSectionId != null && sectionIds.includes(s.competitionSectionId));
  if (active?.competitionSectionId != null) return active.competitionSectionId;
  return sectionIds[0] ?? null;
}

export function CommentaryDeskPage() {
  usePageWidth('wide');
  const t = useT();
  const { lang } = useLanguage();
  const { competition, reload } = useCompetition();
  const { canOrganise } = useAuth();
  const canControlStreams = canOrganise(competition);
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionIds = useMemo(() => competition.sections.map((s) => s.id), [competition.sections]);
  const requestedSection = Number(searchParams.get('section'));
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(() =>
    defaultDeskSectionId(competition.sessions, sectionIds, requestedSection),
  );
  const sectionId = selectedSectionId != null && sectionIds.includes(selectedSectionId)
    ? selectedSectionId
    : defaultDeskSectionId(competition.sessions, sectionIds, requestedSection);

  const [mode, setMode] = useState<DeskMode>('split');
  const [selectedHeatId, setSelectedHeatId] = useState<number | null>(null);
  const [standingsBySection, setStandingsBySection] = useState<Record<number, { rows: StandingRow[]; source: typeof refreshSource; failed?: boolean }>>({});
  const [declarations, setDeclarations] = useState<DeclarationForm[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showQrModal, setShowQrModal] = useState(false);

  const bumpRefresh = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  const { connected } = useLiveHub(competition.id, {
    onReady: () => {
      reload();
      bumpRefresh();
    },
    onSessionUpdated: () => {
      reload();
      bumpRefresh();
    },
    onResultsUpdated: () => {
      reload();
      bumpRefresh();
    },
  });

  usePageHeader({
    title: t('desk.commentary.title'),
    subtitle: competition.name,
    backTo: `/competitions/${competition.id}/scoring${sectionId != null ? `?section=${sectionId}` : ''}`,
    backLabel: t('desk.commentary.backToScoring'),
  });

  const scoreVersion = useMemo(
    () => sectionScoreVersion(competition.sessions, sectionId),
    [competition.sessions, sectionId],
  );

  const refreshSource = useMemo(() => ({ competitionId: competition.id, scoreVersion, teams: competition.teams, sections: competition.sections, refreshTick }),
    [competition.id, scoreVersion, competition.teams, competition.sections, refreshTick]);

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

  useEffect(() => {
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => {
        if (!cancelled && Array.isArray(r.data)) {
          setDeclarations(r.data);
        }
      })
      .catch(() => {
        if (!cancelled) setDeclarations([]);
      });
    return () => { cancelled = true; };
  }, [competition.id, refreshTick]);

  const chooseSection = (nextId: number) => {
    setSelectedSectionId(nextId);
    setSelectedHeatId(null);
    setSearchParams({ section: String(nextId) }, { replace: true });
  };

  const section = competition.sections.find((s) => s.id === sectionId) ?? null;
  const sectionName = displaySectionName(section?.displayName) || t('desk.commentary.sectionFallback');

  const teamById = useMemo(() => {
    const map = new Map<number, Team>();
    for (const tm of competition.teams) map.set(tm.id, tm);
    return map;
  }, [competition.teams]);

  const decByTeamId = useMemo(() => {
    const map = new Map<number, DeclarationForm>();
    for (const d of declarations) map.set(d.teamId, d);
    return map;
  }, [declarations]);

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

  // Compute last race result per team and latest race winner in this section
  const { lastRaceByTeamId, latestRaceSummary } = useMemo(() => {
    const map = new Map<number, string>();
    let latestWinner: string | null = null;
    const sessions = competition.sessions
      .filter((s) => isRaceSession(s) && (sectionId == null || s.competitionSectionId === sectionId))
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    for (const s of sessions) {
      const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      for (const h of heats) {
        const races = h.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
        for (const r of races) {
          for (const res of r.results) {
            const placeText = res.isSitOut
              ? t('desk.commentary.satOut')
              : res.eliminated
                ? (statusLetter(true, res.status) ?? 'E')
                : res.placing != null
                  ? localOrdinal(res.placing, lang)
                  : t('desk.commentary.scored');
            map.set(res.teamId, t('desk.commentary.lastRaceLine', { place: placeText, race: r.name, points: formatPoints(res.points) }));
          }
          const winner = r.results.find((res) => !res.eliminated && !res.isSitOut && res.placing === 1);
          if (winner) {
            latestWinner = t('desk.commentary.winnerLine', { team: winner.teamName, race: r.name, points: formatPoints(winner.points) });
          }
        }
      }
    }
    return { lastRaceByTeamId: map, latestRaceSummary: latestWinner };
  }, [competition.sessions, sectionId, t, lang]);

  // Section heats in running order
  const sectionHeats = useMemo(() => {
    const sessions = competition.sessions
      .filter((s) => isRaceSession(s) && (sectionId == null || s.competitionSectionId === sectionId))
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const list: { session: Session; heat: Heat; label: string }[] = [];
    for (const s of sessions) {
      const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      heats.forEach((h, idx) => {
        if (h.entries.length > 0 || h.races.length > 0) {
          list.push({
            session: s,
            heat: h,
            label: `${s.name} · ${h.label || t('desk.commentary.heatN', { n: idx + 1 })}`,
          });
        }
      });
    }
    return list;
  }, [competition.sessions, sectionId, t]);

  const activeHeatItem = useMemo(() => {
    if (sectionHeats.length === 0) return null;
    if (selectedHeatId != null) {
      const chosen = sectionHeats.find((item) => item.heat.id === selectedHeatId);
      if (chosen) return chosen;
    }
    const inRing = sectionHeats.find(({ session, heat }) => session.status === 1 && !isHeatDone(heat));
    if (inRing) return inRing;
    const nextOpen = sectionHeats.find(({ heat }) => !isHeatDone(heat));
    return nextOpen ?? sectionHeats[sectionHeats.length - 1];
  }, [sectionHeats, selectedHeatId]);

  // The lanes for the race being run (or up next) in this heat, worked out as the scorer does: rotated, with the
  // hatband of the lane each team actually rides in. Once every race is done, the last race's lanes.
  const activeLanes = useMemo(() => {
    if (!activeHeatItem) return null;
    const { heat, session } = activeHeatItem;
    const races = racesInOrder(heat);
    const index = currentRaceIndex(heat) ?? Math.max(races.length - 1, 0);
    return { race: races[index] ?? null, lanes: raceLanes(heat, index, lanesOf(session), competition.laneHatbands) };
  }, [activeHeatItem, competition.laneHatbands]);

  // Every team in order (1st..Nth) for the Standings panel
  const orderedStandings = useMemo(() => {
    const cutoffPlaces = section?.finalistCount ?? 6;
    if (toplist.rows.length > 0) {
      const leaderPoints = toplist.rows[0]?.points ?? 0;
      const cutoffRow = toplist.rows[Math.min(cutoffPlaces - 1, toplist.rows.length - 1)];
      const cutoffPoints = cutoffRow?.points ?? 0;

      return toplist.rows.map((row, idx) => {
        const team = teamById.get(row.teamId);
        const st = standingByTeamId.get(row.teamId);
        const dec = decByTeamId.get(row.teamId);
        const riders = (dec?.riders ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
        const gapToFirst = Math.max(0, leaderPoints - row.points);
        const gapToCutoff = idx < cutoffPlaces ? 0 : Math.max(0, cutoffPoints - row.points);
        const gapLabel = idx === 0
          ? t('desk.commentary.leader')
          : idx < cutoffPlaces
            ? (gapToFirst === 0
              ? t('desk.commentary.levelTop', { places: cutoffPlaces })
              : t('desk.commentary.gapTop', { gap: t('desk.commentary.pointsN', { count: gapToFirst }), places: cutoffPlaces }))
            : (gapToCutoff === 0
              ? t('desk.commentary.levelCutoff', { gap: formatPoints(gapToFirst), places: cutoffPlaces })
              : t('desk.commentary.gapCutoff', { gap: formatPoints(gapToFirst), cut: formatPoints(gapToCutoff), places: cutoffPlaces }));

        return {
          teamId: row.teamId,
          rank: row.position,
          rankLabel: toplist.started ? `${row.joint ? '=' : ''}${localOrdinal(row.position, lang)}` : '—',
          bibColour: team?.bibColour ?? st?.bibColour ?? null,
          teamName: row.teamName,
          clubName: clubLabel(team?.clubName ?? st?.clubName),
          trainerName: dec?.trainerName?.trim() || team?.trainerName?.trim() || null,
          riders,
          totalPoints: row.points,
          wins: st?.wins ?? 0,
          gapLabel,
        };
      });
    }

    const sectionTeams = competition.teams
      .filter((tm) => (sectionId == null || tm.competitionSectionId === sectionId) && !tm.isHorsConcours)
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return sectionTeams.map((tm, idx) => {
      const dec = decByTeamId.get(tm.id);
      const riders = (dec?.riders ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
      return {
        teamId: tm.id,
        rank: idx + 1,
        rankLabel: '—',
        bibColour: tm.bibColour ?? null,
        teamName: tm.displayName,
        clubName: clubLabel(tm.clubName),
        trainerName: dec?.trainerName?.trim() || tm.trainerName?.trim() || null,
        riders,
        totalPoints: 0,
        wins: 0,
        gapLabel: t('desk.commentary.zeroPts'),
      };
    });
  }, [toplist, section?.finalistCount, teamById, standingByTeamId, decByTeamId, competition.teams, sectionId, t, lang]);

  // Points each team has made in the heat on show (the toplist total sits beside it).
  const heatPointsByTeamId = useMemo(() => {
    const map = new Map<number, number>();
    for (const race of activeHeatItem?.heat.races ?? []) {
      for (const res of race.results) map.set(res.teamId, (map.get(res.teamId) ?? 0) + (res.isSitOut ? 0 : res.points));
    }
    return map;
  }, [activeHeatItem]);

  // The next few races to run in this section, after the one on now.
  const upNext = useMemo(() => {
    const list: string[] = [];
    const start = activeHeatItem ? sectionHeats.findIndex((item) => item.heat.id === activeHeatItem.heat.id) : -1;
    for (const item of start < 0 ? [] : sectionHeats.slice(start)) {
      for (const race of item.heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex)) {
        if (!race.isComplete) list.push(`${race.name} · ${item.label}`);
      }
    }
    return list.slice(1, 4);
  }, [sectionHeats, activeHeatItem]);

  const rankByTeamId = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of orderedStandings) {
      map.set(row.teamId, row.rankLabel);
    }
    return map;
  }, [orderedStandings]);

  // Key Talking Points summary for the commentator
  const talkingPoints = useMemo(() => {
    const cutoffPlaces = section?.finalistCount ?? 6;
    const leader = orderedStandings[0] ?? null;
    const leaderText = toplist.started && leader
      ? t('desk.commentary.leaderText', { team: leader.teamName, points: formatPoints(leader.totalPoints), wins: t('desk.commentary.winsCount', { count: leader.wins }) })
      : t('desk.commentary.noRacesScored');

    let cutoffText = t('desk.commentary.cutoffDefault', { places: cutoffPlaces });
    if (toplist.started && orderedStandings.length > cutoffPlaces) {
      const onBubble = orderedStandings[cutoffPlaces - 1];
      const chasing = orderedStandings[cutoffPlaces];
      if (onBubble && chasing) {
        const diff = Math.max(0, onBubble.totalPoints - chasing.totalPoints);
        cutoffText = t('desk.commentary.cutoffBubble', { team: onBubble.teamName, points: t('desk.commentary.pointsN', { count: onBubble.totalPoints }), place: localOrdinal(cutoffPlaces, lang), chasing: chasing.teamName, ahead: t('desk.commentary.pointsN', { count: diff }) });
      }
    }

    return {
      leaderText,
      cutoffText,
      latestWinner: latestRaceSummary ?? t('desk.commentary.waitingFirst'),
    };
  }, [section?.finalistCount, orderedStandings, toplist.started, latestRaceSummary, t, lang]);

  // The controls live in a sheet opened from the dock; with no dock (page on its own) they stay in the header card.
  const [controlsOpen, setControlsOpen] = useState(false);
  const docked = useDockAction({ label: t('desk.commentary.controls'), icon: 'settings', onClick: () => setControlsOpen(true) });
  const renderControls = (close?: (after?: () => void) => void) => (
    <div className="flex flex-col gap-3">
      <RefineList as="div">
        {competition.sections.length > 1 && (
          <RefineChoiceRow label={t('desk.commentary.section')} value={String(sectionId ?? '')} onChange={(value) => chooseSection(Number(value))}
            options={competition.sections.map((sec) => ({ value: String(sec.id), label: displaySectionName(sec.displayName) }))} />
        )}
        {sectionHeats.length > 1 && (
          <RefineChoiceRow label={t('desk.commentary.heat')} value={String(activeHeatItem?.heat.id ?? '')} onChange={(value) => setSelectedHeatId(Number(value))}
            options={sectionHeats.map((item) => ({ value: String(item.heat.id), label: item.label }))} />
        )}
        <RefineChoiceRow<DeskMode> label={t('desk.commentary.view')} value={mode} onChange={setMode}
          options={[
            { value: 'split', label: t('desk.commentary.sideBySide') },
            { value: 'lanes', label: t('desk.commentary.currentLanes') },
            { value: 'standings', label: t('desk.commentary.standingsInOrder') },
          ]} />
      </RefineList>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { if (close) close(() => { setControlsOpen(false); setShowQrModal(true); }); else setShowQrModal(true); }}
          className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
        >
          <QrCodeIcon className="h-4 w-4" aria-hidden="true" /> {t('desk.commentary.qrAccess')}
        </button>
        <Link
          to={`/competitions/${competition.id}/tv${sectionId != null ? `?section=${sectionId}` : ''}`}
          className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
        >
          <Monitor className="h-4 w-4" aria-hidden="true" /> {t('desk.commentary.tvKiosk')}
        </Link>
        <Link
          to={`/competitions/${competition.id}/scoring${sectionId != null ? `?section=${sectionId}` : ''}`}
          className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
        >
          {t('desk.commentary.scoring')}
        </Link>
        {activeHeatItem && (
          <Link
            to={`/competitions/${competition.id}/session/${activeHeatItem.session.id}?heat=${activeHeatItem.heat.id}&commentator=1`}
            className="mg-btn mg-btn-primary !min-h-10 !px-3 text-xs font-bold"
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> {t('desk.commentary.scoreAndCommentate')}
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex w-full flex-col gap-4 py-3">
      {standingsStale && (standings.length ? savedNotice && <Notice tone="info">{t('desk.commentary.savedStandings')}</Notice> : <Notice tone="info">{t('desk.commentary.waitingOfficial')}</Notice>)}
      {/* Top Bar */}
      <header className="mg-card flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                connected
                  ? 'bg-[rgb(var(--mg-ok))] text-white'
                  : 'bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]'
              }`}
            >
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              {connected ? t('desk.commentary.livePa') : t('desk.commentary.standby')}
            </span>
            <h1 className="mg-display m-0 text-xl font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))] sm:text-2xl">
              <Mic className="mr-1.5 inline h-5 w-5 align-text-bottom" aria-hidden="true" />
              {/* a template string keeps the React Compiler from treating the section as mutable */}
              {t('desk.commentary.titleSection', { section: `${sectionName}` })}
            </h1>
          </div>

        </div>
        {!docked && renderControls()}
      </header>
      {docked && controlsOpen && (
        <Sheet title={t('desk.commentary.controls')} onClose={() => setControlsOpen(false)}>
          {({ close }) => renderControls(close)}
        </Sheet>
      )}

      {/* One-tap stream overlays */}
      {canControlStreams && <DeskOverlays />}

      {/* Key Talking Points Banner */}
      <section aria-label={t('desk.commentary.keyPoints')} className="mg-card grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-3">
        <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-3 py-2">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
            <Trophy className="h-3.5 w-3.5 text-[rgb(var(--mg-heading))]" aria-hidden="true" /> {t('desk.commentary.sectionLeader')}
          </span>
          <p className="mt-1 mb-0 text-sm font-bold text-[rgb(var(--mg-ink))]">{talkingPoints.leaderText}</p>
        </div>
        <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-3 py-2">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
            <Sparkles className="h-3.5 w-3.5 text-[rgb(var(--mg-heading))]" aria-hidden="true" /> {t('desk.commentary.cutoffBattle')}
          </span>
          <p className="mt-1 mb-0 text-sm font-bold text-[rgb(var(--mg-ink))]">{talkingPoints.cutoffText}</p>
        </div>
        <div className="rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-3 py-2">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
            <Radio className="h-3.5 w-3.5 text-[rgb(var(--mg-heading))]" aria-hidden="true" /> {t('desk.commentary.latestWinner')}
          </span>
          <p className="mt-1 mb-0 text-sm font-bold text-[rgb(var(--mg-ink))]">{talkingPoints.latestWinner}</p>
        </div>
      </section>

      {/* Main Content Grid */}
      <div className={mode === 'split' ? 'grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start' : 'flex flex-col gap-4'}>
        {(mode === 'split' || mode === 'lanes') && (
          <div className="flex flex-col gap-4">
          <section aria-label={t('desk.commentary.lanesInOrder')} className="mg-card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                <h2 className="mg-display m-0 text-lg font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
                  {t('desk.commentary.lanesInOrder')}
                </h2>
              </div>
              <span className="text-xs font-bold text-[rgb(var(--mg-body))]">
                {activeHeatItem ? `${activeHeatItem.label} · ` : ''}{activeLanes?.race ? `${t('desk.commentary.lanesFor', { race: activeLanes.race.name })} · ` : ''}{t('desk.commentary.heatToplist')}
              </span>
            </div>

            {!activeHeatItem || activeHeatItem.heat.entries.length === 0 ? (
              <p className="p-4 text-sm text-[rgb(var(--mg-muted))]">{t('desk.commentary.noLaneDraw')}</p>
            ) : (
              <ol className="m-0 divide-y divide-[rgb(var(--mg-rule-soft))] list-none p-0">
                {(activeLanes?.lanes ?? []).map(({ entry, lane, sitting, hatband }) => {
                    const team = teamById.get(entry.teamId);
                    const bibWords = parseBibAndFlag(team?.bibDescription).bib;
                    const st = standingByTeamId.get(entry.teamId);
                    const dec = decByTeamId.get(entry.teamId);
                    const riders = (dec?.riders ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
                    const rankText = rankByTeamId.get(entry.teamId) ?? '—';
                    const toplistPts = formatPoints(st?.totalPoints ?? 0);
                    const heatPts = formatPoints(heatPointsByTeamId.get(entry.teamId) ?? 0);
                    const lastRace = lastRaceByTeamId.get(entry.teamId) ?? t('desk.commentary.noRaceYet');

                    return (
                      <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="mg-display shrink-0 rounded bg-[rgb(var(--mg-tint))] px-2 py-0.5 text-base font-bold uppercase text-[rgb(var(--mg-heading))]">
                              {sitting ? t('desk.commentary.sitsOut') : t('desk.commentary.lane', { n: lane })}
                            </span>
                            <HatbandSwatch colour={hatband} />
                            <BibSwatch colour={entry.bibColour ?? team?.bibColour ?? st?.bibColour} />
                            <span className="text-base font-bold text-[rgb(var(--mg-ink))]">
                              {entry.teamName}
                            </span>
                            {clubLabel(team?.clubName) && (
                              <span className="truncate text-xs font-medium text-[rgb(var(--mg-muted))]">
                                · {team?.clubName}
                              </span>
                            )}
                          </div>
                          <span className="mg-display shrink-0 text-sm font-bold text-[rgb(var(--mg-heading))]" aria-label={t('desk.commentary.rankAria', { rank: rankText, heat: heatPts, toplist: toplistPts })}>
                            {t('desk.commentary.rankLine', { rank: rankText, heat: heatPts, toplist: toplistPts })}
                          </span>
                        </div>

                        {riders.length > 0 ? (
                          <ul className="m-0 flex flex-wrap gap-x-4 gap-y-1 list-none p-0 text-xs text-[rgb(var(--mg-body))]">
                            {riders.map((r) => (
                              <li key={r.id} className="font-medium">
                                <span className="font-semibold text-[rgb(var(--mg-ink))]">{publicRiderName(r)}</span>
                                {r.horseName ? ` (${r.horseName})` : ''}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">
                            {team?.trainerName ? t('desk.commentary.trainer', { name: team.trainerName }) : t('desk.commentary.noDec')}
                          </p>
                        )}

                        {bibWords && <p className="m-0 truncate text-xs text-[rgb(var(--mg-muted))]">{t('desk.commentary.bibs', { bibs: bibWords })}</p>}
                        <div className="text-xs font-medium text-[rgb(var(--mg-muted))]">
                          {t('desk.commentary.lastRace')}{' '}<span className="font-semibold text-[rgb(var(--mg-body))]">{lastRace}</span>
                        </div>
                      </li>
                    );
                  })}
              </ol>
            )}
          </section>

          {activeHeatItem && (
            <CommentatorBriefingCard
              competitionId={competition.id}
              session={activeHeatItem.session}
              heat={activeHeatItem.heat}
              allSessions={competition.sessions}
              standings={standings}
              teams={competition.teams}
              declarations={declarations}
              finalistCount={section?.finalistCount}
              laneOrder={activeLanes?.lanes.map((l) => ({ teamId: l.entry.teamId, lane: l.lane, sitting: l.sitting }))}
              refreshTick={refreshTick}
            />
          )}

          <section aria-label={t('desk.commentary.upNext')} className="mg-card overflow-hidden">
            <div className="border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3">
              <h2 className="mg-display m-0 text-lg font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">{t('desk.commentary.upNext')}</h2>
            </div>
            {upNext.length === 0 ? (
              <p className="p-4 text-sm text-[rgb(var(--mg-muted))]">{t('desk.commentary.nothingElse')}</p>
            ) : (
              <ol className="m-0 divide-y divide-[rgb(var(--mg-rule-soft))] list-none p-0">
                {upNext.map((label) => <li key={label} className="px-4 py-3 text-base font-semibold text-[rgb(var(--mg-ink))]">{label}</li>)}
              </ol>
            )}
          </section>
          </div>
        )}

        {(mode === 'split' || mode === 'standings') && (
          <section aria-label={t('desk.commentary.standingsEach')} className="mg-card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                <h2 className="mg-display m-0 text-lg font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
                  {t('desk.commentary.standingsEach')}
                </h2>
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
                {t('desk.commentary.firstTo', { place: localOrdinal(orderedStandings.length || 1, lang) })}
              </span>
            </div>

            {orderedStandings.length === 0 ? (
              <p className="p-4 text-sm text-[rgb(var(--mg-muted))]">{t('desk.commentary.noTeams')}</p>
            ) : (
              <ol className="m-0 divide-y divide-[rgb(var(--mg-rule-soft))] list-none p-0">
                {orderedStandings.map((row) => (
                  <li key={row.teamId} className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="mg-display w-11 shrink-0 text-lg font-bold text-[rgb(var(--mg-heading))]">
                          {row.rankLabel}
                        </span>
                        <BibSwatch colour={row.bibColour} />
                        <span className="truncate text-base font-bold text-[rgb(var(--mg-ink))]">
                          {row.teamName}
                        </span>
                        {row.clubName && (
                          <span className="truncate text-xs font-medium text-[rgb(var(--mg-muted))]">
                            · {row.clubName}
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-baseline gap-2.5">
                        <span className="rounded bg-[rgb(var(--mg-tint))] px-2 py-0.5 text-xs font-bold text-[rgb(var(--mg-heading))]">
                          {t('desk.commentary.firsts', { count: row.wins })}
                        </span>
                        <span className="mg-display text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                          {t('desk.commentary.pointsN', { count: row.totalPoints })}
                        </span>
                      </div>
                    </div>

                    {row.riders.length > 0 ? (
                      <ul className="m-0 flex flex-wrap gap-x-4 gap-y-1 list-none p-0 text-xs text-[rgb(var(--mg-body))]">
                        {row.riders.map((r) => (
                          <li key={r.id} className="font-medium">
                            <span className="font-semibold text-[rgb(var(--mg-ink))]">{publicRiderName(r)}</span>
                            {r.horseName ? ` (${r.horseName})` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : row.trainerName ? (
                      <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">{t('desk.commentary.trainer', { name: row.trainerName })}</p>
                    ) : null}

                    {parseBibAndFlag(teamById.get(row.teamId)?.bibDescription).bib && (
                      <p className="m-0 truncate text-xs text-[rgb(var(--mg-muted))]">{t('desk.commentary.bibs', { bibs: parseBibAndFlag(teamById.get(row.teamId)?.bibDescription).bib })}</p>
                    )}
                    <div className="text-xs font-semibold text-[rgb(var(--mg-muted))]">
                      {row.gapLabel}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

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
