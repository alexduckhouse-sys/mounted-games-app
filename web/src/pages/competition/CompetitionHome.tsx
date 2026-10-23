import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { entryPhaseOnly } from '../../lib/competitionPhase';
import { useCompetition } from './context';
import { SessionsTab } from './SessionsTab';

const EntryPage = lazy(() => import('./EntryPage').then((module) => ({ default: module.EntryPage })));

/** The competition's home: the entry page while entries are all there is to do, otherwise the timetable. */
export function CompetitionHome() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  if (!entryPhaseOnly(competition, canOrganise(competition))) return <SessionsTab />;
  return <Suspense fallback={null}><EntryPage /></Suspense>;
}

/** Wraps a page that has nothing to show before the teams are drawn: the public goes to the entry page instead. */
export function AfterDrawOnly({ children }: { children: ReactNode }) {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  if (entryPhaseOnly(competition, canOrganise(competition))) return <Navigate to={`/competitions/${competition.id}`} replace />;
  return <>{children}</>;
}
