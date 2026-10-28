import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { usePageHeader } from '../components/CompactPageBarContext';
import { PageProblem } from '../components/PageProblem';
import { useT } from '../i18n/LanguageContext';
import '../components/sitePages.css';

type Phase = 'working' | 'done' | 'failed' | 'incomplete';

/**
 * Opened from the link in an email. It needs no sign-in and says the same thing whether or not the
 * address was on the list, so it can't be used to find out who is.
 */
export function UnsubscribePage() {
  const t = useT();
  usePageHeader({ title: t('shell.unsubscribe.title'), plain: true });
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
      <PageProblem title={t('shell.unsubscribe.failedTitle')} primaryLabel={t('common.tryAgain')} onPrimary={() => void run()} secondaryLabel={t('shell.page.backToApp')} secondaryTo="/">
        {t('shell.unsubscribe.failedBody')}
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
        <h1>{t('shell.unsubscribe.title')}</h1>
        {phase === 'working' && <p role="status">{t('shell.page.oneMoment')}</p>}
        {phase === 'done' && (
          <>
            <p role="status">{t('shell.unsubscribe.done')}</p>
            <p>{t('shell.unsubscribe.changeMind')}</p>
            <Link to="/" className="sp-pill">{t('shell.page.backToApp')}</Link>
          </>
        )}
      </div>
    </div>
  );
}
