import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { PageProblem } from '../components/PageProblem';
import '../components/sitePages.css';

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

  if (phase === 'failed') {
    return (
      <PageProblem title="Couldn’t update your choice" primaryLabel="Try again" onPrimary={() => void run()} secondaryLabel="Back to the app" secondaryTo="/">
        Something went wrong. Check your signal and try again.
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
        <h1>Competition emails</h1>
        {phase === 'working' && <p role="status">One moment…</p>}
        {phase === 'done' && (
          <>
            <p role="status">That's done. We won't email you when new competitions open.</p>
            <p>If you change your mind, tick the box next time you enter a competition.</p>
            <Link to="/" className="sp-pill">Back to the app</Link>
          </>
        )}
      </div>
    </div>
  );
}
