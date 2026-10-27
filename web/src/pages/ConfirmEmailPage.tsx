import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../lib/apiError';
import { PageProblem } from '../components/PageProblem';
import { useT } from '../i18n/LanguageContext';
import { tr } from '../i18n/translate';
import '../components/sitePages.css';

type Phase = 'working' | 'done' | 'failed' | 'incomplete';

/**
 * Opened from the link in the confirmation email. It needs no sign-in. A wrong, used-up or expired link all get
 * the same answer, and the page points to the resend button on the profile.
 */
export function ConfirmEmailPage() {
  const t = useT();
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
      setMessage(apiErrorMessage(err, tr('shell.confirmEmail.fallback')));
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
      <PageProblem title={t('shell.confirmEmail.failedTitle')} primaryLabel={t('common.tryAgain')} onPrimary={() => void run()} secondaryLabel={t('shell.page.backToApp')} secondaryTo="/">
        {t('shell.confirmEmail.failedBody', { message })}
      </PageProblem>
    );
  }
  if (phase === 'incomplete') {
    return (
      <PageProblem title={t('shell.page.incompleteTitle')} secondaryLabel={t('shell.page.backToApp')} secondaryTo="/">
        {t('shell.page.incompleteBody')}
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
            <Link to={user ? '/me' : '/login'} className="sp-pill sp-pill-fill">{user ? t('shell.confirmEmail.toProfile') : t('common.signIn')}</Link>
          </>
        )}
      </div>
    </div>
  );
}
