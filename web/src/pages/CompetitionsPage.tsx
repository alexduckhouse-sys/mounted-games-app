import { CompetitionPicker } from '../competition/CompetitionPicker';
import { ResultsStatsNav } from '../components/ResultsStatsNav';

export function CompetitionsPage({ past = false }: { past?: boolean }) {
  return (
    <>
      {past && <ResultsStatsNav />}
      <CompetitionPicker past={past} />
    </>
  );
}
