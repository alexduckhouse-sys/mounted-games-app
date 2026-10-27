import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import { ScoreFlash } from '../../components/ScoreFlash';
import { TickerNumber } from '../../components/TickerNumber';
import { useRankMotion } from '../../hooks/useRankMotion';
import { EASE_OUT } from '../../lib/motion';
import { useCompetition } from './context';
import type { Heat, HeatEntry, Race, Session } from '../../types';
import { computeTimings, formatDelayDuration } from '../../lib/time';
import { displaySectionName } from '../../lib/section';
import { timetableRows } from '../../lib/timetableRows';
import { useCompactPageBar } from '../../components/CompactPageBarContext';
import { RaceRulesButton } from '../../components/RaceRulesButton';
import { parseBibAndFlag } from '../../lib/bib';
import { statusLetter } from '../../lib/resultStatus';
import { useFavourites } from '../../hooks/useFavourites';
import { displayLaneFor, lanesOf, sitsOutOf, type LaneRules } from './laneRules';
import { TeamCardBadge, getStoredCards, parseRefereeCard, useCardsEnabled, type RefereeCard } from './ScoringParts';
import './heat.css';
import { formatPoints } from '../../lib/formatPoints';
import { useLanguage } from '../../i18n/LanguageContext';
import { resultStatusText } from '../../lib/toplistText';

interface Cell {
  points: number;
  eliminated: boolean;
  sitOut: boolean;
  status?: number;
  scored: boolean;
  stageBadge?: string;
}

interface ColumnDef {
  key: string;
  race: Race;
  label: string;
  roundHeats?: Heat[];
}

function HeatScoresPageBar({ backTo, title, subtitle, badge }: {
  backTo: string;
  title: string;
  subtitle: string;
  badge: 'live' | 'finished' | 'next';
}) {
  useCompactPageBar({ backTo, title, subtitle, badge });
  return null;
}

