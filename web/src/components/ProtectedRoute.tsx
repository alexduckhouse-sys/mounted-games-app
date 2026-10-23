import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { signOutDestination } from '../auth/signOutDestination';
import type { Role } from '../types';
import type { ReactNode } from 'react';

export function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: Role[];
}) {
  const { user, signedOut } = useAuth();
  const loc = useLocation();
  // After a deliberate sign-out, leave the protected page for a public one instead of asking to sign in again.
  if (!user && signedOut) return <Navigate to={signOutDestination()} replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (roles && !roles.some((r) => user.roles.includes(r))) return <Navigate to="/" replace />;
  return <>{children}</>;
}
