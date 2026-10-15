import { lazy, Suspense, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { computeTimings } from '../../lib/time';
import { exportTimetableCsv } from '../../lib/timetableCsv';
import { useCompetition } from './context';
import { TimetableBoard } from './TimetableBoard';

const TimetableManagement = lazy(() => import('./TimetableManagement').then((module) => ({ default: module.TimetableManagement })));

export function SessionsTab() {
  const { canEdit } = useAuth();
  const { competition } = useCompetition();
  const [manage, setManage] = useState(false);
  const ordered = useMemo(() => competition.sessions.slice().sort((a, b) => a.orderIndex - b.orderIndex), [competition.sessions]);
  const footer = <>
    {ordered.length > 0 && (
      <button type="button" className="mg-btn mg-btn-secondary" onClick={() => exportTimetableCsv(competition.name, ordered, computeTimings(competition.sessions))}>
        <Download aria-hidden="true" className="h-[18px] w-[18px]" />Download timetable
      </button>
    )}
    <button type="button" className="mg-text-link self-center" aria-expanded={manage} onClick={() => setManage((open) => !open)}>
      {manage ? 'Close timetable details' : canEdit() ? 'Manage timetable' : 'Arena setup and full timetable'}
    </button>
  </>;
  return <>
    <TimetableBoard footer={footer} />
    {manage && <div className="mt-2"><Suspense fallback={<p role="status" className="mg-meta">Loading timetable controls…</p>}><TimetableManagement /></Suspense></div>}
  </>;
}
