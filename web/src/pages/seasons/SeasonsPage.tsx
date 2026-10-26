import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { SectionFormatLabel } from '../../types';
import { RefineHeader, RefinePage } from '../refine/Refine';
import { AddBar } from '../admin/creator/controls';
import '../../components/sitePages.css';
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
  usePageHeader({ title: 'Seasons', plain: true });

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
    <h1 className="sr-only">Seasons</h1>
    {error && <div role="alert" className="mg-notice sv-msg">{error} <button className="mg-text-link min-h-11" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
    {!seasons && !error && <p role="status" className="sp-note">Loading seasons…</p>}
    {seasons?.length === 0 && <div className="sv-empty"><h2>No seasons yet</h2><p>Published season tables will appear here.</p></div>}
    {years.map((year, index) => {
      const group = seasons?.filter((season) => season.year === year) ?? [];
      return <section key={year} aria-label={`${year} seasons`}>
        <h2 className={`sp-sec ${index === 0 ? 'sp-first' : ''}`.trim()}>{year}</h2>
        <ul className="sp-card m-0 list-none p-0" aria-label={`${year} seasons`}>
          {group.map((season) => {
            const roundCount = season.rounds.filter((round) => round.isIncluded).length;
            return <li key={season.id}>
              <Link className="sp-row" to={`/seasons/${season.id}`}>
                <span className="sp-grow">
                  <span className="sp-t1">{season.title}</span>
                  <span className="sp-t2">{SectionFormatLabel[season.format]} · {season.ageGroup} · {roundCount} {roundCount === 1 ? 'round' : 'rounds'} · {season.bestResultsToCount ? `best ${season.bestResultsToCount} count` : 'all count'}</span>
                </span>
                <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
              </Link>
            </li>;
          })}
        </ul>
      </section>;
    })}
    {canCreate && seasons && <div className="sp-gap"><AddBar onClick={() => setParams({ new: '1' })}>{seasons.length ? 'Create a season' : 'Create the first season'}</AddBar></div>}
  </RefinePage>;
}
