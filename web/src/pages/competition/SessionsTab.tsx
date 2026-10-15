import { lazy, Suspense, useMemo, useState } from 'react';
import { ChevronRight, Download, Search } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { computeTimings } from '../../lib/time';
import { exportTimetableCsv } from '../../lib/timetableCsv';
import { useCompetition } from './context';
import { TimetableBoard } from './TimetableBoard';
import { TeamFinder } from './TeamFinder';

const TimetableManagement = lazy(() => import('./TimetableManagement').then((module) => ({ default: module.TimetableManagement })));

export function SessionsTab() {
  const { canEdit } = useAuth();
  const { competition } = useCompetition();
  const [finding, setFinding] = useState(false);
  const [manage, setManage] = useState(false);
  const ordered = useMemo(() => competition.sessions.slice().sort((a, b) => a.orderIndex - b.orderIndex), [competition.sessions]);
  const lead = competition.teams.length > 0 && ordered.length > 0 && (
    <div className="flex flex-col gap-3">
      <button type="button" className="mg-tint-link" aria-expanded={finding} onClick={() => setFinding((open) => !open)}>
        <Search aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1">Find my team's heats</span>
        <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${finding ? 'rotate-90' : ''}`} />
      </button>
      {finding && <TeamFinder autoFocus />}
    </div>
  );
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
    <TimetableBoard lead={lead || undefined} footer={footer} />
    {manage && <div className="mt-2"><Suspense fallback={<p role="status" className="mg-meta">Loading timetable controls…</p>}><TimetableManagement /></Suspense></div>}
  </>;
}
