import { lazy, Suspense, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { TimetableBoard } from './TimetableBoard';

const TimetableManagement = lazy(() => import('./TimetableManagement').then((module) => ({ default: module.TimetableManagement })));

export function SessionsTab() {
  const { canEdit } = useAuth();
  const [manage, setManage] = useState(false);
  return <>
    <TimetableBoard />
    <div className="mt-4">
      <button className="btn-ghost min-h-11" aria-expanded={manage} onClick={() => setManage((open) => !open)}>{manage ? 'Close timetable details' : canEdit() ? 'Manage timetable' : 'Find a team or download timetable'}</button>
      {manage && <Suspense fallback={<p>Loading timetable controls…</p>}><TimetableManagement /></Suspense>}
    </div>
  </>;
}
