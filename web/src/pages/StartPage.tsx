import { Navigate } from 'react-router-dom';
import { CompetitionPicker } from '../competition/CompetitionPicker';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';

export function StartPage() {
  const { current } = useCurrentCompetition();
  return current ? <Navigate to={`/competitions/${current.id}`} replace /> : <CompetitionPicker />;
}
