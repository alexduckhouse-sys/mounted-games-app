import { Navigate } from 'react-router-dom';

/** Sponsors now appear grouped by tier directly on the Details tab; `/competitions/:id/sponsors` redirects there. */
export function SponsorsPage() {
  return <Navigate to="../details" replace />;
}
