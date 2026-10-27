import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorStatus } from '../lib/apiError';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { useT } from '../i18n/LanguageContext';

type Phase = 'idle' | 'sending' | 'sent' | 'notSent' | 'failed' | 'slow';

/**
 * A gentle nudge for someone who hasn't confirmed their email address yet. Sign-in is not blocked. Says plainly
 * when the email couldn't be sent (sending switched off, or the provider was down) instead of pretending it went.
 */
export function EmailConfirmBanner() {
  const t = useT();
  const { user, refreshUser } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const toast = useToast();
  if (!user || user.emailConfirmed !== false) return null;

  async function resend() {
    setPhase('sending');
    try {
      const { data } = await api.post<{ status?: string }>('/auth/resend-confirmation');
      if (data?.status === 'AlreadyConfirmed') { await refreshUser(); return; }
      if (data?.status === 'Sent') { setPhase('sent'); toast.show(t('shell.emailBanner.sent')); return; }
      setPhase(data?.status === 'NotSent' ? 'notSent' : 'failed');
    } catch (err) {
      setPhase(apiErrorStatus(err) === 429 ? 'slow' : 'failed');
    }
  }

  const problem: Partial<Record<Phase, string>> = {
    notSent: t('shell.emailBanner.notSent'),
    failed: t('shell.emailBanner.failed'),
    slow: t('shell.emailBanner.slow'),
  };

  return (
    <div className="flex flex-col gap-2">
      <Notice
        tone="info"
        icon={MailCheck}
        actionLabel={phase === 'sending' ? t('shell.emailBanner.sending') : t('shell.emailBanner.sendAgain')}
        actionDisabled={phase === 'sending'}
        onAction={() => void resend()}
      >
        {t('shell.emailBanner.confirm', { email: '{email}' }).split('{email}').flatMap((part, index) => (index === 0 ? [part] : [<span key="email" className="font-semibold">{user.email}</span>, part]))}
      </Notice>
      {problem[phase] && <Notice>{problem[phase]}</Notice>}
      {toast.node}
    </div>
  );
}
