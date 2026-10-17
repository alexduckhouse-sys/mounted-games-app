import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { SectionFormatLabel } from '../../types';
import { SeasonSettingsForm } from './SeasonSettingsForm';
import { seasonError, type SeasonView } from './seasonViewTypes';
import './seasonViews.css';

export function SeasonsPage() {
  const { user, canOrganise, hasRole, canEdit } = useAuth();
  const canCreate = canOrganise() && (!hasRole('Admin') || canEdit());
  const [seasons, setSeasons] = useState<SeasonView[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'list' | 'create'>('list');
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

  if (view === 'create' && canCreate) {
    return <div className="skin season-shell season-shell-narrow py-5">
      <button type="button" className="mg-text-link mb-5 inline-flex min-h-11 items-center gap-1" onClick={() => setView('list')}>
        <ChevronLeft className="h-4 w-4" /> Back to seasons
      </button>
      <header className="season-heading">
        <p className="season-kicker">New competition series</p>
        <h1 className="mg-h1">Create a season</h1>
        <p className="mg-meta mt-2">Set the division and points once. You can add event rounds after the season is created.</p>
      </header>
      <SeasonSettingsForm key={user?.id} label="Create season" onCancel={() => setView('list')} onSave={async (settings) => {
        const { data } = await api.post<SeasonView>('/seasons', settings);
        navigate(`/seasons/${data.id}`);
      }} />
    </div>;
  }

  return <div className="skin season-shell py-5">
    <header className="season-index-header">
      <div>
        <p className="season-kicker">Published standings</p>
        <h1 className="mg-h1">Seasons</h1>
        <p className="mg-meta mt-2 max-w-xl">Follow the same teams across a series of events. Each table uses results published by the season organiser.</p>
      </div>
      {canCreate && <button className="mg-btn mg-btn-primary" onClick={() => setView('create')}><Plus className="h-4 w-4" />Create season</button>}
    </header>

    {error && <div role="alert" className="mg-notice">{error} <button className="mg-text-link min-h-11" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
    {!seasons && !error && <p role="status" className="season-loading">Loading seasons…</p>}
    {seasons?.length === 0 && <div className="season-empty"><h2>No seasons yet</h2><p>Published season tables will appear here.</p>{canCreate && <button className="mg-btn mg-btn-primary mt-4" onClick={() => setView('create')}>Create the first season</button>}</div>}
    {!!seasons?.length && <ul className="season-list" aria-label="Seasons">
      {seasons.map((season) => {
        const roundCount = season.rounds.filter((round) => round.isIncluded).length;
        return <li key={season.id}>
          <Link className="season-list-row" to={`/seasons/${season.id}`}>
            <span className="season-year">{season.year}</span>
            <span className="season-list-main">
              <strong>{season.title}</strong>
              <span>{SectionFormatLabel[season.format]} · {season.ageGroup}</span>
            </span>
            <span className="season-list-count"><strong>{roundCount}</strong><span>{roundCount === 1 ? 'round' : 'rounds'}</span></span>
            <span className="season-list-rule">{season.bestResultsToCount ? `Best ${season.bestResultsToCount}` : 'All count'}</span>
            <ChevronRight aria-hidden="true" className="h-5 w-5" />
          </Link>
        </li>;
      })}
    </ul>}
  </div>;
}
