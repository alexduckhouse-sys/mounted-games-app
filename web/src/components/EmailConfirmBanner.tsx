import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorStatus } from '../lib/apiError';

type Phase = 'idle' | 'sending' | 'sent' | 'notSent' | 'failed' | 'slow';

/**
 * A gentle nudge for someone who hasn't confirmed their email address yet. Sign-in is not blocked. Says plainly
 * when the email couldn't be sent (sending switched off, or the provider was down) instead of pretending it went.
 */
export function EmailConfirmBanner() {
  const { user, refreshUser } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  if (!user || user.emailConfirmed !== false) return null;

  async function resend() {
    setPhase('sending');
    try {
      const { data } = await api.post<{ status?: string }>('/auth/resend-confirmation');
      if (data?.status === 'AlreadyConfirmed') { await refreshUser(); return; }
      setPhase(data?.status === 'Sent' ? 'sent' : data?.status === 'NotSent' ? 'notSent' : 'failed');
    } catch (err) {
      setPhase(apiErrorStatus(err) === 429 ? 'slow' : 'failed');
    }
  }

  const note: Record<Exclude<Phase, 'idle' | 'sending'>, string> = {
    sent: `We've sent a new link to ${user.email}. It can take a minute, and it's worth checking your spam folder.`,
    notSent: "We couldn't send the email just now, because email isn't switched on here. Please try again later.",
    failed: "We couldn't send the email just now. Please try again in a few minutes.",
    slow: "You've asked a few times in a row. Wait a minute, then try again.",
  };

  return (
    <div className="mg-card flex flex-col gap-2.5 px-3.5 py-3">
      <div className="flex items-start gap-3">
        <MailCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[rgb(var(--mg-heading))]" />
        <p className="m-0 flex-1 text-[15px] leading-snug text-[rgb(var(--mg-ink))]">
          Please confirm your email address. We sent a link to <span className="font-semibold">{user.email}</span>.
        </p>
      </div>
      <button type="button" className="mg-btn mg-btn-secondary !min-h-11 !text-[15px]" disabled={phase === 'sending'} onClick={() => void resend()}>
        {phase === 'sending' ? 'Sending…' : 'Resend email'}
      </button>
      {phase !== 'idle' && phase !== 'sending' && (
        <p role="status" className={`m-0 text-sm font-medium ${phase === 'sent' ? 'text-[rgb(var(--mg-ok))]' : 'text-[rgb(var(--mg-body))]'}`}>{note[phase]}</p>
      )}
    </div>
  );
}
