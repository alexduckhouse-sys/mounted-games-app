import { Navigate } from 'react-router-dom';

/** The old admin page now lives on the Me dashboard; this keeps old links and bookmarks working. */
export function AdminPage() {
  return <Navigate to="/me#site-admin" replace />;
}
