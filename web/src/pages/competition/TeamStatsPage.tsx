import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { RunGraph, type GraphRun } from '../../components/RunGraph';
import { ScoreFlash } from '../../components/ScoreFlash';
import { useCompactPageBar } from '../../components/CompactPageBarContext';
import { usePageWidth } from '../../components/pageWidthState';
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
import './teamStats.css';


/**
 * Every statistic for one team at this event, from the races scored so far: three headline figures, then race
 * performance (pick a game, see a bar for every run with its points over it and the average under), then the placings
 * and points behind them, folded away. Nothing here is private: it is all in the public scores.
 */
export function TeamStatsPage() {
  usePageWidth('wide');
  const t = useT();
  const { teamId } = useParams<{ teamId: string }>();
  const id = Number(teamId);
  const { competition } = useCompetition();
  const [chosenRace, setChosenRace] = useState<string | null>(null);

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
    backLabel: team?.displayName ?? t('teams.team.title'),
    title: t('teams.team.stats'),
    subtitle,
    badge: nextState?.kind === 'heat' && nextState.row.status === 'live' ? 'live' : nextState?.kind === 'done' ? 'finished' : 'next',
  });

  if (!team) {
    return <div className="mg-flat tp mx-auto w-full max-w-3xl"><p className="tp-note">{t('teams.team.notFound')}</p></div>;
  }

  // The game on show: the one picked, else the first. Looked up by name so it holds when a live result reorders the list.
  const race = stats ? stats.races.find((item) => item.name === chosenRace) ?? stats.races[0] ?? null : null;
  const avg = (value: number) => value.toFixed(1);
  const result = (run: RaceRun) => (run.eliminated ? statusLetter(true, run.status) ?? 'E' : run.placing != null && run.placing > 0 ? ordinal(run.placing) : '–');
  const resultWords = (run: RaceRun) => (run.eliminated ? resultStatusLabel(t, true, run.status) ?? '' : run.placing != null && run.placing > 0 ? ordinal(run.placing) : t('teams.stats.notPlaced'));
  const graphRuns = (item: RaceStat): GraphRun[] => item.runs.map((run) => ({
    id: run.key,
    value: run.points,
    top: result(run),
    valueText: formatPoints(run.points),
    // The points go over the bar and the heat sits under it; the placing is in the description for screen readers.
    label: [run.where],
    description: `${run.where}, ${resultWords(run)}, ${t('teams.team.pts', { points: formatPoints(run.points) })}`,
  }));

  const fact = (label: string, value: string, flash?: number) => (
    <div className="tp-fact ts-fact"><dt>{label}</dt><dd>{flash == null ? value : <ScoreFlash value={flash}>{value}</ScoreFlash>}</dd></div>
  );
  /** A headline figure: the number large, its label underneath, lit up once when a new result changes it. */
  const key = (label: string, value: number, shown: string, extra?: string) => (
    <div className="ts-key">
      <dt>{label}</dt>
      <dd><ScoreFlash value={value} className="ts-key-value">{shown}</ScoreFlash>{extra && <>{' '}<small>{extra}</small></>}</dd>
    </div>
  );

  return (
    <div className="mg-flat tp ts mx-auto w-full max-w-3xl">
      {!stats ? (
        <p className="tp-note">{t('teams.team.statsLater', { name: team.displayName })}</p>
      ) : (
        <>
          <section aria-label={t('teams.stats.summary')} className="ts-summary">
            <dl className="ts-keys">
              {key(t('teams.stats.totalPoints'), stats.totalPoints, formatPoints(stats.totalPoints))}
              {key(t('teams.stats.perRace'), stats.avgPointsPerRace, avg(stats.avgPointsPerRace))}
              {key(t('teams.team.racesWon'), stats.racesWon, String(stats.racesWon), t('teams.stats.wonOf', { total: stats.scoredRaces }))}
            </dl>
          </section>

          {race && (
            <section aria-labelledby="stats-races-title">
              <h2 id="stats-races-title" className="fl-heading fl-ruled">{t('teams.stats.performance')}</h2>
              <div className="fl-row ts-pick">
                <label htmlFor="stats-game" className="fl-title">{t('teams.stats.chooseGame')}</label>
                <span className="ts-select">
                  <select id="stats-game" value={race.name} onChange={(event) => setChosenRace(event.target.value)}>
                    {stats.races.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" className="ts-select-chev" />
                </span>
              </div>
              <div className="ts-graph">
                <RunGraph
                  runs={graphRuns(race)}
                  average={race.average}
                  ariaLabel={t('teams.stats.graphLabel', { race: race.name })}
                  averageNote={t('teams.stats.graphSummary', { average: avg(race.average), count: race.runs.length })}
                  hideAxisLabels
                  showValues
                  fill
                  compact
                  hideAverageLine
                />
              </div>
            </section>
          )}

          <details className="ts-more">
            <summary className="fl-row ts-more-summary">
              <span className="fl-title fl-grow">{t('teams.stats.detail')}</span>
              <ChevronRight aria-hidden="true" className="fl-chev ts-more-chev" />
            </summary>
            <dl className="fl-list m-0">
              {fact(t('teams.team.avgPlace'), stats.avgPlace != null ? avg(stats.avgPlace) : '—', stats.avgPlace ?? undefined)}
              {fact(t('teams.stats.share'), `${stats.pointQuota}%`, stats.pointQuota)}
              {stats.best && fact(t('teams.stats.bestRace'), t('teams.stats.raceAverage', { race: stats.best.name, average: avg(stats.best.average) }))}
              {stats.hardest && fact(t('teams.stats.hardestRace'), t('teams.stats.raceAverage', { race: stats.hardest.name, average: avg(stats.hardest.average) }))}
              {fact(t('teams.stats.finalsReached'), finalsReached.length ? finalsReached.join(', ') : t('teams.stats.noFinals'))}
            </dl>
          </details>
        </>
      )}
    </div>
  );
}

export default TeamStatsPage;
