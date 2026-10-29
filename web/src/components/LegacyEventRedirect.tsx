import { Navigate, useLocation, useParams } from 'react-router-dom';

/** Keep saved organiser links useful while sending new work through the current pages. */
export function LegacyEventRedirect() {
  const { id } = useParams();
  const { hash, search } = useLocation();
  if (!id) return <Navigate to="/events" replace />;
  const questions = hash === '#fm-dec' || hash === '#dec-form';
  return <Navigate to={`/competitions/${id}/${questions ? 'entries' : 'timetable-and-draw'}${search}${questions ? '#dec-form' : ''}`} replace />;
}
