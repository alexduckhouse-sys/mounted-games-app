import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../../components/Notice';
import { PageProblem } from '../../components/PageProblem';
import { RunGraph } from '../../components/RunGraph';
import { RefinePage } from '../refine/Refine';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { useStillMotion } from '../../lite/useStillMotion';
import { useStatsProfile } from '../../hooks/useStats';
import { useT } from '../../i18n/LanguageContext';
import { formatPercent } from '../../lib/stats';
import { gameAveragePoints, gameRunsLine, headlineFacts, runDescription, runLabels, runPlaceText } from '../../lib/profileStats';
import type { StatsGame } from '../../types';
import '../../components/sitePages.css';
import './profileStats.css';

/**
 * Every race figure for a team profile, over its linked event teams: four big numbers, then each game with its share of
 * the points on offer, opening into a bar graph of every run. All of it is in the public results, so it needs no sign-in.
 */
export default function TeamProfileStatsPage() {
  const t = useT();
  const params = useParams();
  const [query] = useSearchParams();
  // The season the team profile was showing, handed back so Back lands on the same one.
  const season = query.get('season');
  const id = params.id ?? params.profileId ?? '';
  const { user } = useAuth();
  const load = useStatsProfile(id ? `/stats/team-profiles/${id}` : null, user?.id ?? 'public');
  const [open, setOpen] = useState<string | null>(null);
  const still = useStillMotion();
  const name = load.status === 'ready' ? load.data.name : undefined;
  usePageHeader({ title: t('site.stats.statsWord'), subtitle: name, plain: true, backTo: `/team-profiles/${id}${season ? `?season=${encodeURIComponent(season)}` : ''}`, backLabel: name ? t('site.stats.backTo', { name }) : t('site.stats.backToTeam') });

  if (load.status === 'idle' || load.status === 'loading') return <RefinePage><p role="status" className="sp-note">{t('site.stats.loadingRace')}</p></RefinePage>;
  if (load.status === 'error') return <RefinePage><Notice>{load.message}</Notice></RefinePage>;
  if (load.status === 'missing') {
    return <RefinePage><PageProblem title={t('site.stats.profileNotFound')} secondaryLabel={t('site.stats.teamProfiles')} secondaryTo="/team-profiles">{t('site.stats.checkLink')}</PageProblem></RefinePage>;
  }

  const { summary } = load.data;
  const games = load.data.games ?? [];
  const toggle = (game: StatsGame) => setOpen(open === game.name ? null : game.name);

  return (
    <RefinePage>
      <h1 className="sr-only">{t('site.stats.statsFor', { name: load.data.name })}</h1>
      {summary.races === 0 ? <p className="sp-note">{t('site.stats.noRacesScored')}</p> : (
        <>
          <dl className="ps-tiles sp-card" aria-label={t('site.stats.raceStatistics')}>
            {headlineFacts(summary).map((fact) => <div key={fact.label} className="ps-tile"><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
          </dl>
          {games.length > 0 && (
            <>
              <h2 className="sp-sec">{t('site.stats.byGame')} <small>{t('site.stats.shareAvailable')}</small></h2>
              <ul className="sp-card m-0 list-none p-0" aria-label={t('site.stats.byGame')}>
                {games.map((game) => {
                  const isOpen = open === game.name;
                  const panelId = `game-${game.name.replace(/\W+/g, '-')}`;
                  const runs = game.runs ?? [];
                  const labels = runLabels(runs);
                  const average = gameAveragePoints(game);
                  const share = game.pointQuotaPercent ?? 0;
                  return (
                    <li key={game.name}>
                      <button type="button" className="ps-game" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(game)}>
                        <span className="ps-game-main">
                          <span className="sp-t1">{game.name}</span>
                          <span className="ps-bar" role="img" aria-label={t('site.stats.ofPointsAvailable', { percent: formatPercent(game.pointQuotaPercent) })}><span style={{ width: `${Math.min(100, Math.max(0, share))}%` }} /></span>
                        </span>
                        <span className="sp-quota" title={t('site.stats.shareAvailableTitle')}>{formatPercent(game.pointQuotaPercent)}</span>
                        <ChevronDown aria-hidden="true" className={`ps-chev h-5 w-5${isOpen ? ' is-open' : ''}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            key="panel"
                            id={panelId}
                            role="region"
                            aria-label={t('site.stats.gameRuns', { name: game.name })}
                            initial={still ? false : { height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={still ? undefined : { height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="ps-panel">
                              <p className="ps-line">{gameRunsLine(game, runs)}</p>
                              {runs.length > 0 && (
                                <RunGraph
                                  runs={runs.map((run, index) => ({
                                    id: index,
                                    value: run.points,
                                    top: runPlaceText(run),
                                    label: labels[index],
                                    description: runDescription(run),
                                  }))}
                                  average={average}
                                  ariaLabel={t('site.stats.everyRunPoints', { name: game.name })}
                                  averageNote={average == null ? '' : t('site.stats.averageRun', { n: average })}
                                />
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </RefinePage>
  );
}
