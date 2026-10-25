import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { ResultsStatsNav } from '../../components/ResultsStatsNav';
import { SectionFormatLabel } from '../../types';
import { Chevron, RefineHeader, RefineList, RefinePage, RefineSection } from '../refine/Refine';
import { SeasonSettingsForm } from './SeasonSettingsForm';
import { seasonError, type SeasonView } from './seasonViewTypes';
import './seasonViews.css';

export function SeasonsPage() {
  const { user, canOrganise, hasRole } = useAuth();
  const canCreate = canOrganise() || (typeof hasRole === 'function' && hasRole('Manager'));
  const [seasons, setSeasons] = useState<SeasonView[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [params, setParams] = useSearchParams();
  const creating = canCreate && params.get('new') !== null;
  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    api.get<SeasonView[]>('/seasons', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setSeasons(data); setError(''); }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(seasonError(reason, 'Seasons couldn’t be loaded. Try again.'));
    });
    return () => controller.abort();
  }, [attempt, user?.id]);

  if (creating) {
    return <RefinePage>
      <RefineHeader back="/seasons" backLabel="Back to seasons" context="Seasons" title="Create a season" subtitle="Set division and points. Rounds can be added later." />
      <SeasonSettingsForm key={user?.id} create label="Create season" onCancel={() => setParams({})} onSave={async (settings) => {
        const { data } = await api.post<SeasonView>('/seasons', settings);
        navigate(`/seasons/${data.id}`);
      }} />
    </RefinePage>;
  }

  const years = seasons ? [...new Set(seasons.map((season) => season.year))].sort((a, b) => b - a) : [];
  return <RefinePage>
    <RefineHeader
      context="Published standings" title="Seasons"
      actions={canCreate ? <Link className="rf-btn" to="?new=1"><Plus className="h-4 w-4" aria-hidden="true" />Create season</Link> : undefined}
    />
    <ResultsStatsNav />
    {error && <div role="alert" className="mg-notice sv-msg">{error} <button className="mg-text-link min-h-11" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
    {!seasons && !error && <p role="status" className="rf-note">Loading seasons…</p>}
    {seasons?.length === 0 && <div className="sv-empty"><h2>No seasons yet</h2><p>Published season tables will appear here.</p>{canCreate && <Link className="rf-btn rf-btn-primary" style={{ marginTop: 12 }} to="?new=1">Create the first season</Link>}</div>}
    {years.map((year) => {
      const group = seasons?.filter((season) => season.year === year) ?? [];
      return <section key={year} aria-label={`${year} seasons`}>
        <RefineSection title={String(year)} meta={`${group.length} ${group.length === 1 ? 'season' : 'seasons'}`} />
        <RefineList label={`${year} seasons`}>
          {group.map((season) => {
            const roundCount = season.rounds.filter((round) => round.isIncluded).length;
            return <li key={season.id}>
              <Link className="rf-row" to={`/seasons/${season.id}`}>
                <span className="rf-grow">
                  <span className="rf-t1">{season.title}</span>
                  <span className="rf-t2">{SectionFormatLabel[season.format]} · {season.ageGroup} · {roundCount} {roundCount === 1 ? 'round' : 'rounds'} · {season.bestResultsToCount ? `best ${season.bestResultsToCount} count` : 'all count'}</span>
                </span>
                <Chevron />
              </Link>
            </li>;
          })}
        </RefineList>
      </section>;
    })}
  </RefinePage>;
}
