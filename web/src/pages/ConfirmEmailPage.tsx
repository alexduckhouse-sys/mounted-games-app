import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../lib/apiError';
import { PageProblem } from '../components/PageProblem';
import '../components/sitePages.css';

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
      setMessage(apiErrorMessage(err, 'We couldn’t confirm your email address. Check your signal and try again.'));
      setPhase('failed');
    }
  }, [userId, token, refreshUser]);

  useEffect(() => {
    if (!userId || !token) return;
    // Opening the link twice does no harm, so StrictMode's second run is fine.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [userId, token, run]);

  if (phase === 'failed') {
    return (
      <PageProblem title="Couldn’t confirm your email" primaryLabel="Try again" onPrimary={() => void run()} secondaryLabel="Back to the app" secondaryTo="/">
        {message} If the link has expired, sign in and use the “Send it again” button on your profile.
      </PageProblem>
    );
  }
  if (phase === 'incomplete') {
    return (
      <PageProblem title="This link looks incomplete" secondaryLabel="Back to the app" secondaryTo="/">
        Use the link in the email we sent you.
      </PageProblem>
    );
  }

  return (
    <div className="skin mx-auto w-full max-w-[560px]">
      <div className="sp-small">
        <h1>Confirm your email</h1>
        {phase === 'working' && <p role="status">One moment…</p>}
        {phase === 'done' && (
          <>
            <p role="status">Thanks, your email address is confirmed.</p>
            <Link to={user ? '/me' : '/login'} className="sp-pill sp-pill-fill">{user ? 'Go to my profile' : 'Sign in'}</Link>
          </>
        )}
      </div>
    </div>
  );
}
