import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../lib/apiError';
import { PageProblem } from '../components/PageProblem';
import { useT } from '../i18n/LanguageContext';
import { tr } from '../i18n/translate';
import '../components/sitePages.css';

type Phase = 'working' | 'done' | 'failed';
type ConfirmLink = { userId: string; token: string };

/** Where the link waits while its owner signs in: this tab only, and never in an address a server sees. */
const CONFIRM_LINK_KEY = 'mg.confirmEmail.link';

function stored(): ConfirmLink | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(CONFIRM_LINK_KEY) ?? 'null') as Partial<ConfirmLink> | null;
    return typeof value?.userId === 'string' && typeof value.token === 'string' ? { userId: value.userId, token: value.token } : null;
  } catch { return null; }
}

function keep(link: ConfirmLink | null) {
  try {
    if (link) sessionStorage.setItem(CONFIRM_LINK_KEY, JSON.stringify(link));
    else sessionStorage.removeItem(CONFIRM_LINK_KEY);
  } catch { /* storage may be blocked; the link then lasts as long as the page */ }
}

/**
 * The link's account and token: from the fragment (`#u=…&t=…`, which browsers never send to a server), from the query
 * string older emails used (`?userId=…&token=…`), or from this tab's storage after a sign-in. One found in the address is
 * kept for the sign-in round trip and taken out of the address bar and history.
 */
function readLink(): ConfirmLink | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const userId = (hash.get('u') ?? query.get('userId'))?.trim() ?? '';
  const token = (hash.get('t') ?? query.get('token'))?.trim() ?? '';
  if (window.location.hash || query.has('userId') || query.has('token')) {
    try { window.history.replaceState(window.history.state, '', window.location.pathname); } catch { /* history may be blocked */ }
  }
  if (userId && token) {
    keep({ userId, token });
    return { userId, token };
  }
  return stored();
}

/**
 * Opened from the link in the confirmation email. Confirming needs the person signed in to the account the email was sent
 * for: whoever reads a mailbox isn't always its account's owner, and a confirmed address lets staff accounts reset their
 * password by email. Signed out, the page asks them to sign in and the sign-in page returns to `/confirm-email` (`from`),
 * which also covers opening the email on a different device from the one they signed up on. The token waits in this tab's
 * sessionStorage meanwhile, never in the return address, and is dropped once the address is confirmed.
 */
export function ConfirmEmailPage() {
  const t = useT();
  // Read once: the address is cleaned straight after, and StrictMode keeps this state across its second render.
  const [link] = useState(readLink);
  const userId = link?.userId ?? '';
  const token = link?.token ?? '';
  const { user, refreshUser, logout } = useAuth();
  const complete = link !== null;
  const signedInHere = !!user && user.id === userId;
  const [phase, setPhase] = useState<Phase>('working');
  const [message, setMessage] = useState('');

  const run = useCallback(async () => {
    setPhase('working');
    try {
      await api.post('/auth/confirm-email', { userId, token });
      keep(null);
      setPhase('done');
      await refreshUser();
    } catch (err) {
      setMessage(apiErrorMessage(err, tr('shell.confirmEmail.fallback')));
      setPhase('failed');
    }
  }, [userId, token, refreshUser]);

  useEffect(() => {
    if (!complete || !signedInHere) return;
    // Opening the link twice does no harm, so StrictMode's second run is fine.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [complete, signedInHere, run]);

  if (!complete) {
    return (
      <PageProblem title={t('shell.page.incompleteTitle')} secondaryLabel={t('shell.page.backToApp')} secondaryTo="/">
        {t('shell.page.incompleteBody')}
      </PageProblem>
    );
  }
  if (!user) {
    return (
      <div className="skin mx-auto w-full max-w-[560px]">
        <div className="sp-small">
          <h1>{t('shell.confirmEmail.title')}</h1>
          <p>{t('shell.confirmEmail.signInBody')}</p>
          <Link to="/login" state={{ from: '/confirm-email' }} className="sp-pill sp-pill-fill">{t('shell.confirmEmail.signIn')}</Link>
        </div>
      </div>
    );
  }
  if (!signedInHere) {
    return (
      <PageProblem title={t('shell.confirmEmail.otherTitle')} primaryLabel={t('common.signOut')} onPrimary={logout} secondaryLabel={t('shell.page.backToApp')} secondaryTo="/">
        {t('shell.confirmEmail.otherBody')}
      </PageProblem>
    );
  }
  if (phase === 'failed') {
    return (
      <PageProblem title={t('shell.confirmEmail.failedTitle')} primaryLabel={t('common.tryAgain')} onPrimary={() => void run()} secondaryLabel={t('shell.page.backToApp')} secondaryTo="/">
        {t('shell.confirmEmail.failedBody', { message })}
      </PageProblem>
    );
  }

  return (
    <div className="skin mx-auto w-full max-w-[560px]">
      <div className="sp-small">
        <h1>{t('shell.confirmEmail.title')}</h1>
        {phase === 'working' && <p role="status">{t('shell.page.oneMoment')}</p>}
        {phase === 'done' && (
          <>
            <p role="status">{t('shell.confirmEmail.done')}</p>
            <Link to="/me" className="sp-pill sp-pill-fill">{t('shell.confirmEmail.toProfile')}</Link>
          </>
        )}
      </div>
    </div>
  );
}
