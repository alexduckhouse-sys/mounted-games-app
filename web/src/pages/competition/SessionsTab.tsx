import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { computeTimings } from '../../lib/time';
import { exportTimetableCsv } from '../../lib/timetableCsv';
import { useCompetition } from './context';
import { TimetableBoard } from './TimetableBoard';

export function SessionsTab() {
  const { canManage } = useAuth();
  const { competition } = useCompetition();
  const ordered = useMemo(
    () =>
      competition.sessions
        .slice()
        .sort((a, b) => {
          const aTime = a.scheduledStart ? new Date(a.scheduledStart).getTime() : Infinity;
          const bTime = b.scheduledStart ? new Date(b.scheduledStart).getTime() : Infinity;
          return aTime - bTime || a.orderIndex - b.orderIndex;
        }),
    [competition.sessions],
  );
  const showManage = canManage(competition);
  const footer = (ordered.length > 0 || showManage) ? (
    <nav aria-label="Timetable tools" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 pt-1 text-xs text-[rgb(var(--mg-muted))]">
      {ordered.length > 0 && (
        <button
          type="button"
          className="mg-text-link inline-flex items-center gap-1 text-xs"
          onClick={() => exportTimetableCsv(competition.name, ordered, computeTimings(competition.sessions))}
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download timetable
        </button>
      )}
      {showManage && (
        <>
          {ordered.length > 0 && <span aria-hidden="true">·</span>}
          <Link className="mg-text-link text-xs" to={`/admin/competitions/${competition.id}/format`}>Manage timetable</Link>
        </>
      )}
    </nav>
  ) : undefined;
  return <TimetableBoard footer={footer} />;
}
