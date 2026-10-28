import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useT } from '../../i18n/LanguageContext';
import { useAuth } from '../../auth/AuthContext';
import { competitionPhase, entryPhaseOnly } from '../../lib/competitionPhase';
import { useCompetition } from './context';
import { MyStewardDutyBanner } from './MyStewardDutyBanner';
import { SessionsTab } from './SessionsTab';
import { BeforeTheDayRow } from './BeforeTheDayRow';

const EntryPage = lazy(() => import('./EntryPage').then((module) => ({ default: module.EntryPage })));
const ScoringTab = lazy(() => import('./ScoringTab').then((module) => ({ default: module.ScoringTab })));

/** The competition's home: the entry page while no timetable exists, the toplist once finals complete, otherwise the timetable. */
export function CompetitionHome() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const t = useT();
  if (competitionPhase(competition) === 'complete') {
    return (
      <>
        <div className="mt-3 flex">
          <Link to={`/competitions/${competition.id}/timetable`} className="sp-pill">{t('competition.home.fullTimetable')}</Link>
        </div>
        <Suspense fallback={null}><ScoringTab startOn="toplist" /></Suspense>
      </>
    );
  }
  if (!entryPhaseOnly(competition, canOrganise(competition))) return <><BeforeTheDayRow competition={competition} /><MyStewardDutyBanner /><SessionsTab /></>;
  return <Suspense fallback={null}><EntryPage /></Suspense>;
}

/** `/timetable`: the timetable itself, which stays reachable after the finish. Before the draw it goes back to the entry page. */
export function TimetableRoute() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  if (competitionPhase(competition) !== 'complete' && entryPhaseOnly(competition, canOrganise(competition))) return <Navigate to=".." replace />;
  return <><MyStewardDutyBanner /><SessionsTab /></>;
}

/** Keeps all competition tabs visible and accessible even before the draw. */
export function AfterDrawOnly({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
