import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { Notice } from '../../components/Notice';
import { PageProblem } from '../../components/PageProblem';
import { useT } from '../../i18n/LanguageContext';
import { sectionFormatText } from '../../lib/sectionFormatText';
import { RefineHeader, RefinePage } from '../refine/Refine';
import { AddBar } from '../admin/creator/controls';
import { useDockAction } from '../../components/TickerContext';
import '../../components/sitePages.css';
import { SeasonSettingsForm } from './SeasonSettingsForm';
import { seasonError, type SeasonView } from './seasonViewTypes';
import './seasonViews.css';

export function SeasonsPage() {
  const t = useT();
  const { user, canOrganise, hasRole } = useAuth();
  const canCreate = canOrganise() || (typeof hasRole === 'function' && hasRole('Manager'));
  const [seasons, setSeasons] = useState<SeasonView[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [params, setParams] = useSearchParams();
  const creating = canCreate && params.get('new') !== null;
  const navigate = useNavigate();
  usePageHeader({ title: t('site.seasons.title'), plain: true });
  const createLabel = seasons?.length ? t('site.seasons.create') : t('site.seasons.createFirst');
  // The organiser's one action sits by the ticker dock; a page rendered without a dock keeps its own bar.
  const docked = useDockAction(canCreate && seasons && !creating ? { label: createLabel, icon: 'plus', onClick: () => setParams({ new: '1' }) } : null);

  useEffect(() => {
    const controller = new AbortController();
    api.get<SeasonView[]>('/seasons', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setSeasons(data); setError(''); }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(seasonError(reason, t('site.seasons.loadFailed')));
    });
    return () => controller.abort();
  }, [attempt, user?.id, t]);

  if (creating) {
    return <RefinePage>
      <RefineHeader back="/seasons" backLabel={t('site.seasons.backToSeasons')} context={t('site.seasons.title')} title={t('site.seasons.create')} subtitle={t('site.seasons.createSub')} />
      <SeasonSettingsForm key={user?.id} create label={t('site.seasons.createLabel')} onCancel={() => setParams({})} onSave={async (settings) => {
        const { data } = await api.post<SeasonView>('/seasons', settings);
        navigate(`/seasons/${data.id}`);
      }} />
    </RefinePage>;
  }

  const years = seasons ? [...new Set(seasons.map((season) => season.year))].sort((a, b) => b - a) : [];
  return <RefinePage>
    <h1 className="sr-only">{t('site.seasons.title')}</h1>
    {error && !seasons && <PageProblem title={t('site.seasons.loadTitle')} primaryLabel={t('common.tryAgain')} onPrimary={() => setAttempt((value) => value + 1)}>{error}</PageProblem>}
    {error && seasons && <Notice className="sv-msg" actionLabel={t('common.tryAgain')} onAction={() => setAttempt((value) => value + 1)}>{error}</Notice>}
    {!seasons && !error && <p role="status" className="sp-note">{t('site.seasons.loading')}</p>}
    {seasons?.length === 0 && <div className="sv-empty"><h2>{t('site.seasons.none')}</h2><p>{t('site.seasons.noneBody')}</p></div>}
    {years.map((year, index) => {
      const group = seasons?.filter((season) => season.year === year) ?? [];
      return <section key={year} aria-label={t('site.seasons.yearSeasons', { year })}>
        <h2 className={`sp-sec ${index === 0 ? 'sp-first' : ''}`.trim()}>{year}</h2>
        <ul className="sp-card m-0 list-none p-0" aria-label={t('site.seasons.yearSeasons', { year })}>
          {group.map((season) => {
            const roundCount = season.rounds.filter((round) => round.isIncluded).length;
            return <li key={season.id}>
              <Link className="sp-row" to={`/seasons/${season.id}`}>
                <span className="sp-grow">
                  <span className="sp-t1">{season.title}</span>
                  <span className="sp-t2">{sectionFormatText(season.format, t)} · {season.ageGroup} · {t('site.seasons.rounds', { count: roundCount })} · {season.bestResultsToCount ? t('site.seasons.bestCount', { count: season.bestResultsToCount }) : t('site.seasons.allCount')}</span>
                </span>
                <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
              </Link>
            </li>;
          })}
        </ul>
      </section>;
    })}
    {canCreate && seasons && !docked && <div className="sp-gap"><AddBar onClick={() => setParams({ new: '1' })}>{createLabel}</AddBar></div>}
  </RefinePage>;
}
