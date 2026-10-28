import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { RunGraph, type GraphRun } from '../../components/RunGraph';
import { useCompactPageBar, usePageHeader } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
import { useStillMotion } from '../../lite/useStillMotion';
import { useT } from '../../i18n/LanguageContext';
import { nextHeats } from '../../lib/following';
import { formatPoints } from '../../lib/formatPoints';
import { localOrdinal as ordinal } from '../../lib/ordinalText';
import { statusLetter } from '../../lib/resultStatus';
import { resultStatusLabel } from '../../lib/resultStatusText';
import { displaySectionName } from '../../lib/section';
import { computeTeamStats, type RaceRun, type RaceStat } from '../../lib/teamStats';
import { buildToplist } from '../../lib/toplist';
import { useCompetition } from './context';

const row = 'flex items-baseline gap-3 border-t border-[rgb(var(--mg-rule-soft))] px-4 py-2.5 text-[15.5px] leading-snug first:border-t-0';
const heading = 'mg-display px-0.5 text-[15px] font-bold uppercase leading-tight tracking-[0.05em] text-[rgb(var(--mg-heading))]';

/**
 * Every statistic for one team at this event, from the races scored so far: the facts, then each race with the points a
 * run is worth on average, opening into a bar graph of every run. Nothing here is private: it is all in the public scores.
 */