/** The public heat page: who is racing, the score for every race so far and the running total. */
export function HeatScores({ session, heats, activeHeatId, embedded = false, bare = false, ignoreUrlHeat = false, highlightTeamId = null }: {
  session: Session;
  heats: Heat[];
  activeHeatId: number | null;
  embedded?: boolean;
  /** Drop the card around the table, for use inside another card (the team page's heat accordion). */
  bare?: boolean;
  /** Show `activeHeatId` whatever `?heat=` says in the address. */
  ignoreUrlHeat?: boolean;
  /** Tint this team's row and mark it with a bar on the left. */
  highlightTeamId?: number | null;
}) {
  const { t, locale } = useLanguage();
  const { competition, streams } = useCompetition();
  const [showRules, setShowRules] = useState(false);
  const [cardsTick, setCardsTick] = useState(0);
  const [cardsEnabled] = useCardsEnabled(competition.id);

  useEffect(() => {
    function onCards() { setCardsTick((t) => t + 1); }
    window.addEventListener('mg-cards-updated', onCards);
    window.addEventListener('storage', onCards);
    return () => {
      window.removeEventListener('mg-cards-updated', onCards);
      window.removeEventListener('storage', onCards);
    };
  }, []);

  const favHook = useFavourites() as {
    favourites?: { competitionId: number; teamId: number }[];
    isTeamFav?: (compId: number, teamId: number) => boolean;
  };

  const canWatch = !!competition.streamUrl || (streams ?? []).some((stream) => stream.status !== 2);
  // The page can be reached with ?heat=<id> while already mounted (next-heat link), so the URL wins over the parent's initial pick.
  const [searchParams] = useSearchParams();
  const requestedHeat = Number(searchParams.get('heat'));
  const shownHeatId = !ignoreUrlHeat && heats.some((item) => item.id === requestedHeat) ? requestedHeat : activeHeatId;
  const index = Math.max(0, heats.findIndex((item) => item.id === shownHeatId));
  const heat = heats[index] ?? heats[0] ?? null;
  const isRaceFinals = useMemo(
    () => heats.some((item) => Boolean(item.raceRoundStage) && item.raceRoundId != null),
    [heats],
  );
  const nextHeat = !isRaceFinals ? heats[index + 1] ?? null : null;
  const row = useMemo(() => {
    if (!heat) return null;
    return timetableRows(competition.sessions, computeTimings(competition.sessions), true).find((item) => item.heat?.id === heat.id) ?? null;
  }, [competition.sessions, heat]);
  const section = displaySectionName(session.sectionName || session.name);

  // In a Heat-Heat-Final session (raceRoundId present), render ONE unified table for the whole session:
  // all session teams down the side, one column per race (round) across the top.
  const columns: ColumnDef[] = useMemo(() => {
    if (!heat) return [];
    if (isRaceFinals) {
      const ordered = heats.slice().sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
      const byRound = new Map<number, Heat[]>();
      for (const item of ordered) {
        const key = item.raceRoundId ?? item.id;
        const group = byRound.get(key) ?? [];
        group.push(item);
        byRound.set(key, group);
      }
      const cols: ColumnDef[] = [];
      for (const [roundId, group] of byRound) {
        const allRaces = group.flatMap((h) => h.races.slice().sort((a, b) => a.orderIndex - b.orderIndex));
        const activeRace = allRaces.find((r) => !r.isComplete) ?? allRaces[0];
        if (!activeRace) continue;
        const cleanLabel = (group[0].label ?? '').replace(/\s*·\s*(Q\d+|Final)$/i, '').trim() || activeRace.name;
        cols.push({ key: `round-${roundId}`, race: activeRace, label: cleanLabel, roundHeats: group });
      }
      return cols;
    }
    return heat.races
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((race) => ({ key: `race-${race.id}`, race, label: race.name }));
  }, [heat, heats, isRaceFinals]);

  const heatLabel = heat
    ? isRaceFinals
      ? (columns.length === 1 ? columns[0].label : session.name)
      : heat.label || t('competition.timetable.heat', { n: index + 1 })
    : session.name;
  const status = row?.status ?? (session.status === 2 ? 'finished' : session.status === 1 ? 'live' : 'on-time');
  const finished = status === 'finished';
  const runningIndex = status === 'live' ? columns.findIndex((col) => col.roundHeats ? col.roundHeats.some((h) => h.races.some((r) => !r.isComplete)) : !col.race.isComplete) : -1;
  const time = row?.effective ? row.effective.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null;
  const runningRace = runningIndex >= 0 ? columns[runningIndex].race : null;
  const tableMeta = status === 'live' && runningRace
    ? t('competition.heat.raceOf', { n: runningIndex + 1, total: columns.length, name: runningRace.name })
    : finished
      ? [time, t('competition.heat.finalResult')].filter(Boolean).join(' · ')
      : time ? (status === 'late' && row ? t('competition.heat.startsLate', { time, delay: formatDelayDuration(row.delayMinutes) }) : t('competition.heat.starts', { time })) : t('competition.heat.startTbc');
  const compactSubtitle = [section ? t('competition.heat.sectionHeats', { section }) : t('competition.scoring.heats'), session.arenaName?.trim()].filter(Boolean).join(' · ');
  const compactBadge = status === 'live' ? 'live' : finished ? 'finished' : 'next';

  const laneRules = useMemo<LaneRules>(
    () => (competition as { laneRules?: LaneRules }).laneRules ?? lanesOf(session),
    [competition, session],
  );

  const isFinalHeat = useMemo(
    () => !isRaceFinals && Boolean(heat) && (/^[A-Z]\s+Finals?$/i.test(heat?.label?.trim() ?? '') || /\bfinals?\b/i.test(heat?.label ?? '') || /\bfinals?\b/i.test(session.name)),
    [heat, isRaceFinals, session.name],
  );

  const carriedForwardByTeam = useMemo(() => {
    const map = new Map<number, number>();
    if (!isFinalHeat) return map;
    for (const s of competition.sessions) {
      if ((s.kind ?? (s.isBreak ? 1 : 0)) !== 0) continue;
      if (session.competitionSectionId != null && s.competitionSectionId != null && s.competitionSectionId !== session.competitionSectionId) continue;
      for (const h of s.heats) {
        const hIsFinal = h.raceRoundStage === 2 || /\bfinals?\b/i.test(h.label ?? '') || /\bfinals?\b/i.test(s.name);
        if (hIsFinal || h.id === heat?.id) continue;
        for (const r of h.races) {
          for (const res of r.results) {
            map.set(res.teamId, (map.get(res.teamId) ?? 0) + res.points);
          }
        }
      }
    }
    return map;
  }, [competition.sessions, heat?.id, isFinalHeat, session.competitionSectionId]);

  const showCarriedForward = useMemo(
    () => isFinalHeat && [...carriedForwardByTeam.values()].some((pts) => pts > 0),
    [carriedForwardByTeam, isFinalHeat],
  );

  const grid = useMemo(() => {
    if (!heat) return { teams: [], cells: new Map<string, Cell>(), anyScored: false };
    const sourceHeats = isRaceFinals ? heats.slice().sort((a, b) => a.orderIndex - b.orderIndex) : [heat];
    const teams = new Map<number, { id: number; name: string; lane: number; entry: HeatEntry | null }>();
    for (const item of sourceHeats) {
      for (const entry of item.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex)) {
        if (!teams.has(entry.teamId)) {
          teams.set(entry.teamId, { id: entry.teamId, name: entry.teamName, lane: entry.laneIndex, entry });
        }
      }
    }

    const cells = new Map<string, Cell>();
    let anyScored = false;

    if (isRaceFinals) {
      for (const col of columns) {
        const roundHeats = col.roundHeats ?? [];
        for (const rHeat of roundHeats) {
          for (const race of rHeat.races) {
            if (race.isComplete || race.results.length > 0) anyScored = true;
            for (const result of race.results) {
              if (!teams.has(result.teamId)) {
                teams.set(result.teamId, { id: result.teamId, name: result.teamName, lane: Number.MAX_SAFE_INTEGER, entry: null });
              }
            }
          }
        }
        const finalHeat = roundHeats.find((h) => h.raceRoundStage === 2);
        const qualHeats = roundHeats.filter((h) => h.raceRoundStage !== 2);
        for (const team of teams.values()) {
          const cellKey = `${team.id}|${col.key}`;
          const finalResults = finalHeat?.races.flatMap((r) => r.results).filter((res) => res.teamId === team.id) ?? [];
          const qualResults = qualHeats.flatMap((h) => h.races).flatMap((r) => r.results).filter((res) => res.teamId === team.id);
          if (finalResults.length > 0) {
            const pts = finalResults.reduce((s, r) => s + r.points, 0);
            const elim = finalResults.some((r) => r.eliminated && r.points === 0);
            const stat = finalResults.find((r) => r.eliminated)?.status;
            cells.set(cellKey, { points: pts, eliminated: elim, sitOut: false, status: stat, scored: true, stageBadge: t('competition.heat.stageFinal') });
          } else if (finalHeat?.entries.some((e) => e.teamId === team.id)) {
            const qPts = qualResults.reduce((s, r) => s + r.points, 0);
            cells.set(cellKey, { points: qPts, eliminated: false, sitOut: false, scored: false, stageBadge: t('competition.heat.stageFinal') });
          } else if (qualResults.length > 0) {
            const pts = qualResults.reduce((s, r) => s + r.points, 0);
            const elim = qualResults.some((r) => r.eliminated && r.points === 0);
            const sit = qualResults.some((r) => r.isSitOut);
            const stat = qualResults.find((r) => r.eliminated)?.status;
            cells.set(cellKey, { points: pts, eliminated: elim, sitOut: sit, status: stat, scored: true });
          } else {
            const qIdx = qualHeats.findIndex((h) => h.entries.some((e) => e.teamId === team.id));
            if (qIdx >= 0) {
              const qHeat = qualHeats[qIdx];
              const match = (qHeat.label ?? '').match(/\b(Q\d+)\b/i);
              const badge = match ? match[1].toUpperCase() : `Q${qIdx + 1}`;
              cells.set(cellKey, { points: 0, eliminated: false, sitOut: false, scored: false, stageBadge: badge });
            }
          }
        }
      }
    } else {
      columns.forEach((col, raceIdx) => {
        const { race } = col;
        if (race.isComplete || race.results.length > 0) anyScored = true;
        for (const result of race.results) {
          if (!teams.has(result.teamId)) {
            teams.set(result.teamId, { id: result.teamId, name: result.teamName, lane: Number.MAX_SAFE_INTEGER, entry: null });
          }
          const key = `${result.teamId}|${col.key}`;
          const cell = cells.get(key) ?? { points: 0, eliminated: false, sitOut: false, scored: true };
          cell.points += result.points;
          cell.scored = true;
          if (result.isSitOut) cell.sitOut = true;
          if (result.eliminated && result.points === 0) { cell.eliminated = true; cell.status = result.status; }
          cells.set(key, cell);
        }
        // Pre-fill Sit-Out "S" before the race is scored so teams/spectators can see which races they sit out ahead of time.
        for (const team of teams.values()) {
          const key = `${team.id}|${col.key}`;
          if (!cells.has(key) && team.entry && sitsOutOf(heat, team.entry, raceIdx, laneRules)) {
            cells.set(key, { points: 0, eliminated: false, sitOut: true, scored: false });
          }
        }
      });
    }

    const activeRaceIdx = runningIndex >= 0
      ? runningIndex
      : anyScored && !finished
        ? Math.max(0, columns.findIndex((c) => !c.race.isComplete && c.race.results.length === 0))
        : 0;

    const storedCards = cardsEnabled ? getStoredCards(competition.id) : {};

    const list = [...teams.values()].map((team) => {
      const carriedForward = showCarriedForward ? (carriedForwardByTeam.get(team.id) ?? 0) : 0;
      const total = carriedForward + columns.reduce((sum, col) => sum + (cells.get(`${team.id}|${col.key}`)?.points ?? 0), 0);
      let laneLabel: string | null = null;
      if (!isRaceFinals && team.entry) {
        const d = displayLaneFor(heat, team.entry, activeRaceIdx, laneRules);
        laneLabel = d === 'S' ? t('competition.heat.sitOut') : t('competition.toplist.lane', { n: d });
      } else if (team.lane > 0 && team.lane < Number.MAX_SAFE_INTEGER) {
        laneLabel = t('competition.toplist.lane', { n: team.lane });
      }

      let card: RefereeCard = cardsEnabled ? (storedCards[team.id] ?? null) : null;
      if (cardsEnabled && !card) {
        for (const h of sourceHeats) {
          for (const r of h.races) {
            for (const res of r.results) {
              if (res.teamId === team.id) {
                const parsed = parseRefereeCard((res as { refereeNote?: string }).refereeNote);
                if (parsed.card) {
                  card = parsed.card;
                  break;
                }
              }
            }
            if (card) break;
          }
          if (card) break;
        }
      }

      return {
        ...team,
        carriedForward,
        total,
        laneLabel,
        card,
        isFav: typeof favHook.isTeamFav === 'function'
          ? favHook.isTeamFav(competition.id, team.id)
          : (favHook.favourites ?? []).some((f) => f.competitionId === competition.id && f.teamId === team.id),
      };
    });

    // Order by starting lane before any race is scored; as soon as any race is scored (live or finished), order by heat leader.
    void cardsTick;
    const sortByPoints = anyScored || finished;
    list.sort((a, b) => (sortByPoints ? b.total - a.total : 0) || a.lane - b.lane || a.name.localeCompare(b.name));
    const ranked = list.map((team, i) => ({
      ...team,
      position: sortByPoints ? 1 + list.findIndex((other) => other.total === team.total) : i + 1,
    }));
    return { teams: ranked, cells, anyScored };
  }, [heat, heats, isRaceFinals, columns, finished, runningIndex, laneRules, competition.id, favHook, showCarriedForward, carriedForwardByTeam, cardsTick, cardsEnabled, t]);

  const manyRaces = columns.length >= 6;
  // When a race re-ranks the heat, climbers swell and lift and big climbs sparkle.
  const rowsRef = useRankMotion<HTMLTableSectionElement>(grid.teams.map((team) => team.id));
  const minWidth = manyRaces ? undefined : 12 + (finished ? 18 : 0) + 100 + (showCarriedForward ? 26 : 0) + columns.length * 22 + 40;

  return (
    <div className={`mx-auto flex w-full max-w-xl flex-col gap-4 ${embedded ? '' : 'pt-3'}`}>
      {!embedded && (
        <HeatScoresPageBar
          backTo={`/competitions/${competition.id}`}
          title={competition.name}
          subtitle={compactSubtitle}
          badge={compactBadge}
        />
      )}
      {!embedded && <h1 className="sr-only">{t('competition.heat.scoresTitle', { name: section ? `${section} ${heatLabel}` : heatLabel })}</h1>}

      {!heat ? <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">{t('competition.heat.noHeats')}</p> : (
        <section aria-label={t('competition.scoring.scores')} className={bare ? 'overflow-hidden' : 'mg-card overflow-hidden'}>
          {grid.teams.length === 0 ? <p className="p-4 text-[rgb(var(--mg-muted))]">{t('competition.heat.noTeams')}</p> : (
            <div className="overflow-x-auto">
              <table className={`heat-grid${manyRaces ? ' heat-grid-many' : ''}`} style={{ minWidth }}>
                <thead>
                  <tr>
                    {finished && <th scope="col" className="heat-rank">#</th>}
                    <th scope="col" className="heat-team-head">
                      <div className="heat-title">
                        {section && <span className="heat-title-section">{section}</span>}
                        <span className="heat-title-name">{heatLabel}</span>
                        <span className={`heat-title-meta ${status === 'live' ? 'heat-title-meta-live' : status === 'late' ? 'heat-title-meta-late' : ''}`}>{tableMeta}</span>
                      </div>
                      <span>{t('competition.toplist.team')}</span>
                    </th>
                    {showCarriedForward && (
                      <th scope="col" className="heat-race heat-cf-head" title={t('competition.heat.carried')}>
                        <span className="heat-name">CF<span className="sr-only"> ({t('competition.heat.carried')})</span></span>
                      </th>
                    )}
                    {columns.map(({ key, race, label }, i) => (
                      <th key={key} scope="col" className="heat-race" title={label}>
                        {(i > 0 || showCarriedForward) && <span aria-hidden="true" className="heat-sep" />}
                        <RaceRulesButton raceName={race.name} className={`heat-name ${i === runningIndex ? 'heat-name-running' : ''}`} label={<>{label}{i === runningIndex && <span className="sr-only"> ({t('competition.heat.running')})</span>}</>} />
                      </th>
                    ))}
                    <th scope="col" className="heat-pts">
                      {(columns.length > 0 || showCarriedForward) && <span aria-hidden="true" className="heat-sep" />}
                      {t('competition.toplist.pts')}
                    </th>
                  </tr>
                </thead>
                <tbody ref={rowsRef}>
                  {grid.teams.map((team) => {
                    const flag = parseBibAndFlag(competition.teams.find((item) => item.id === team.id)?.bibDescription).flag;
                    return (
                      // Rows slide to their new places when a race result re-ranks the heat.
                      <motion.tr key={team.id} layout="position" transition={{ layout: { duration: 0.5, ease: EASE_OUT } }} data-rank-id={team.id} className={[team.isFav ? 'heat-row-fav' : '', team.id === highlightTeamId ? 'heat-row-me' : ''].filter(Boolean).join(' ') || undefined} data-followed={team.isFav ? 'true' : undefined} aria-current={team.id === highlightTeamId ? 'true' : undefined}>
                        {finished && <td className="heat-rank-cell"><span className="sr-only">{t('competition.heat.position')} </span>{team.position}</td>}
                        <th scope="row" className="heat-team" title={team.name}>
                          <Link to={`/competitions/${competition.id}/teams/${team.id}`} className="heat-team-link">
                            <span data-grow="start" className={`heat-team-name${team.name.length > 16 || manyRaces ? ' heat-team-name-long' : ''}`}>
                              {team.isFav && <Star aria-hidden="true" className="mr-1 inline h-3 w-3 fill-[#C08308] text-[#C08308]" />}
                              {flag && <img src={`/flags/${flag}.png`} alt="" className="mr-1 inline h-3.5 w-5 rounded-[2px] object-cover" />}
                              {team.name}
                              {cardsEnabled && <TeamCardBadge card={team.card} />}
                            </span>
                            {team.laneLabel && <span className="heat-team-lane">{team.laneLabel}</span>}
                          </Link>
                        </th>
                        {showCarriedForward && (
                          <td className="heat-cell heat-cell-first heat-cf" title={t('competition.heat.carried')}>{formatPoints(team.carriedForward)}</td>
                        )}
                        {columns.map((col, i) => {
                          const cell = grid.cells.get(`${team.id}|${col.key}`);
                          return <td key={col.key} className={`heat-cell ${i === 0 && !showCarriedForward ? 'heat-cell-first' : ''}`}>
                            {cell == null ? <><span aria-hidden="true" className="heat-dash">–</span><span className="sr-only">{t('competition.heat.notRaced')}</span></>
                              : cell.sitOut ? <><span aria-hidden="true" className="heat-dash sitout">S</span><span className="sr-only">{t('competition.heat.satOut')}</span></>
                              : !cell.scored && cell.stageBadge ? <span className="heat-stage-badge">{cell.stageBadge}</span>
                              : cell.eliminated ? <><span aria-hidden="true" className="heat-elim">{statusLetter(true, cell.status)}</span><span className="sr-only">{resultStatusText(true, cell.status, t)}</span></>
                              : formatPoints(cell.points)}
                          </td>;
                        })}
                        <td className="heat-total"><span data-grow="end"><ScoreFlash value={team.total}><TickerNumber value={team.total} /></ScoreFlash></span></td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!embedded && (finished ? (
        <div className="grid grid-cols-2 gap-2.5">
          {session.competitionSectionId != null && <Link to={`/competitions/${competition.id}/toplists?section=${session.competitionSectionId}`} className="mg-btn mg-btn-primary">{t('competition.scoring.toplist')}</Link>}
          {nextHeat
            ? <Link to={`/competitions/${competition.id}/session/${session.id}?heat=${nextHeat.id}`} className="mg-btn mg-btn-secondary">{nextHeat.label || t('competition.timetable.heat', { n: index + 2 })}<ChevronRight aria-hidden="true" className="h-4 w-4" /></Link>
            : <Link to={`/competitions/${competition.id}`} className="mg-btn mg-btn-secondary">{t('competition.timetable.title')}</Link>}
        </div>
      ) : (
        <div className="flex gap-2.5">
          {canWatch && <Link to={`/competitions/${competition.id}/chat`} className="mg-btn mg-btn-primary flex-1">{t('competition.heat.watch')}</Link>}
          {session.competitionSectionId != null && <Link to={`/competitions/${competition.id}/toplists?section=${session.competitionSectionId}`} className={`mg-btn flex-1 ${canWatch ? 'mg-btn-secondary' : 'mg-btn-primary'}`}>{section ? t('competition.heat.sectionToplist', { section }) : t('competition.scoring.toplist')}</Link>}
        </div>
      ))}

      {!embedded && heat && columns.length > 0 && (
        <button
          type="button"
          className="mg-text-link self-center"
          aria-expanded={showRules}
          onClick={() => setShowRules((open) => !open)}
        >
          {showRules ? t('competition.heat.rulesClose') : t('competition.heat.rulesOpen')}
        </button>
      )}

      {!embedded && heat && columns.length > 0 && showRules && (
        <section aria-label={t('competition.heat.racesInHeat')} className="mg-card px-3">
          <ol className="divide-y divide-[rgb(var(--mg-rule-soft))]">
            {columns.map(({ key, race, label }, i) => (
              <li key={key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate py-2">{label}{i === runningIndex && <span className="mg-meta"> · {t('competition.heat.running')}</span>}</span>
                <RaceRulesButton raceName={race.name} className="!h-11 !w-11" />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
