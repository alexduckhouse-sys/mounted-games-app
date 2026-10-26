import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Notice } from './Notice';

export function TrainerAccountNotice() {
  const { trainerNotice, logout } = useAuth();
  const navigate = useNavigate();
  if (!trainerNotice) return null;

  return (
    <div className="mb-3 mt-4">
      {trainerNotice === 'requested' ? (
        <Notice tone="info">Your trainer request is waiting for approval. You can use the app as a member until then.</Notice>
      ) : (
        <Notice tone="info" actionLabel="Sign in again" onAction={() => { logout(); navigate('/login', { replace: true }); }}>
          You’re approved as a trainer. Sign in again to start organising.
        </Notice>
      )}
    </div>
  );
}
