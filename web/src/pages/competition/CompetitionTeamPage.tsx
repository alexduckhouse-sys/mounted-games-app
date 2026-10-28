import { useEffect, useMemo, useState } from 'react';
import { FollowStar } from '../../components/FollowStar';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { HeatScores } from './HeatScores';
import { api } from '../../api';
import { useCompactPageBar, usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { useFavourites } from '../../hooks/useFavourites';
import { parseBibAndFlag } from '../../lib/bib';
import { dotColour } from '../../lib/teamColours';
import { formatPoints } from '../../lib/formatPoints';
import { statusLetter } from '../../lib/resultStatus';
import { resultStatusLabel } from '../../lib/resultStatusText';
import { displaySectionName } from '../../lib/section';
import { computeTimings } from '../../lib/time';
import { timetableRows, TIMETABLE_COLOURS, type TimetableStatus } from '../../lib/timetableRows';
import { formatDelayDuration, formatTime } from '../../lib/time';
import { buildToplist, type TeamBlock } from '../../lib/toplist';
import { localOrdinal as ordinal } from '../../lib/ordinalText';
import { useT } from '../../i18n/LanguageContext';
import { activeLocale } from '../../i18n/translate';
import type { Heat, Session, StandingRow } from '../../types';
import { useCompetition } from './context';
import { heatName, nextHeats } from '../../lib/following';
import { computeTeamStats } from '../../lib/teamStats';
import type { TeamProfile, TeamProfileHistory } from '../seasons/teamProfileTypes';
import { byDrawnLane } from './laneRules';
import { clubLabel } from '../../lib/clubName';



const isRaceSession =(session: Session) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
const isHeatDone = (heat: Heat) => !!heat.finishedAt || (heat.races.length > 0 && heat.races.every((r) => r.isComplete));

export function CompetitionTeamPage() {
  usePageWidth('wide');
  const t = useT();
  const { teamId } = useParams<{ teamId: string }>();
  const id = Number(teamId);
  const navigate = useNavigate();
  const location = useLocation();
  const { competition } = useCompetition();
  const { favourites, toggle } = useFavourites();

  const team = competition.teams.find((t) => t.id === id) ?? null;
  const section = team ? competition.sections.find((s) => s.id === team.competitionSectionId) ?? null : null;
  const sectionLabel = displaySectionName(section?.displayName ?? team?.sectionName);
  const fallbackBackPath = team
    ? `/competitions/${competition.id}/toplists?section=${team.competitionSectionId}`
    : `/competitions/${competition.id}/teams`;


  function goBack() {
    if (location.key !== 'default') {
      navigate(-1);
    } else {
      navigate(fallbackBackPath);
    }
  }

  const [standings, setStandings] = useState<StandingRow[]>([]);
  // One heat at a time opens in place to show its full table.
  const [openHeatId, setOpenHeatId] = useState<number | null>(null);
  const still = useStillMotion();
  const [matchedProfile, setMatchedProfile] = useState<TeamProfile | null>(null);
  const [profileHistory, setProfileHistory] = useState<TeamProfileHistory | null>(null);

  useEffect(() => {
    if (!team) return;
    let cancelled = false;
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId: team.competitionSectionId } })
      .then((r) => { if (!cancelled && Array.isArray(r.data)) setStandings(r.data); })
      .catch(() => { if (!cancelled) setStandings([]); });
    return () => { cancelled = true; };
  }, [competition.id, team]);

  useEffect(() => {
    if (!team) return;
    let cancelled = false;
    api.get<TeamProfile[]>('/team-profiles')
      .then((r) => {
        if (cancelled || !Array.isArray(r.data)) return;
        const found = r.data.find(
          (p) => p.clubId === team.clubId && (p.displayName.toLowerCase() === team.displayName.toLowerCase() || (p.suffix && p.suffix.toLowerCase() === team.suffix.toLowerCase())),
        ) ?? r.data.find((p) => p.clubId === team.clubId) ?? null;
        setMatchedProfile(found);
        if (found) {
          api.get<TeamProfileHistory>(`/team-profiles/${found.id}/history`)
            .then((hr) => { if (!cancelled && hr.data) setProfileHistory(hr.data); })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [team]);

  const list = useMemo(
    () => (team ? buildToplist(standings, competition.sessions, competition.teams, team.competitionSectionId, section?.finalistCount) : null),
    [standings, competition.sessions, competition.teams, team, section?.finalistCount],
  );

  const drawnHeats = useMemo(() => {
    if (!team) return [];
    const timings = computeTimings(competition.sessions);
    const tRows = timetableRows(competition.sessions, timings, true);
    const items: {
      session: Session;
      orderedHeats: Heat[];
      heat: Heat;
      heatLabel: string;
      lane: number;
      points: number;
      done: boolean;
      scoredAny: boolean;
      timeText: string | null;
      /** Final lanes come from the rankings, so a final shows no lane. */
      final: boolean;
      status: TimetableStatus;
      delayMinutes: number;
    }[] = [];
    const orderedSessions = [...competition.sessions].filter(isRaceSession).sort((a, b) => a.orderIndex - b.orderIndex);
    for (const session of orderedSessions) {
      const orderedHeats = [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex);
      orderedHeats.forEach((heat, idx) => {
        const entry = heat.entries.find((e) => e.teamId === team.id);
        const hasResult = heat.races.some((r) => r.results.some((res) => res.teamId === team.id));
        if (!entry && !hasResult) return;
        const drawnIdx = entry ? byDrawnLane(heat).findIndex((e) => e.id === entry.id) + 1 : 0;
        const lane = drawnIdx > 0 ? drawnIdx : (entry?.laneIndex ?? 1);
        let points = 0;
        let scoredAny = false;
        for (const race of heat.races) {
          for (const res of race.results) {
            if (res.teamId === team.id) {
              points += res.points;
              scoredAny = true;
            }
          }
        }
        const tRow = tRows.find((r) => r.heat?.id === heat.id);
        const timeText = tRow?.effective
          ? tRow.effective.toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' })
          : null;
        items.push({
          session,
          orderedHeats,
          heat,
          heatLabel: heat.label?.trim() || t('teams.team.heatN', { number: idx + 1 }),
          lane,
          points,
          done: isHeatDone(heat),
          scoredAny,
          timeText,
          final: tRow?.group === 'Finals' || heat.raceRoundStage === 2,
          status: tRow?.status ?? (isHeatDone(heat) ? 'finished' : 'on-time'),
          delayMinutes: tRow?.delayMinutes ?? 0,
        });
      });
    }
    return items;
  }, [competition.sessions, team, t]);

  const nextMap = useMemo(
    () => (team ? nextHeats(competition, new Set([team.id])) : new Map()),
    [competition, team],
  );
  const nextState = team ? nextMap.get(team.id) : undefined;

  // Under way: a session is in the arena, or this team's next heat is on now.
  const underWay = competition.sessions.some((s) => s.status === 1) || (nextState?.kind === 'heat' && nextState.row.status === 'live');

  const teamStats = useMemo(
    () => (team ? computeTeamStats(competition.sessions, team.id, (number) => t('teams.team.raceN', { number }), (number) => t('teams.team.heatN', { number })) : null),
    [competition.sessions, team, t],
  );

  const timetableStatusLabel = (status: TimetableStatus, delayMinutes: number) => (status === 'finished' ? t('common.finished')
    : status === 'live' ? t('teams.team.onNow')
      : status === 'late' ? `+${formatDelayDuration(delayMinutes)}` : t('teams.team.onTime'));

  useCompactPageBar({
    backTo: fallbackBackPath,
    backLabel: t('common.back'),
    title: team?.displayName ?? t('teams.team.title'),
    subtitle: [sectionLabel, competition.name].filter(Boolean).join(' · '),
    badge: nextState?.kind === 'heat' && nextState.row.status === 'live' ? 'live' : nextState?.kind === 'done' ? 'finished' : 'next',
  });
  usePageHeader({
    title: team?.displayName ?? t('teams.team.title'),
    subtitle: [sectionLabel, competition.name].filter(Boolean).join(' · '),
    backTo: `/competitions/${competition.id}/teams`,
    backLabel: t('teams.team.teams'),
  });

  if (!team) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pt-3">
        <button type="button" onClick={goBack} className="sr-only">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> {t('common.back')}
        </button>
        <div className="mg-card p-4 text-sm text-[rgb(var(--mg-muted))]">{t('teams.team.notFound')}</div>
      </div>
    );
  }

  const isFollowed = favourites.some((item) => item.competitionId === competition.id && item.teamId === team.id);
  const rawBib = team.bibDescription || team.bibColour || '';
  const parsedBib = parseBibAndFlag(rawBib);
  const detail = list?.detail.get(team.id) ?? null;
  const toplistRow = list?.rows.find((r) => r.teamId === team.id) ?? null;
  const hcRow = list?.hc.find((r) => r.teamId === team.id) ?? null;
  const placed = !team.isHorsConcours && !!toplistRow && !!list?.started;
  const placeText = team.isHorsConcours ? t('teams.team.horsConcoursLower')
    : toplistRow && list?.started ? `${toplistRow.joint ? '=' : ''}${ordinal(toplistRow.position)}` : t('teams.team.notPlaced');
  const pointsText = formatPoints(toplistRow?.points ?? hcRow?.points ?? detail?.qualifyingPoints ?? 0);
  const racesLeft = toplistRow?.racesLeft ?? hcRow?.racesLeft ?? 0;
  const row = 'flex items-baseline gap-3 border-t border-[rgb(var(--mg-rule-soft))] px-4 py-2.5 text-[15.5px] leading-snug first:border-t-0';
  const heading = 'mg-display px-0.5 text-[15px] font-bold uppercase leading-tight tracking-[0.05em] text-[rgb(var(--mg-heading))]';

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pt-3">
      <button type="button" onClick={goBack} className="sr-only">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> {t('common.back')}
      </button>

      {/* The team: name with the follow star, then the plain facts */}
      <section aria-label={t('teams.team.summary')} className="flex flex-col gap-3">
        <div className="mg-card">
          <div className="flex items-start gap-2 pb-0 pl-4 pr-2 pt-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="mg-h1 flex items-center gap-2.5">
                {parsedBib.flag && <img src={`/flags/${parsedBib.flag}.png`} alt="" className="h-6 w-9 shrink-0 rounded-sm object-cover" />}
                <span>{team.displayName}</span>
              </h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-[rgb(var(--mg-muted))]">
                <span>{[sectionLabel, clubLabel(team.clubName)].filter(Boolean).join(' · ')}</span>
                {team.isHorsConcours && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    <Ban aria-hidden="true" className="h-3 w-3" /> {t('teams.team.horsConcours')}
                  </span>
                )}
                {team.isWithdrawn && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    {t('teams.withdrawn')}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]"
              aria-pressed={isFollowed}
              aria-label={t(isFollowed ? 'teams.unfollow' : 'teams.follow', { name: team.displayName })}
              onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}
            >
              <FollowStar on={isFollowed} className="h-[26px] w-[26px]" />
            </button>
          </div>
          {/* Place, points, bibs and races left on one line under the name */}
          <p className="m-0 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 px-4 pb-3.5 pt-1">
            {placed
              ? <b className="mg-display text-[26px] font-bold leading-none text-[rgb(var(--mg-heading))]">{placeText}</b>
              : <span className="text-sm font-medium text-[rgb(var(--mg-muted))]">{placeText}</span>}
            <b className="mg-display text-[26px] font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{pointsText}<small className="ml-[3px] font-[var(--mg-font)] text-sm font-semibold text-[rgb(var(--mg-muted))]">{t('teams.team.ptsUnit')}</small></b>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[rgb(var(--mg-muted))]">
              {parsedBib.bib
                ? <><span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px]" style={{ background: dotColour(parsedBib.bib), boxShadow: '0 0 0 1px rgb(var(--mg-rule))' }} />{/\bbibs?\b/i.test(parsedBib.bib) ? parsedBib.bib : t('teams.team.bibsOf', { colour: parsedBib.bib })}</>
                : t('teams.team.noBib')}
            </span>
            <span className="text-sm font-medium text-[rgb(var(--mg-muted))]">{racesLeft > 0 ? t('competition.toplist.racesLeft', { count: racesLeft }) : t('teams.team.noRacesLeft')}</span>
          </p>
        </div>

      </section>

      {/* Where the team is next: shown first when there are no stats yet or the event is under way */}
      {nextState?.kind === 'heat' && (!teamStats || underWay) && (() => {
        const { row: nextRow } = nextState;
        const lane = drawnHeats.find((d) => d.heat.id === nextRow.heat?.id)?.lane ?? nextState.lane;
        const arena = nextRow.session.arenaName?.trim();
        const isFinal = nextRow.group === 'Finals' || nextRow.heat?.raceRoundStage === 2;
        const live = nextRow.status === 'live';
        return (
          <section aria-labelledby="team-next-title" className="flex flex-col gap-2">
            <h2 id="team-next-title" className={heading}>{live ? t('teams.team.onNow') : t('teams.team.nextHeat')}</h2>
            <div className="mg-card flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-base font-semibold leading-tight text-[rgb(var(--mg-ink))]">
                  {nextRow.session.name} · {heatName(nextRow)}{isFinal ? '' : ` · ${t('teams.team.lane', { number: lane })}`}
                </span>
                <span className="text-[13.5px] leading-tight text-[rgb(var(--mg-muted))]">
                  {arena || t('teams.team.arenaTbc')}
                </span>
              </div>
              <span className="mg-display shrink-0 text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">{formatTime(nextRow.effective)}</span>
            </div>
          </section>
        );
      })()}

      {/* One Heats list: a heat shows its lane, a final doesn't (final lanes come from the rankings) */}
      <section aria-labelledby="team-heats-title" className="flex flex-col gap-2">
        <h2 id="team-heats-title" className={heading}>{t('teams.team.heats')}</h2>
        {drawnHeats.length === 0 ? (
          <p className="mg-card p-4 text-[15px] text-[rgb(var(--mg-muted))]">{nextState?.kind === 'done' ? t('teams.team.allHeatsDone') : t('teams.team.noHeats')}</p>
        ) : (
          <ul className="mg-card divide-y divide-[rgb(var(--mg-rule-soft))] overflow-hidden">
            {drawnHeats.map(({ session, orderedHeats, heat, heatLabel, lane, points, scoredAny, timeText, final, status, delayMinutes }) => {
              const open = openHeatId === heat.id;
              const panelId = `team-heat-${heat.id}`;
              return (
                <li key={heat.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenHeatId(open ? null : heat.id)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[rgb(var(--mg-subtle))]"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-base font-semibold leading-tight text-[rgb(var(--mg-ink))]">
                        {session.name} · {heatLabel}{final ? '' : ` · ${t('teams.team.lane', { number: lane })}`}
                      </span>
                      <span className="text-[13.5px] leading-tight text-[rgb(var(--mg-muted))]">
                        {[session.arenaName?.trim(), timeText].filter(Boolean).join(' · ') || t('teams.team.timetable')}
                      </span>
                    </div>
                    {scoredAny && <span className="mg-display shrink-0 text-lg font-bold tabular-nums text-[rgb(var(--mg-heading))]">{t('teams.team.pts', { points: formatPoints(points) })}</span>}
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TIMETABLE_COLOURS[status] }} aria-hidden="true" />
                    <span className="sr-only">{timetableStatusLabel(status, delayMinutes)}</span>
                    <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 text-[rgb(var(--mg-dash))] transition-transform duration-200 motion-reduce:transition-none [html[data-lite=true]_&]:transition-none ${open ? 'rotate-90' : ''}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        key="panel"
                        id={panelId}
                        role="region"
                        aria-label={t('teams.team.heatScores', { heat: `${session.name} ${heatLabel}` })}
                        initial={still ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={still ? undefined : { height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-surface))]">
                          <HeatScores session={session} heats={orderedHeats} activeHeatId={heat.id} embedded bare ignoreUrlHeat highlightTeamId={team.id} />
                          <div className="flex justify-end px-4 pb-3 pt-1">
                            <Link
                              to={`/competitions/${competition.id}/session/${session.id}?heat=${heat.id}`}
                              className="mg-text-link inline-flex min-h-11 items-center gap-1 text-sm font-semibold"
                            >
                              {t('teams.team.fullSession')}
                              <ChevronRight aria-hidden="true" className="h-4 w-4" />
                            </Link>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Two facts and a way in to the rest, worked out from the races scored so far */}
      <section aria-labelledby="team-stats-title" className="flex flex-col gap-2">
        <h2 id="team-stats-title" className={heading}>{t('teams.team.stats')}</h2>
        {teamStats ? (
          <div className="mg-card overflow-hidden">
            <dl className="m-0">
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.team.avgPerRace')}</dt><dd className="m-0 min-w-0 flex-1">{t('teams.team.pts', { points: teamStats.avgPointsPerRace.toFixed(1) })}</dd></div>
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.team.avgPlace')}</dt><dd className="m-0 min-w-0 flex-1">{teamStats.avgPlace != null ? teamStats.avgPlace.toFixed(1) : '—'}</dd></div>
            </dl>
            <Link to={`/competitions/${competition.id}/teams/${team.id}/stats`} state={{ mgTransition: 'push' }} className="flex min-h-12 items-center justify-between gap-2 border-t border-[rgb(var(--mg-rule-soft))] px-4 text-base font-bold text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]">
              {t('teams.team.seeAllStats')}
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[rgb(var(--mg-dash))]" />
            </Link>
          </div>
        ) : (
          <p className="mg-card p-4 text-[15px] leading-snug text-[rgb(var(--mg-body))]">{t('teams.team.statsLater', { name: team.displayName })}</p>
        )}
      </section>

      {/* Full Race-by-Race Breakdown */}
      {detail && detail.blocks.length > 0 && (
        <section aria-label={t('teams.team.breakdown')} className="mg-card flex flex-col gap-4 p-4">
          <h2 className="mg-display text-base font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
            {t('teams.team.breakdown')}
          </h2>
          {detail.blocks.map((block) => <BreakdownBlock key={block.key} block={block} />)}
        </section>
      )}
      {matchedProfile && (
        <section aria-labelledby="team-season-heading" className="mg-card flex flex-col gap-2.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="team-season-heading" className="mg-h2">{t('teams.team.season')}</h2>
            <Link to={`/team-profiles/${matchedProfile.id}`} className="text-xs font-semibold text-[rgb(var(--mg-heading))] hover:underline">
              {t('teams.team.fullHistory')}
            </Link>
          </div>
          {profileHistory && profileHistory.publishedResults.length > 0 ? (
            <ul className="divide-y divide-[rgb(var(--mg-rule-soft))] text-sm">
              {profileHistory.publishedResults.slice(0, 4).map((res) => (
                <li key={`${res.seasonId}-${res.roundId}`} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate font-medium text-[rgb(var(--mg-ink))]">{res.competitionName}</span>
                  <span className="shrink-0 font-semibold text-[rgb(var(--mg-heading))]">
                    {ordinal(res.eventRank)} · {t('teams.team.pts', { points: res.seasonPoints })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[rgb(var(--mg-muted))]">
              {t('teams.team.viewProfile', { name: matchedProfile.displayName })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function BreakdownBlock({ block }: { block: TeamBlock }) {
  const t = useT();
  const accent = block.kind === 'final' ? 'var(--mg-red)' : 'var(--mg-heading)';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 border-b-[1.5px] pb-1" style={{ borderColor: `rgb(${accent})` }}>
        <h3 className="mg-display flex-1 text-[13px] font-bold uppercase leading-none tracking-[0.05em]" style={{ color: `rgb(${accent})` }}>
          {block.label}
        </h3>
        {block.note && <span className="text-[11px] font-medium text-[rgb(var(--mg-muted))]">{block.note}</span>}
        <span className="mg-display text-lg font-bold leading-none text-[rgb(var(--mg-heading))]">
          {block.points == null ? '–' : formatPoints(block.points)}
        </span>
      </div>
      {block.points == null ? (
        <p className="text-xs font-medium text-[rgb(var(--mg-faint))]">{t('teams.team.didntRide')}</p>
      ) : block.races.length === 0 ? (
        <p className="text-xs font-medium text-[rgb(var(--mg-faint))]">{t('teams.team.notRidden')}</p>
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-[rgb(var(--mg-rule))]">
          {block.races.map((race) => (
            <li key={race.id} className="flex min-h-10 items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-3 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{race.name}</span>
              <span className="shrink-0 text-[13px] font-medium text-[rgb(var(--mg-body))]">
                {race.eliminated
                  ? <><span aria-hidden="true" title={resultStatusLabel(t, true, race.status) ?? undefined}>{statusLetter(true, race.status)}</span><span className="sr-only">{resultStatusLabel(t, true, race.status)}</span></>
                  : race.placing != null ? ordinal(race.placing) : '–'}
              </span>
              <span className="mg-display w-9 shrink-0 text-right text-lg font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">
                {formatPoints(race.points)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CompetitionTeamPage;