export function TeamStatsPage() {
  usePageWidth('wide');
  const t = useT();
  const { teamId } = useParams<{ teamId: string }>();
  const id = Number(teamId);
  const { competition } = useCompetition();
  const [openRace, setOpenRace] = useState<string | null>(null);
  const still = useStillMotion();

  const team = competition.teams.find((item) => item.id === id) ?? null;
  const section = team ? competition.sections.find((item) => item.id === team.competitionSectionId) ?? null : null;
  const sectionLabel = displaySectionName(section?.displayName ?? team?.sectionName);
  const teamPath = `/competitions/${competition.id}/teams/${id}`;

  const stats = useMemo(
    () => (team ? computeTeamStats(competition.sessions, team.id, (number) => t('teams.team.raceN', { number }), (number) => t('teams.team.heatN', { number })) : null),
    [competition.sessions, team, t],
  );
  // The finals the team reached come from the sessions alone, so no standings are needed.
  const finalsReached = useMemo(() => {
    if (!team) return [];
    const list = buildToplist([], competition.sessions, competition.teams, team.competitionSectionId, null);
    return list.finals.filter((group) => group.rows.some((item) => item.teamId === team.id)).map((group) => group.label);
  }, [competition.sessions, competition.teams, team]);
  const nextState = team ? nextHeats(competition, new Set([team.id])).get(team.id) : undefined;

  const subtitle = [team?.displayName, sectionLabel].filter(Boolean).join(' · ');
  useCompactPageBar({
    backTo: teamPath,
    title: t('teams.team.stats'),
    subtitle,
    badge: nextState?.kind === 'heat' && nextState.row.status === 'live' ? 'live' : nextState?.kind === 'done' ? 'finished' : 'next',
  });
  usePageHeader({ title: t('teams.team.stats'), subtitle, backTo: teamPath, backLabel: team?.displayName ?? t('teams.team.title') });

  if (!team) {
    return <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pt-3"><div className="mg-card p-4 text-sm text-[rgb(var(--mg-muted))]">{t('teams.team.notFound')}</div></div>;
  }

  const avg = (value: number) => value.toFixed(1);
  const result = (run: RaceRun) => (run.eliminated ? statusLetter(true, run.status) ?? 'E' : run.placing != null && run.placing > 0 ? ordinal(run.placing) : '–');
  const resultWords = (run: RaceRun) => (run.eliminated ? resultStatusLabel(t, true, run.status) ?? '' : run.placing != null && run.placing > 0 ? ordinal(run.placing) : t('teams.stats.notPlaced'));
  const graphRuns = (race: RaceStat): GraphRun[] => race.runs.map((run) => ({
    id: run.key,
    value: run.points,
    top: result(run),
    label: [run.where],
    description: `${run.where}, ${resultWords(run)}, ${t('teams.team.pts', { points: formatPoints(run.points) })}`,
  }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-4 pt-3">
      {!stats ? (
        <p className="mg-card p-4 text-[15px] leading-snug text-[rgb(var(--mg-body))]">{t('teams.team.statsLater', { name: team.displayName })}</p>
      ) : (
        <>
          <section aria-labelledby="stats-facts-title" className="flex flex-col gap-2">
            <h2 id="stats-facts-title" className={heading}>{t('teams.team.stats')}</h2>
            <dl className="mg-card m-0 overflow-hidden">
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.team.avgPerRace')}</dt><dd className="m-0 min-w-0 flex-1">{t('teams.team.pts', { points: avg(stats.avgPointsPerRace) })}</dd></div>
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.team.avgPlace')}</dt><dd className="m-0 min-w-0 flex-1">{stats.avgPlace != null ? avg(stats.avgPlace) : '—'}</dd></div>
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.team.racesWon')}</dt><dd className="m-0 min-w-0 flex-1">{t('teams.team.wonOf', { won: stats.racesWon, total: stats.scoredRaces })}</dd></div>
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.team.pointQuota')}</dt><dd className="m-0 min-w-0 flex-1">{stats.pointQuota}%</dd></div>
              {stats.best && <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.stats.bestRace')}</dt><dd className="m-0 min-w-0 flex-1">{t('teams.stats.raceAverage', { race: stats.best.name, average: avg(stats.best.average) })}</dd></div>}
              {stats.hardest && <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.stats.hardestRace')}</dt><dd className="m-0 min-w-0 flex-1">{t('teams.stats.raceAverage', { race: stats.hardest.name, average: avg(stats.hardest.average) })}</dd></div>}
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.stats.totalPoints')}</dt><dd className="m-0 min-w-0 flex-1">{formatPoints(stats.totalPoints)}</dd></div>
              <div className={row}><dt className="w-40 shrink-0 text-[rgb(var(--mg-muted))]">{t('teams.stats.finalsReached')}</dt><dd className="m-0 min-w-0 flex-1">{finalsReached.length ? finalsReached.join(', ') : t('teams.stats.noFinals')}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="stats-races-title" className="flex flex-col gap-2">
            <h2 id="stats-races-title" className={heading}>{t('teams.stats.eachRace')}</h2>
            <ul className="mg-card m-0 list-none divide-y divide-[rgb(var(--mg-rule-soft))] overflow-hidden p-0">
              {stats.races.map((race) => {
                const open = openRace === race.name;
                const panelId = `stats-race-${race.name.replace(/\W+/g, '-')}`;
                const best = race.bestPlace != null ? ordinal(race.bestPlace) : '—';
                return (
                  <li key={race.name}>
                    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpenRace(open ? null : race.name)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-[rgb(var(--mg-subtle))]">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[16px] font-semibold leading-tight text-[rgb(var(--mg-ink))]">{race.name}</span>
                        <span className="text-[13.5px] leading-tight text-[rgb(var(--mg-muted))]">{t('teams.stats.runsLine', { count: race.runs.length, best, points: formatPoints(race.totalPoints) })}</span>
                      </span>
                      <span className="mg-display shrink-0 text-xl font-bold tabular-nums text-[rgb(var(--mg-heading))]">{t('teams.stats.avg', { average: avg(race.average) })}</span>
                      <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 text-[rgb(var(--mg-dash))] transition-transform duration-200 motion-reduce:transition-none [html[data-lite=true]_&]:transition-none ${open ? 'rotate-90' : ''}`} />
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          key="panel"
                          id={panelId}
                          role="region"
                          aria-label={t('teams.stats.graphLabel', { race: race.name })}
                          initial={still ? false : { height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={still ? undefined : { height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-[rgb(var(--mg-rule-soft))] px-4 pb-4 pt-3">
                            <RunGraph runs={graphRuns(race)} average={race.average} ariaLabel={t('teams.stats.graphLabel', { race: race.name })} averageNote={t('teams.stats.graphAverage', { average: avg(race.average) })} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

export default TeamStatsPage;
