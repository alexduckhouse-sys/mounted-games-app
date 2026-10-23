import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useCompetition } from './context';

/** Opens the shared rulebooks, so scorers and arena staff can look a rule up without leaving the event. */
export function RulesLink({ className = '' }: { className?: string }) {
  const { competition } = useCompetition();
  return (
    <Link to={`/competitions/${competition.id}/rulebooks`} className={`btn-ghost !py-1.5 !px-2.5 text-xs ${className}`}>
      <BookOpen aria-hidden="true" className="w-3.5 h-3.5" /> Rules
    </Link>
  );
}
