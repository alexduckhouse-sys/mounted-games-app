import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Calendar, ChevronRight, Shield, Star, Trophy, Users } from 'lucide-react';
import { api } from '../../api';
import { useCompactPageBar } from '../../components/CompactPageBarContext';
import { useFavourites } from '../../hooks/useFavourites';
import { heightText } from '../../lib/decForm';
import { arenaNames, arenaToShow, heatName, nextHeats } from '../../lib/following';
import { displaySectionName } from '../../lib/section';
import { formatTime } from '../../lib/time';
import { sessionOrdinals } from '../../lib/timetableRows';
import { buildToplist, ordinal } from '../../lib/toplist';
import type { DeclarationForm, StandingRow } from '../../types';
import type { TeamProfile, TeamProfileHistory } from '../seasons/teamProfileTypes';
import { useCompetition } from './context';
import { HeatScores } from './HeatScores';
import { formatPoints } from '../../lib/formatPoints';
import { publicRiderName } from '../../lib/riderNames';
import { statsProfileHref } from '../../lib/stats';
import { StatsSubjectKind } from '../../types';


export function CompetitionTeamPage() {
  const { teamId: teamIdParam } = useParams<{ teamId: string }>();
  const teamId = Number(teamIdParam);
  const { competition } = useCompetition();
  const favHook = useFavourites();
  const isFav = useMemo(
    () => (favHook.favourites ?? []).some((f) => f.competitionId === competition.id && f.teamId === teamId),
    [favHook.favourites, competition.id, teamId],
  );

  const team = useMemo(
    () => competition.teams.find((t) => t.id === teamId) ?? null,
    [competition.teams, teamId],
  );
  const section = useMemo(
    () => (team ? competition.sections.find((s) => s.id === team.competitionSectionId) ?? null : null),
    [competition.sections, team],
  );

  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [declarations, setDeclarations] = useState<DeclarationForm[]>([]);
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
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => { if (!cancelled && Array.isArray(r.data)) setDeclarations(r.data); })
      .catch(() => { if (!cancelled) setDeclarations([]); });
    return () => { cancelled = true; };
  }, [competition.id]);

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

  const toplist = useMemo(() => {
    if (!team) return null;
    return buildToplist(standings, competition.sessions, competition.teams, team.competitionSectionId, section?.finalistCount);
  }, [standings, competition.sessions, competition.teams, team, section?.finalistCount]);

  const myRow = useMemo(
    () => (toplist && team ? toplist.rows.find((r) => r.teamId === team.id) ?? null : null),
    [toplist, team],
  );
  const myHc = useMemo(
    () => (toplist && team ? toplist.hc.find((r) => r.teamId === team.id) ?? null : null),
    [toplist, team],
  );

  const nextMap = useMemo(
    () => (team ? nextHeats(competition, new Set([team.id])) : new Map()),
    [competition, team],
  );
  const nextState = team ? nextMap.get(team.id) : undefined;
  const ordinals = useMemo(() => sessionOrdinals(competition.sessions), [competition.sessions]);
  const arenas = useMemo(() => arenaNames(competition.sessions), [competition.sessions]);

  const teamHeats = useMemo(() => {
    if (!team) return [];
    const items: { key: string; session: typeof competition.sessions[number]; heats: typeof competition.sessions[number]['heats']; activeHeatId: number }[] = [];
    const orderedSessions = competition.sessions
      .filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    for (const s of orderedSessions) {
      const orderedHeats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      const matching = orderedHeats.filter(
        (h) => h.entries.some((e) => e.teamId === team.id) || h.races.some((r) => r.results.some((res) => res.teamId === team.id)),
      );
      if (matching.length === 0) continue;
      const isRaceFinals = orderedHeats.some((h) => Boolean(h.raceRoundStage) && h.raceRoundId != null);
      if (isRaceFinals) {
        items.push({ key: `session-${s.id}`, session: s, heats: orderedHeats, activeHeatId: matching[0].id });
      } else {
        for (const h of matching) {
          items.push({ key: `heat-${h.id}`, session: s, heats: orderedHeats, activeHeatId: h.id });
        }
      }
    }
    return items;
  }, [competition.sessions, team]);

  const declaration = useMemo(
    () => (team ? declarations.find((d) => d.teamId === team.id) ?? null : null),
    [declarations, team],
  );

  const sectionLabel = displaySectionName(team?.sectionName ?? section?.displayName);
  useCompactPageBar({
    backTo: `/competitions/${competition.id}`,
    title: team?.displayName ?? 'Team',
    subtitle: [sectionLabel, competition.name].filter(Boolean).join(' · '),
    badge: nextState?.kind === 'heat' && nextState.row.status === 'live' ? 'live' : nextState?.kind === 'done' ? 'finished' : 'next',
  });

  if (!team) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
        <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">Team not found in this competition.</p>
        <Link to={`/competitions/${competition.id}`} className="mg-btn mg-btn-secondary">Back to competition</Link>
      </div>
    );
  }

  const bibText = team.bibColour?.trim() || team.bibDescription?.trim() || declaration?.bibDescription?.trim() || null;
  const rankText = myRow
    ? toplist?.started
      ? `${myRow.joint ? '=' : ''}${ordinal(myRow.position)}`
      : '—'
    : myHc
      ? 'HC'
      : '—';
  const totalPoints = myRow ? myRow.points : myHc ? myHc.points : 0;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-4">
      <section aria-label="Team summary" className="mg-card flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">
              {[sectionLabel, team.clubName].filter(Boolean).join(' · ')}
            </p>
            <h1 className="mg-h1 mt-0.5 truncate">{team.displayName}</h1>
            {bibText && (
              <p className="mt-1 text-sm font-medium text-[rgb(var(--mg-body))]">
                Bibs: <span className="font-semibold text-[rgb(var(--mg-ink))]">{bibText}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            aria-pressed={isFav}
            aria-label={`${isFav ? 'Unfollow' : 'Follow'} ${team.displayName}`}
            onClick={() => favHook.toggle({ competitionId: competition.id, teamId: team.id })}
            className="mg-btn mg-btn-secondary shrink-0 !px-3"
          >
            <Star aria-hidden="true" className={`h-4 w-4 ${isFav ? 'fill-[#C08308] text-[#C08308]' : ''}`} />
            <span>{isFav ? 'Following' : 'Follow'}</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-3 py-2.5">
          <div className="flex items-center gap-3">
            <Trophy aria-hidden="true" className="h-5 w-5 text-[rgb(var(--mg-heading))]" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.04em] text-[rgb(var(--mg-muted))]">Current standing</div>
              <div className="mg-display text-lg font-bold text-[rgb(var(--mg-heading))]">
                {rankText} · {formatPoints(totalPoints)} pts
              </div>
            </div>
          </div>
          <Link
            to={`/competitions/${competition.id}/toplists?section=${team.competitionSectionId}`}
            className="text-xs font-semibold text-[rgb(var(--mg-heading))] hover:underline"
          >
            View toplist
          </Link>
        </div>
      </section>

      <section aria-label="Next heat" className="mg-card overflow-hidden">
        {nextState?.kind === 'heat' ? (
          <Link
            to={`/competitions/${competition.id}/session/${nextState.row.session.id}?heat=${nextState.row.heat!.id}`}
            className="flex items-center justify-between gap-3 p-3.5 hover:bg-[rgb(var(--mg-subtle))]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))]">
                  {nextState.row.status === 'live' ? 'In arena now' : 'Next heat'}
                </span>
                {nextState.row.status === 'live' && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-red))]">
                    ON NOW
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-base font-semibold text-[rgb(var(--mg-ink))]">
                {[
                  ordinals.get(nextState.row.session.id) ? `Session ${ordinals.get(nextState.row.session.id)}` : nextState.row.session.name,
                  heatName(nextState.row),
                  `Lane ${nextState.lane}`,
                  arenaToShow(nextState.row.session, arenas),
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="mg-display text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                {formatTime(nextState.row.effective)}
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 text-[rgb(var(--mg-faint))]" />
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-2.5 p-3.5 text-sm text-[rgb(var(--mg-muted))]">
            <Calendar aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{nextState?.kind === 'done' ? 'All heats completed for this team.' : 'Not drawn into any heats yet.'}</span>
          </div>
        )}
      </section>

      <section aria-labelledby="team-heats-heading" className="flex flex-col gap-3">
        <h2 id="team-heats-heading" className="mg-h2 px-1">Heats &amp; scores</h2>
        {teamHeats.length === 0 ? (
          <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">This team has not been placed into any heats yet.</p>
        ) : (
          teamHeats.map((item) => (
            <HeatScores
              key={item.key}
              session={item.session}
              heats={item.heats}
              activeHeatId={item.activeHeatId}
              embedded
            />
          ))
        )}
      </section>

      <section aria-labelledby="team-riders-heading" className="mg-card flex flex-col gap-2.5 p-4">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" className="h-4 w-4 text-[rgb(var(--mg-heading))]" />
          <h2 id="team-riders-heading" className="mg-h2">Declared riders &amp; ponies</h2>
        </div>
        {!declaration || declaration.riders.length === 0 ? (
          <p className="text-sm text-[rgb(var(--mg-muted))]">No declaration submitted for this team yet.</p>
        ) : (
          <ol className="divide-y divide-[rgb(var(--mg-rule-soft))]">
            {declaration.riders
              .slice()
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((rider) => (
                <li key={rider.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-semibold text-[rgb(var(--mg-ink))]">
                    <Link to={statsProfileHref(StatsSubjectKind.Rider, publicRiderName(rider))}>{publicRiderName(rider)}</Link>
                    {rider.isCaptain && (
                      <span className="ml-1.5 rounded bg-[rgb(var(--mg-tint))] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[rgb(var(--mg-heading))]">
                        Capt
                      </span>
                    )}
                    {rider.isReserve && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-800">
                        <Shield aria-hidden="true" className="h-2.5 w-2.5" /> Reserve
                      </span>
                    )}
                    {rider.isGuestRider && (
                      <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                        Guest
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-[rgb(var(--mg-muted))]">
                    {rider.horseName ? <Link to={statsProfileHref(StatsSubjectKind.Pony, rider.horseName)}>{rider.horseName}</Link> : '—'}
                    {rider.ponyHeightHands != null ? ` · ${heightText(rider.ponyHeightHands)} hh` : ''}
                  </span>
                </li>
              ))}
          </ol>
        )}
      </section>

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
export default CompetitionTeamPage;
