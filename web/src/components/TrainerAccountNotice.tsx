import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function TrainerAccountNotice() {
  const { trainerNotice, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!trainerNotice || !['/', '/me', '/me/'].includes(pathname)) return null;

  return (
    <div role="status" className="mb-3 mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
      {trainerNotice === 'requested' ? (
        <p>Thanks. Your request needs approving before you can organise. You can use the app as a member in the meantime.</p>
      ) : (
        <>
          <p>Your account was approved. Sign in again to start organising.</p>
          <button type="button" className="btn-ghost" onClick={() => { logout(); navigate('/login', { replace: true }); }}>
            Sign in again
          </button>
        </>
      )}
    </div>
  );
}
