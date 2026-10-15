import { CompetitionPicker } from '../competition/CompetitionPicker';

export function CompetitionsPage({ past = false }: { past?: boolean }) {
  return <CompetitionPicker past={past} />;
}
