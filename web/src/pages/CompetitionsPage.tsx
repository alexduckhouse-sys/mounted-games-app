import { CompetitionPicker } from '../competition/CompetitionPicker';
import { ResultsStatsNav } from '../components/ResultsStatsNav';

export function CompetitionsPage({ past = false }: { past?: boolean }) {
  return (
    <>
      {past && (
        <div className="mg-band mg-band-header pb-2 pt-0.5 [&_[aria-current=page]]:!border-white/70">
          <ResultsStatsNav />
        </div>
      )}
      <CompetitionPicker past={past} />
    </>
  );
}
