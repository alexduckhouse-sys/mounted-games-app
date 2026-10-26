import { useEffect, useMemo, useState } from 'react';
import { FollowStar } from '../../components/FollowStar';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, ChevronRight, ClipboardList, Shield } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStillMotion } from '../../lite/useStillMotion';
import { HeatScores } from './HeatScores';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompactPageBar, usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { useFavourites } from '../../hooks/useFavourites';
import { bibLabel, parseBibAndFlag } from '../../lib/bib';
import { heightText } from '../../lib/decForm';
import { formatPoints } from '../../lib/formatPoints';
import { statusLabel, statusLetter } from '../../lib/resultStatus';
import { displaySectionName } from '../../lib/section';
import { computeTimings } from '../../lib/time';
import { timetableRows, statusLabel as timetableStatusLabel, TIMETABLE_COLOURS, type TimetableStatus } from '../../lib/timetableRows';
import { buildToplist, ordinal, type TeamBlock } from '../../lib/toplist';
import type { DeclarationForm, Heat, Session, StandingRow } from '../../types';
import { useCompetition } from './context';
import { nextHeats } from '../../lib/following';
import { publicRiderName } from '../../lib/riderNames';
import { statsProfileHref } from '../../lib/stats';
import { StatsSubjectKind } from '../../types';
import type { TeamProfile, TeamProfileHistory } from '../seasons/teamProfileTypes';
import { byDrawnLane } from './laneRules';

const isRaceSession = (session: Session) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
const isHeatDone = (heat: Heat) => !!heat.finishedAt || (heat.races.length > 0 && heat.races.every((r) => r.isComplete));

