import { Navigate } from 'react-router-dom';
import { CompetitionPicker } from '../competition/CompetitionPicker';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';

/** Opens straight into the competition only when the user asked this device to remember it; otherwise it is the events list. */
export function StartPage() {
  const { current, rememberChoice } = useCurrentCompetition();
  return current && rememberChoice === 'remember' ? <Navigate to={`/competitions/${current.id}`} replace /> : <CompetitionPicker />;
}
