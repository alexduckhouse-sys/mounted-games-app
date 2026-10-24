import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Download, Star } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { computeTimings } from '../../lib/time';
import { exportTimetableCsv } from '../../lib/timetableCsv';
import { useCompetition } from './context';
import { TimetableBoard } from './TimetableBoard';

export function SessionsTab() {
  const { canManage } = useAuth();
  const { competition } = useCompetition();
  const ordered = useMemo(() => competition.sessions.slice().sort((a, b) => a.orderIndex - b.orderIndex), [competition.sessions]);
  const footer = <>
    <Link className="mg-btn mg-btn-secondary" to="following"><Star className="h-4 w-4" />Follow teams</Link>
    {ordered.length > 0 && (
      <button type="button" className="mg-btn mg-btn-secondary" onClick={() => exportTimetableCsv(competition.name, ordered, computeTimings(competition.sessions))}>
        <Download aria-hidden="true" className="h-[18px] w-[18px]" />Download timetable
      </button>
    )}
    <Link className="mg-text-link self-center" to="arena">Arena setup</Link>
    {canManage(competition) && (
      <Link className="mg-text-link self-center" to={`/admin/competitions/${competition.id}/format`}>Manage timetable</Link>
    )}
  </>;
  return <TimetableBoard footer={footer} />;
}
