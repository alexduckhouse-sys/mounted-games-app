import { CompetitionPicker } from '../competition/CompetitionPicker';

/** `/events` and `/competitions` list what is coming up; `/competitions/past` is the archive. */
export function CompetitionsPage({ past = false }: { past?: boolean }) {
  return <CompetitionPicker past={past} />;
}
