import { useState } from 'react';
import { useParams } from 'react-router-dom';
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
  const params = useParams();
  const id = params.id ?? params.profileId ?? '';
  const { user } = useAuth();
  const load = useStatsProfile(id ? `/stats/team-profiles/${id}` : null, user?.id ?? 'public');
  const [open, setOpen] = useState<string | null>(null);
  const still = useStillMotion();
  const name = load.status === 'ready' ? load.data.name : undefined;
  usePageHeader({ title: 'Stats', subtitle: name, plain: true, backTo: `/team-profiles/${id}`, backLabel: name ? `Back to ${name}` : 'Back to the team' });

  if (load.status === 'idle' || load.status === 'loading') return <RefinePage><p role="status" className="sp-note">Loading race statistics…</p></RefinePage>;
  if (load.status === 'error') return <RefinePage><Notice>{load.message}</Notice></RefinePage>;
  if (load.status === 'missing') {
    return <RefinePage><PageProblem title="Team profile not found" secondaryLabel="Team profiles" secondaryTo="/team-profiles">Check the link, or pick the team from the list.</PageProblem></RefinePage>;
  }

  const { summary } = load.data;
  const games = load.data.games ?? [];
  const toggle = (game: StatsGame) => setOpen(open === game.name ? null : game.name);

  return (
    <RefinePage>
      <h1 className="sr-only">Stats for {load.data.name}</h1>
      {summary.races === 0 ? <p className="sp-note">No races have been scored for this team yet.</p> : (
        <>
          <dl className="ps-tiles sp-card" aria-label="Race statistics">
            {headlineFacts(summary).map((fact) => <div key={fact.label} className="ps-tile"><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
          </dl>
          {games.length > 0 && (
            <>
              <h2 className="sp-sec">By game <small>share of points available</small></h2>
              <ul className="sp-card m-0 list-none p-0" aria-label="By game">
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
                          <span className="ps-bar" role="img" aria-label={`${formatPercent(game.pointQuotaPercent)} of the points available`}><span style={{ width: `${Math.min(100, Math.max(0, share))}%` }} /></span>
                        </span>
                        <span className="sp-quota" title="Share of points available">{formatPercent(game.pointQuotaPercent)}</span>
                        <ChevronDown aria-hidden="true" className={`ps-chev h-5 w-5${isOpen ? ' is-open' : ''}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            key="panel"
                            id={panelId}
                            role="region"
                            aria-label={`${game.name} runs`}
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
                                  ariaLabel={`Every ${game.name} run, points scored`}
                                  averageNote={average == null ? '' : `Average ${average} pts a run`}
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
