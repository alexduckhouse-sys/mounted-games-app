import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../lib/apiError';

type Phase = 'working' | 'done' | 'failed' | 'incomplete';

/**
 * Opened from the link in the confirmation email. It needs no sign-in. A wrong, used-up or expired link all get
 * the same answer, and the page points to the resend button on the profile.
 */
export function ConfirmEmailPage() {
  const [params] = useSearchParams();
  const userId = params.get('userId')?.trim() ?? '';
  const token = params.get('token')?.trim() ?? '';
  const { user, refreshUser } = useAuth();
  const [phase, setPhase] = useState<Phase>(userId && token ? 'working' : 'incomplete');
  const [message, setMessage] = useState('');

  const run = useCallback(async () => {
    setPhase('working');
    try {
      await api.post('/auth/confirm-email', { userId, token });
      setPhase('done');
      await refreshUser();
    } catch (err) {
      setMessage(apiErrorMessage(err, "We couldn't confirm your email address. Check your connection and try again."));
      setPhase('failed');
    }
  }, [userId, token, refreshUser]);

  useEffect(() => {
    if (!userId || !token) return;
    // Opening the link twice does no harm, so StrictMode's second run is fine.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [userId, token, run]);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Confirm your email</h1>
      {phase === 'working' && <p role="status">One moment…</p>}
      {phase === 'done' && (
        <>
          <p role="status" className="font-semibold">Thanks, your email address is confirmed.</p>
          <p><Link to={user ? '/me' : '/login'} className="mg-btn mg-btn-primary">{user ? 'Go to my profile' : 'Sign in'}</Link></p>
        </>
      )}
      {phase === 'failed' && (
        <>
          <p role="alert" className="font-semibold">{message}</p>
          <p>If the link has expired, sign in and use the "Resend email" button on your profile.</p>
          <button type="button" className="mg-btn mg-btn-secondary" onClick={() => void run()}>Try again</button>
        </>
      )}
      {phase === 'incomplete' && (
        <p role="alert">This link looks incomplete. Please use the link in the email we sent you.</p>
      )}
      <p><Link to="/" className="underline">Back to Mounted Games</Link></p>
    </div>
  );
}
