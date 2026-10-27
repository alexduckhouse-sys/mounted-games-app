import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../lib/apiError';
import { PageProblem } from '../components/PageProblem';
import { useT } from '../i18n/LanguageContext';
import { tr } from '../i18n/translate';
import '../components/sitePages.css';

type Phase = 'working' | 'done' | 'failed';

/**
 * Opened from the link in the confirmation email. Confirming needs the person signed in to the account the email was sent
 * for: whoever reads a mailbox isn't always its account's owner, and a confirmed address lets staff accounts reset their
 * password by email. Signed out, the page asks them to sign in and comes back here with the link (the sign-in page returns
 * to `from`), which also covers opening the email on a different device from the one they signed up on.
 */
export function ConfirmEmailPage() {
  const t = useT();
  const [params] = useSearchParams();
  const location = useLocation();
  const userId = params.get('userId')?.trim() ?? '';
  const token = params.get('token')?.trim() ?? '';
  const { user, refreshUser, logout } = useAuth();
  const complete = userId !== '' && token !== '';
  const signedInHere = !!user && user.id === userId;
  const [phase, setPhase] = useState<Phase>('working');
  const [message, setMessage] = useState('');

  const run = useCallback(async () => {
    setPhase('working');
    try {
      await api.post('/auth/confirm-email', { userId, token });
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
          <Link to="/login" state={{ from: location.pathname + location.search }} className="sp-pill sp-pill-fill">{t('shell.confirmEmail.signIn')}</Link>
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
