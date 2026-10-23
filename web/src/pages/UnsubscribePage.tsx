import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

type Phase = 'working' | 'done' | 'failed' | 'incomplete';

/**
 * Opened from the link in an email. It needs no sign-in and says the same thing whether or not the
 * address was on the list, so it can't be used to find out who is.
 */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const [phase, setPhase] = useState<Phase>(token ? 'working' : 'incomplete');

  const run = useCallback(async () => {
    setPhase('working');
    try {
      await api.post('/email/unsubscribe', { token });
      setPhase('done');
    } catch {
      setPhase('failed');
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    // Asking twice does no harm, so StrictMode's second run is fine.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [token, run]);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Competition emails</h1>
      {phase === 'working' && <p role="status">One moment…</p>}
      {phase === 'done' && (
        <>
          <p role="status" className="font-semibold">That's done. We won't email you when new competitions open.</p>
          <p>If you change your mind, tick the box next time you enter a competition.</p>
        </>
      )}
      {phase === 'failed' && (
        <>
          <p role="alert" className="font-semibold">Something went wrong, and we couldn't update your choice.</p>
          <button type="button" className="mg-btn mg-btn-primary" onClick={() => void run()}>Try again</button>
        </>
      )}
      {phase === 'incomplete' && (
        <p role="alert">This link looks incomplete. Please use the link in the email we sent you.</p>
      )}
      <p><Link to="/" className="underline">Back to Mounted Games</Link></p>
    </div>
  );
}
