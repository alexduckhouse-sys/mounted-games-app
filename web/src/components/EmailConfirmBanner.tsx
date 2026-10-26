import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorStatus } from '../lib/apiError';
import { Notice } from './Notice';
import { useToast } from './Toast';

type Phase = 'idle' | 'sending' | 'sent' | 'notSent' | 'failed' | 'slow';

/**
 * A gentle nudge for someone who hasn't confirmed their email address yet. Sign-in is not blocked. Says plainly
 * when the email couldn't be sent (sending switched off, or the provider was down) instead of pretending it went.
 */
export function EmailConfirmBanner() {
  const { user, refreshUser } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const toast = useToast();
  if (!user || user.emailConfirmed !== false) return null;

  async function resend() {
    setPhase('sending');
    try {
      const { data } = await api.post<{ status?: string }>('/auth/resend-confirmation');
      if (data?.status === 'AlreadyConfirmed') { await refreshUser(); return; }
      if (data?.status === 'Sent') { setPhase('sent'); toast.show('New link sent. Check your spam too.'); return; }
      setPhase(data?.status === 'NotSent' ? 'notSent' : 'failed');
    } catch (err) {
      setPhase(apiErrorStatus(err) === 429 ? 'slow' : 'failed');
    }
  }

  const problem: Partial<Record<Phase, string>> = {
    notSent: 'We couldn’t send the email just now, because email isn’t switched on here. Try again later.',
    failed: 'We couldn’t send the email just now. Try again in a few minutes.',
    slow: 'You’ve asked a few times in a row. Wait a minute, then try again.',
  };

  return (
    <div className="flex flex-col gap-2">
      <Notice
        tone="info"
        icon={MailCheck}
        actionLabel={phase === 'sending' ? 'Sending…' : 'Send it again'}
        actionDisabled={phase === 'sending'}
        onAction={() => void resend()}
      >
        Confirm your email address. We sent a link to <span className="font-semibold">{user.email}</span>.
      </Notice>
      {problem[phase] && <Notice>{problem[phase]}</Notice>}
      {toast.node}
    </div>
  );
}
