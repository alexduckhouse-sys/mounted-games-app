import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mic, Monitor, Radio, Trophy, Users } from 'lucide-react';
import { api } from '../../api';
import { BibSwatch } from '../../components/BibSwatch';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { formatPoints } from '../../lib/formatPoints';
import { statusLetter } from '../../lib/resultStatus';
import { publicRiderName } from '../../lib/riderNames';
import { displaySectionName } from '../../lib/section';
import { buildToplist, ordinal, sectionScoreVersion } from '../../lib/toplist';
import { useLiveHub } from '../../live/useLiveHub';
import type { DeclarationForm, Heat, Session, StandingRow, Team } from '../../types';
import { useCompetition } from './context';

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
  const { competition, reload } = useCompetition();
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

  const bumpRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
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
    title: 'PA Commentator Desk',
    subtitle: competition.name,
    backTo: `/competitions/${competition.id}/scoring${sectionId != null ? `?section=${sectionId}` : ''}`,
    backLabel: 'Back to scoring',
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
  const sectionName = displaySectionName(section?.displayName) || 'Section';

  const teamById = useMemo(() => {
    const map = new Map<number, Team>();
    for (const t of competition.teams) map.set(t.id, t);
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

  const standingByTeamId = useMemo(() => {
    const map = new Map<number, StandingRow>();
    for (const row of standings) map.set(row.teamId, row);
    return map;
  }, [standings]);

  const toplist = useMemo(
    () => buildToplist(standings, competition.sessions, competition.teams, sectionId ?? -1, section?.finalistCount),
    [standings, competition.sessions, competition.teams, sectionId, section?.finalistCount],
  );

  // Compute last race result per team in this section
  const lastRaceByTeamId = useMemo(() => {
    const map = new Map<number, string>();
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
              ? 'Sat out'
              : res.eliminated
                ? (statusLetter(true, res.status) ?? 'E')
                : res.placing != null
                  ? ordinal(res.placing)
                  : 'Scored';
            map.set(res.teamId, `${placeText} in ${r.name} (${formatPoints(res.points)} pts)`);
          }
        }
      }
    }
    return map;
  }, [competition.sessions, sectionId]);

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
            label: `${s.name} · ${h.label || `Heat ${idx + 1}`}`,
          });
        }
      });
    }
    return list;
  }, [competition.sessions, sectionId]);

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
          ? 'Leader'
          : idx < cutoffPlaces
            ? `−${formatPoints(gapToFirst)} pts to 1st · Top ${cutoffPlaces}`
            : `−${formatPoints(gapToFirst)} to 1st · −${formatPoints(gapToCutoff)} to Top ${cutoffPlaces}`;

        return {
          teamId: row.teamId,
          rank: row.position,
          rankLabel: toplist.started ? `${ordinal(row.position)}${row.joint ? '=' : ''}` : ordinal(idx + 1),
          bibColour: team?.bibColour ?? st?.bibColour ?? null,
          teamName: row.teamName,
          clubName: team?.clubName ?? st?.clubName ?? '',
          trainerName: dec?.trainerName?.trim() || team?.trainerName?.trim() || null,
          riders,
          totalPoints: row.points,
          wins: st?.wins ?? 0,
          gapLabel,
        };
      });
    }

    const sectionTeams = competition.teams
      .filter((t) => (sectionId == null || t.competitionSectionId === sectionId) && !t.isHorsConcours)
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return sectionTeams.map((t, idx) => {
      const dec = decByTeamId.get(t.id);
      const riders = (dec?.riders ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
      return {
        teamId: t.id,
        rank: idx + 1,
        rankLabel: ordinal(idx + 1),
        bibColour: t.bibColour ?? null,
        teamName: t.displayName,
        clubName: t.clubName,
        trainerName: dec?.trainerName?.trim() || t.trainerName?.trim() || null,
        riders,
        totalPoints: 0,
        wins: 0,
        gapLabel: '0 pts',
      };
    });
  }, [toplist, section?.finalistCount, teamById, standingByTeamId, decByTeamId, competition.teams, sectionId]);

  const rankByTeamId = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of orderedStandings) {
      map.set(row.teamId, row.rankLabel);
    }
    return map;
  }, [orderedStandings]);

  return (
    <div className="mx-auto flex w-full flex-col gap-4 py-3">
      {standingsStale && <p role="status">{standings.length ? 'Showing saved standings while results refresh.' : 'Waiting for official standings.'}</p>}
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
              {connected ? 'Live PA Feed' : 'Standby'}
            </span>
            <h1 className="mg-display m-0 text-xl font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))] sm:text-2xl">
              <Mic className="mr-1.5 inline h-5 w-5 align-text-bottom" aria-hidden="true" />
              PA Commentator Desk · {sectionName}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {competition.sections.length > 1 && (
              <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
                <span>Section</span>
                <select
                  aria-label="Section filter"
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
            )}

            <Link
              to={`/competitions/${competition.id}/tv${sectionId != null ? `?section=${sectionId}` : ''}`}
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
            >
              <Monitor className="h-4 w-4" aria-hidden="true" /> TV Kiosk
            </Link>
            <Link
              to={`/competitions/${competition.id}/scoring${sectionId != null ? `?section=${sectionId}` : ''}`}
              className="mg-btn mg-btn-secondary !min-h-10 !px-3 text-xs font-bold"
            >
              Scoring
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="mg-seg" role="group" aria-label="Commentary desk view">
            <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}>
              Side-by-Side
            </button>
            <button type="button" aria-pressed={mode === 'lanes'} onClick={() => setMode('lanes')}>
              Current Heat Lanes
            </button>
            <button type="button" aria-pressed={mode === 'standings'} onClick={() => setMode('standings')}>
              Standings in Order
            </button>
          </div>

          {sectionHeats.length > 1 && (
            <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
              <span>Heat</span>
              <select
                aria-label="Select heat"
                value={activeHeatItem?.heat.id ?? ''}
                onChange={(e) => setSelectedHeatId(Number(e.target.value))}
                className="min-h-9 rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-ground))] px-2 py-1 text-xs font-semibold text-[rgb(var(--mg-ink))]"
              >
                {sectionHeats.map((item) => (
                  <option key={item.heat.id} value={item.heat.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {/* Main Content Grid */}
      <div className={mode === 'split' ? 'grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start' : 'flex flex-col gap-4'}>
        {(mode === 'split' || mode === 'lanes') && (
          <section aria-label="Current Heat — Lanes in Order" className="mg-card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                <h2 className="mg-display m-0 text-lg font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
                  Current Heat — Lanes in Order
                </h2>
              </div>
              {activeHeatItem && (
                <span className="text-xs font-bold text-[rgb(var(--mg-body))]">
                  {activeHeatItem.label}
                </span>
              )}
            </div>

            {!activeHeatItem || activeHeatItem.heat.entries.length === 0 ? (
              <p className="p-4 text-sm text-[rgb(var(--mg-muted))]">No lane draw available for this heat yet.</p>
            ) : (
              <ol className="m-0 divide-y divide-[rgb(var(--mg-rule-soft))] list-none p-0">
                {activeHeatItem.heat.entries
                  .slice()
                  .sort((a, b) => a.laneIndex - b.laneIndex)
                  .map((entry) => {
                    const team = teamById.get(entry.teamId);
                    const st = standingByTeamId.get(entry.teamId);
                    const dec = decByTeamId.get(entry.teamId);
                    const riders = (dec?.riders ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
                    const rankText = rankByTeamId.get(entry.teamId) ?? '—';
                    const ptsText = formatPoints(st?.totalPoints ?? 0);
                    const lastRace = lastRaceByTeamId.get(entry.teamId) ?? 'No completed race yet';

                    return (
                      <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="mg-display shrink-0 rounded bg-[rgb(var(--mg-tint))] px-2 py-0.5 text-base font-bold uppercase text-[rgb(var(--mg-heading))]">
                              Lane {entry.laneIndex}
                            </span>
                            <BibSwatch colour={entry.bibColour ?? team?.bibColour ?? st?.bibColour} />
                            <span className="truncate text-base font-bold text-[rgb(var(--mg-ink))]">
                              {entry.teamName}
                            </span>
                            {team?.clubName && (
                              <span className="truncate text-xs font-medium text-[rgb(var(--mg-muted))]">
                                · {team.clubName}
                              </span>
                            )}
                          </div>
                          <span className="mg-display shrink-0 text-sm font-bold text-[rgb(var(--mg-heading))]">
                            Rank {rankText} · {ptsText} pts
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
                            {team?.trainerName ? `Trainer: ${team.trainerName}` : 'No rider declaration submitted yet'}
                          </p>
                        )}

                        <div className="text-xs font-medium text-[rgb(var(--mg-muted))]">
                          Last race: <span className="font-semibold text-[rgb(var(--mg-body))]">{lastRace}</span>
                        </div>
                      </li>
                    );
                  })}
              </ol>
            )}
          </section>
        )}

        {(mode === 'split' || mode === 'standings') && (
          <section aria-label="Standings — Each Team in Order" className="mg-card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-ground))] px-4 py-3">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                <h2 className="mg-display m-0 text-lg font-bold uppercase tracking-[0.04em] text-[rgb(var(--mg-heading))]">
                  Standings — Each Team in Order
                </h2>
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
                1st to {ordinal(orderedStandings.length || 1)}
              </span>
            </div>

            {orderedStandings.length === 0 ? (
              <p className="p-4 text-sm text-[rgb(var(--mg-muted))]">No teams in this section yet.</p>
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
                          {row.wins} {row.wins === 1 ? '1st' : '1sts'}
                        </span>
                        <span className="mg-display text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">
                          {formatPoints(row.totalPoints)} pts
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
                      <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">Trainer: {row.trainerName}</p>
                    ) : null}

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
    </div>
  );
}
