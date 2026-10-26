import { lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { competitionPhase, entryPhaseOnly } from '../../lib/competitionPhase';
import { useCompetition } from './context';
import { SessionsTab } from './SessionsTab';
import { ScoringTab } from './ScoringTab';

const EntryPage = lazy(() => import('./EntryPage').then((module) => ({ default: module.EntryPage })));

/** The competition's home: the entry page while no timetable exists, the toplist once finals complete, otherwise the timetable. */
export function CompetitionHome() {
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  if (competitionPhase(competition) === 'complete') return <ScoringTab startOn="toplist" />;
  if (!entryPhaseOnly(competition, canOrganise(competition))) return <SessionsTab />;
  return <Suspense fallback={null}><EntryPage /></Suspense>;
}

/** Keeps all competition tabs visible and accessible even before the draw. */
export function AfterDrawOnly({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
