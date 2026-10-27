import { lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { competitionPhase, entryPhaseOnly } from '../../lib/competitionPhase';
import { useCompetition } from './context';
import { MyStewardDutyBanner } from './MyStewardDutyBanner';
import { SessionsTab } from './SessionsTab';

const EntryPage = lazy(() => import('./EntryPage').then((module) => ({ default: module.EntryPage })));
const ScoringTab = lazy(() => import('./ScoringTab').then((module) => ({ default: module.ScoringTab })));

/** The competition's home: the entry page while no timetable exists, the toplist once finals complete, otherwise the timetable. */
export function CompetitionHome() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  if (competitionPhase(competition) === 'complete') {
    return <Suspense fallback={null}><ScoringTab startOn="toplist" /></Suspense>;
  }
  if (!entryPhaseOnly(competition, canOrganise(competition))) return <><MyStewardDutyBanner /><SessionsTab /></>;
  return <Suspense fallback={null}><EntryPage /></Suspense>;
}

/** Keeps all competition tabs visible and accessible even before the draw. */
export function AfterDrawOnly({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