export function CompetitionTeamPage() {
  usePageWidth('wide');
  const { teamId } = useParams<{ teamId: string }>();
  const id = Number(teamId);
  const navigate = useNavigate();
  const location = useLocation();
  const { competition } = useCompetition();
  const { user, token, hasRole, canOrganise } = useAuth();
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
  // A response is visible only for the exact resource and authentication that fetched it.
  const declarationKey = JSON.stringify([competition.id, id, user?.id ?? null, token ?? null, user?.roles ?? [], canOrganise(competition)]);
  const [declarationState, setDeclarationState] = useState<{ key: string; form: DeclarationForm | null } | null>(null);
  const decLoaded = declarationState?.key === declarationKey;
  const decForm = decLoaded ? declarationState.form : null;
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
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id, teamId: team.id } })
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r.data) ? r.data : [];
        setDeclarationState({ key: declarationKey, form: list.find((f) => f.teamId === team.id) ?? null });
      })
      .catch(() => {
        if (!cancelled) {
          setDeclarationState({ key: declarationKey, form: null });
        }
      });
    return () => { cancelled = true; };
  }, [competition.id, team, declarationKey]);

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
          ? tRow.effective.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          : null;
        items.push({
          session,
          orderedHeats,
          heat,
          heatLabel: heat.label?.trim() || `Heat ${idx + 1}`,
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
  }, [competition.sessions, team]);

  const nextMap = useMemo(
    () => (team ? nextHeats(competition, new Set([team.id])) : new Map()),
    [competition, team],
  );
  const nextState = team ? nextMap.get(team.id) : undefined;

  const teamStats = useMemo(() => {
    if (!team) return null;
    let scoredRaces = 0;
    let totalPoints = 0;
    let maxAvailablePoints = 0;
    let placedFinishes = 0;
    let totalPlace = 0;
    let racesWon = 0;
    const byRace = new Map<string, { name: string; runs: number; totalPoints: number; bestPlace: number | null }>();

    const orderedSessions = competition.sessions.filter(isRaceSession).sort((a, b) => a.orderIndex - b.orderIndex);
    for (const session of orderedSessions) {
      const largestHeatSize = Math.max(1, ...session.heats.map((h) => h.entries.length), session.lanesPerHeat ?? 0);
      for (const heat of session.heats) {
        const heatMax = heat.raceRoundStage === 1 ? 1 : Math.max(heat.entries.length, largestHeatSize, 1);
        for (const race of heat.races) {
          if (!race.isComplete && race.results.length === 0) continue;
          const res = race.results.find((item) => item.teamId === team.id && !item.isSitOut);
          if (!res) continue;
          const raceMax = Math.max(heatMax, ...race.results.map((r) => r.points), 1);
          scoredRaces += 1;
          totalPoints += res.points;
          maxAvailablePoints += raceMax;
          if (!res.eliminated && res.placing != null && res.placing > 0) {
            placedFinishes += 1;
            totalPlace += res.placing;
            if (res.placing === 1) racesWon += 1;
          }
          const key = race.name.trim() || `Race ${race.orderIndex + 1}`;
          const existing = byRace.get(key) ?? { name: key, runs: 0, totalPoints: 0, bestPlace: null };
          existing.runs += 1;
          existing.totalPoints += res.points;
          if (!res.eliminated && res.placing != null && res.placing > 0) {
            existing.bestPlace = existing.bestPlace == null ? res.placing : Math.min(existing.bestPlace, res.placing);
          }
          byRace.set(key, existing);
        }
      }
    }

    if (scoredRaces === 0) return null;
    return {
      scoredRaces,
      avgPointsPerRace: totalPoints / scoredRaces,
      avgPlace: placedFinishes > 0 ? totalPlace / placedFinishes : null,
      racesWon,
      pointQuota: maxAvailablePoints > 0 ? Math.round((totalPoints / maxAvailablePoints) * 100) : 0,
      races: [...byRace.values()],
    };
  }, [competition.sessions, team]);

  useCompactPageBar({
    backTo: fallbackBackPath,
    title: team?.displayName ?? 'Team',
    subtitle: [sectionLabel, competition.name].filter(Boolean).join(' · '),
    badge: nextState?.kind === 'heat' && nextState.row.status === 'live' ? 'live' : nextState?.kind === 'done' ? 'finished' : 'next',
  });
  usePageHeader({
    title: team?.displayName ?? 'Team',
    subtitle: [sectionLabel, competition.name].filter(Boolean).join(' · '),
    backTo: `/competitions/${competition.id}/teams`,
    backLabel: 'Teams',
  });

  if (!team) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pt-3">
        <button type="button" onClick={goBack} className="sr-only">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
        </button>
        <div className="mg-card p-4 text-sm text-[rgb(var(--mg-muted))]">Team not found in this competition.</div>
      </div>
    );
  }

  const isFollowed = favourites.some((item) => item.competitionId === competition.id && item.teamId === team.id);
  const canDeclare = hasRole('Admin') || canOrganise(competition) || (
    user != null && (team.trainerUserId === user.id || (hasRole('Manager') && user.clubId != null && user.clubId === team.clubId))
  );

  const rawBib = decForm?.bibDescription || team.bibDescription || team.bibColour || '';
  const parsedBib = parseBibAndFlag(rawBib);
  const detail = list?.detail.get(team.id) ?? null;
  const toplistRow = list?.rows.find((r) => r.teamId === team.id) ?? null;
  const hcRow = list?.hc.find((r) => r.teamId === team.id) ?? null;
  const placeText = team.isHorsConcours ? 'Hors concours'
    : toplistRow && list?.started ? `${toplistRow.joint ? '=' : ''}${ordinal(toplistRow.position)}` : 'Not placed yet';
  const pointsText = formatPoints(toplistRow?.points ?? hcRow?.points ?? detail?.qualifyingPoints ?? 0);
  const racesLeft = toplistRow?.racesLeft ?? hcRow?.racesLeft ?? 0;
  const orderedRiders = decForm ? [...decForm.riders].sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const trainerDisplay = decForm?.trainerName ?? decForm?.submittedByName ?? team.trainerName ?? null;
  const row = 'flex items-baseline gap-3 border-t border-[rgb(var(--mg-rule-soft))] px-4 py-2.5 text-[15.5px] leading-snug first:border-t-0';
  const heading = 'mg-display px-0.5 text-[15px] font-bold uppercase leading-tight tracking-[0.05em] text-[rgb(var(--mg-heading))]';
  const decLink = canDeclare && (
    <Link to={`/competitions/${competition.id}/declarations?team=${team.id}`} className="mg-btn mg-btn-secondary !min-h-10 !px-3 !text-sm">
      <ClipboardList aria-hidden="true" className="h-4 w-4" />
      {decForm ? 'Edit dec form' : 'Submit dec form'}
    </Link>
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pt-3">
      <button type="button" onClick={goBack} className="sr-only">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
      </button>

      {/* The team: name with the follow star, then the plain facts */}
      <section aria-label="Team summary" className="flex flex-col gap-3">
        <div className="mg-card flex items-start gap-2 py-3.5 pl-4 pr-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="mg-h1 flex items-center gap-2.5">
              {parsedBib.flag && <img src={`/flags/${parsedBib.flag}.png`} alt="" className="h-6 w-9 shrink-0 rounded-sm object-cover" />}
              <span>{team.displayName}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-[rgb(var(--mg-muted))]">
              <span>{[sectionLabel, team.clubName].filter(Boolean).join(' · ')}</span>
              {team.isHorsConcours && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  <Ban aria-hidden="true" className="h-3 w-3" /> Hors Concours
                </span>
              )}
              {team.isWithdrawn && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  Withdrawn
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]"
            aria-pressed={isFollowed}
            aria-label={`${isFollowed ? 'Unfollow' : 'Follow'} ${team.displayName}`}
            onClick={() => toggle({ competitionId: competition.id, teamId: team.id })}
          >
            <FollowStar on={isFollowed} className="h-[26px] w-[26px]" />
          </button>
        </div>
        <dl className="mg-card m-0 overflow-hidden">
          <div className={row}><dt className="w-24 shrink-0 text-[rgb(var(--mg-muted))]">Bibs</dt><dd className="m-0 min-w-0 flex-1">{bibLabel(rawBib)}</dd></div>
          <div className={row}><dt className="w-24 shrink-0 text-[rgb(var(--mg-muted))]">Place</dt><dd className="m-0 min-w-0 flex-1">{placeText}</dd></div>
          <div className={row}><dt className="w-24 shrink-0 text-[rgb(var(--mg-muted))]">Points</dt><dd className="m-0 min-w-0 flex-1">{pointsText}</dd></div>
          <div className={row}><dt className="w-24 shrink-0 text-[rgb(var(--mg-muted))]">Races left</dt><dd className="m-0 min-w-0 flex-1">{racesLeft}</dd></div>
        </dl>
      </section>

      {/* One Heats list: a heat shows its lane, a final doesn't (final lanes come from the rankings) */}
      <section aria-labelledby="team-heats-title" className="flex flex-col gap-2">
        <h2 id="team-heats-title" className={heading}>Heats</h2>
        {drawnHeats.length === 0 ? (
          <p className="mg-card p-4 text-[15px] text-[rgb(var(--mg-muted))]">{nextState?.kind === 'done' ? 'All heats completed for this team.' : 'Not drawn into any heats yet.'}</p>
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
                        {session.name} · {heatLabel}{final ? '' : ` · Lane ${lane}`}
                      </span>
                      <span className="text-[13.5px] leading-tight text-[rgb(var(--mg-muted))]">
                        {[session.arenaName?.trim(), timeText].filter(Boolean).join(' · ') || 'Timetable'}
                      </span>
                    </div>
                    {scoredAny && <span className="mg-display shrink-0 text-lg font-bold tabular-nums text-[rgb(var(--mg-heading))]">{formatPoints(points)} pts</span>}
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
                        aria-label={`${session.name} ${heatLabel} scores`}
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
                              Open full session view
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

      {/* Stats, worked out from the races scored so far */}
      <section aria-labelledby="team-stats-title" className="flex flex-col gap-2">
        <h2 id="team-stats-title" className={heading}>Stats</h2>
        {teamStats ? (
          <>
            <dl className="mg-card m-0 overflow-hidden">
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">Average per race</dt><dd className="m-0 min-w-0 flex-1">{teamStats.avgPointsPerRace.toFixed(1)} pts</dd></div>
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">Average place</dt><dd className="m-0 min-w-0 flex-1">{teamStats.avgPlace != null ? teamStats.avgPlace.toFixed(1) : '—'}</dd></div>
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">Races won</dt><dd className="m-0 min-w-0 flex-1">{teamStats.racesWon} of {teamStats.scoredRaces}</dd></div>
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">Point quota</dt><dd className="m-0 min-w-0 flex-1">{teamStats.pointQuota}%</dd></div>
            </dl>
            {teamStats.races.length > 0 && (
              <>
                <h3 className={`${heading} pt-3`}>By race</h3>
                <ul className="mg-card divide-y divide-[rgb(var(--mg-rule-soft))] overflow-hidden">
                  {teamStats.races.map((r) => (
                    <li key={r.name} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[15px] font-semibold leading-tight text-[rgb(var(--mg-ink))]">{r.name}</span>
                        <span className="text-[13.5px] leading-tight text-[rgb(var(--mg-muted))]">
                          {r.runs} {r.runs === 1 ? 'run' : 'runs'} · best {r.bestPlace != null ? ordinal(r.bestPlace) : '—'} · average {(r.totalPoints / r.runs).toFixed(1)} pts
                        </span>
                      </div>
                      <span className="mg-display shrink-0 text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">{formatPoints(r.totalPoints)} pts</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="mg-card p-4 text-[15px] leading-snug text-[rgb(var(--mg-body))]">Stats show once {team.displayName} has raced.</p>
        )}
      </section>

      {/* Declared Riders & Ponies */}
      <section aria-label="Declared riders and ponies" className="mg-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--mg-rule))] px-4 py-2.5">
          <h2 className={`${heading} !px-0`}>Dec form</h2>
          {decLink || (decForm && <span className="text-xs font-medium text-[rgb(var(--mg-muted))]">{orderedRiders.length} declared</span>)}
        </div>
        {trainerDisplay && <p className="border-b border-[rgb(var(--mg-rule-soft))] px-4 py-2 text-sm text-[rgb(var(--mg-muted))]">Trainer: <strong className="font-semibold text-[rgb(var(--mg-ink))]">{trainerDisplay}</strong></p>}
        {!decLoaded ? (
          <p className="p-4 text-sm text-[rgb(var(--mg-muted))]">Loading declaration…</p>
        ) : orderedRiders.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-[rgb(var(--mg-muted))]">
            <span>No dec form yet.</span>
          </div>
        ) : (
          <ol className="divide-y divide-[rgb(var(--mg-rule-soft))]">
            {orderedRiders.map((rider, index) => (
              <li key={rider.id} className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="mg-display w-5 shrink-0 text-sm font-bold text-[rgb(var(--mg-muted))]">
                    {rider.isReserve ? 'R' : index + 1}
                  </span>
                  <span className="truncate text-[15px] font-semibold text-[rgb(var(--mg-ink))]"><Link to={statsProfileHref(StatsSubjectKind.Rider, publicRiderName(rider))}>{publicRiderName(rider)}</Link></span>
                  {rider.isCaptain && <span className="mg-badge mg-badge-outline !h-5">Captain</span>}
                  {rider.isReserve && (
                    <span className="mg-badge mg-badge-outline !h-5 inline-flex items-center gap-1">
                      <Shield aria-hidden="true" className="h-3 w-3" /> Reserve
                    </span>
                  )}
                  {rider.isGuestRider && <span className="mg-badge mg-badge-outline !h-5">Guest</span>}
                </div>
                <div className="text-sm font-medium text-[rgb(var(--mg-body))]">
                  {rider.isReserve && !rider.horseName
                    ? <span className="text-xs text-[rgb(var(--mg-muted))]">Non-riding reserve</span>
                    : <>{rider.horseName ? <Link to={statsProfileHref(StatsSubjectKind.Pony, rider.horseName)}>{rider.horseName}</Link> : '—'}{rider.ponyHeightHands != null ? ` · ${heightText(rider.ponyHeightHands)} hh` : ''}</>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Full Race-by-Race Breakdown */}
      {detail && detail.blocks.length > 0 && (
        <section aria-label="Race-by-race breakdown" className="mg-card flex flex-col gap-4 p-4">
          <h2 className="mg-display text-base font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
            Race-by-race breakdown
          </h2>
          {detail.blocks.map((block) => <BreakdownBlock key={block.key} block={block} />)}
        </section>
      )}
      {matchedProfile && (
        <section aria-labelledby="team-season-heading" className="mg-card flex flex-col gap-2.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="team-season-heading" className="mg-h2">Season &amp; past competitions</h2>
            <Link to={`/team-profiles/${matchedProfile.id}`} className="text-xs font-semibold text-[rgb(var(--mg-heading))] hover:underline">
              Full history
            </Link>
          </div>
          {profileHistory && profileHistory.publishedResults.length > 0 ? (
            <ul className="divide-y divide-[rgb(var(--mg-rule-soft))] text-sm">
              {profileHistory.publishedResults.slice(0, 4).map((res) => (
                <li key={`${res.seasonId}-${res.roundId}`} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate font-medium text-[rgb(var(--mg-ink))]">{res.competitionName}</span>
                  <span className="shrink-0 font-semibold text-[rgb(var(--mg-heading))]">
                    {ordinal(res.eventRank)} · {res.seasonPoints} pts
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[rgb(var(--mg-muted))]">
              View {matchedProfile.displayName}’s season profile and past competition results.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function BreakdownBlock({ block }: { block: TeamBlock }) {
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
        <p className="text-xs font-medium text-[rgb(var(--mg-faint))]">Didn’t ride this session</p>
      ) : block.races.length === 0 ? (
        <p className="text-xs font-medium text-[rgb(var(--mg-faint))]">Not ridden yet</p>
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-[rgb(var(--mg-rule))]">
          {block.races.map((race) => (
            <li key={race.id} className="flex min-h-10 items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-3 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{race.name}</span>
              <span className="shrink-0 text-[13px] font-medium text-[rgb(var(--mg-body))]">
                {race.eliminated
                  ? <><span aria-hidden="true" title={statusLabel(true, race.status) ?? undefined}>{statusLetter(true, race.status)}</span><span className="sr-only">{statusLabel(true, race.status)}</span></>
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
