import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Notice } from '../components/Notice';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { PasswordInput } from '../components/PasswordInput';
import { apiErrorStatus } from '../lib/apiError';
import { friendlyPasswordErrors, passwordMeetsRules } from '../lib/passwordRules';
import { tokenFromHash } from '../offline/scorerLink';
import { useT } from '../i18n/LanguageContext';
import type { PasswordResetCheck, PasswordResetProblem } from '../types';
import { AuthFrame } from './auth/AuthFrame';
import { Field } from './auth/Field';

/** Where the page is: checking the link, a link that can't be used (and why), the form, or done. */
type Phase =
  | { kind: 'checking' }
  | { kind: 'unreachable' }
  | { kind: 'dead'; why: 'expired' | 'used' | 'invalid' }
  | { kind: 'ready' }
  | { kind: 'done' };

const DEAD_WORDING: Record<'expired' | 'used' | 'invalid', string> = {
  expired: 'This link has expired or a newer one has replaced it. Links work for 30 minutes. Ask for a new one.',
  used: 'This link has already been used. If you changed your password with it, sign in with the new one.',
  invalid: 'This link isn’t valid. Check you opened the whole link from the email, or ask for a new one.',
};

function deadFromState(state: PasswordResetCheck['state']): 'expired' | 'used' | 'invalid' | null {
  return state === 1 ? 'expired' : state === 2 ? 'used' : state === 0 ? null : 'invalid';
}

/**
 * Opened from the emailed link `/reset-password#t=<token>`. The token sits in the fragment, which browsers never send to a
 * server; the page reads it once, takes it out of the address bar and history, and keeps it only in memory. A reset signs the
 * account out everywhere, so this device signs out too, and the person signs in again with the new password.
 */
export function ResetPasswordPage() {
  const t = useT();
  const { user, logout } = useAuth();
  const rulesId = useId();
  // Read once, before the effect below clears the fragment (StrictMode keeps this state across its second effect run).
  const [token] = useState(() => tokenFromHash(window.location.hash));
  const [phase, setPhase] = useState<Phase>(token ? { kind: 'checking' } : { kind: 'dead', why: 'invalid' });
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.location.hash) return;
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* history may be blocked */ }
  }, []);

  const check = useCallback(async (signal?: { cancelled: boolean }) => {
    if (!token) return;
    setPhase({ kind: 'checking' });
    try {
      const { data } = await api.post<PasswordResetCheck>('/auth/password-reset/check', { token });
      if (signal?.cancelled) return;
      const why = deadFromState(data?.state);
      setPhase(why ? { kind: 'dead', why } : { kind: 'ready' });
    } catch {
      if (!signal?.cancelled) setPhase({ kind: 'unreachable' });
    }
  }, [token]);

  useEffect(() => {
    const signal = { cancelled: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check(signal);
    return () => { signal.cancelled = true; };
  }, [check]);

  const ready = passwordMeetsRules(password) && !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !token) return;
    setError(null);
    setSaving(true);
    try {
      await api.post('/auth/password-reset/confirm', { token, newPassword: password });
      setPassword('');
      // Every session for the account has ended, including any on this device.
      if (user) logout();
      setPhase({ kind: 'done' });
    } catch (caught) {
      const status = apiErrorStatus(caught);
      const problem = (caught as { response?: { data?: Partial<PasswordResetProblem> } }).response?.data;
      if (problem?.code === 'expired' || problem?.code === 'used' || problem?.code === 'invalid') {
        setPhase({ kind: 'dead', why: problem.code });
      } else if (status === 400) {
        setError(friendlyPasswordErrors(problem)[0] || problem?.message || 'Choose a password that meets the rules below.');
      } else if (problem?.code === 'conflict' || problem?.code === 'failed') {
        // Nothing was saved and the link still works, so the form stays for another go.
        setError(t(problem.code === 'conflict' ? 'auth.reset.conflict' : 'auth.reset.failed'));
      } else if (status === 429) {
        setError('Too many tries. Wait a minute and try again.');
      } else {
        setError(problem?.message || 'Couldn’t change your password. Check your signal and try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthFrame>
      {phase.kind === 'checking' && <p role="status" className="text-[15px]">One moment…</p>}

      {phase.kind === 'unreachable' && (
        <div className="mg-swap flex flex-col gap-4">
          <h1 className="mg-h1 !text-[34px] !leading-none">Reset your password</h1>
          <Notice actionLabel="Try again" onAction={() => void check()}>Couldn’t check this link. Check your signal and try again.</Notice>
        </div>
      )}

      {phase.kind === 'dead' && (
        <div className="mg-swap flex flex-col gap-4">
          <h1 className="mg-h1 !text-[34px] !leading-none">Reset your password</h1>
          <Notice>{DEAD_WORDING[phase.why]}</Notice>
          {phase.why === 'used'
            ? <Link to="/login" className="mg-btn mg-btn-primary w-full">Sign in</Link>
            : <Link to="/forgot-password" className="mg-btn mg-btn-primary w-full">Send a new link</Link>}
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="mg-swap flex flex-col gap-4">
          <h1 className="mg-h1 !text-[34px] !leading-none">Password changed</h1>
          <Notice tone="info" icon={CircleCheck}>Your password has been changed and you’ve been signed out on every device. Sign in with your new password.</Notice>
          <Link to="/login" className="mg-btn mg-btn-primary w-full">Sign in</Link>
        </div>
      )}

      {phase.kind === 'ready' && (
        <form onSubmit={submit} className="mg-swap flex flex-1 flex-col gap-[18px]" noValidate>
          <h1 className="mg-h1 !text-[34px] !leading-none">Choose a new password</h1>
          <p className="m-0 text-[15px] text-[rgb(var(--mg-body))]">Once it’s changed, you’ll be signed out everywhere and can sign in with the new one.</p>
          <div className="flex flex-col gap-1.5">
            <Field label="New password" error={error}>
              {({ id, invalid, describedBy }) => (
                <PasswordInput id={id} value={password} autoComplete="new-password" autoFocus invalid={invalid}
                  describedBy={[rulesId, describedBy].filter(Boolean).join(' ')} showLabel="Show password" hideLabel="Hide password"
                  onChange={(event) => { setPassword(event.target.value); setError(null); }} />
              )}
            </Field>
            <PasswordChecklist password={password} id={rulesId} />
          </div>
          <button type="submit" disabled={!ready} className="mg-btn mg-btn-primary w-full">{saving ? 'Saving…' : 'Save new password'}</button>
        </form>
      )}
    </AuthFrame>
  );
}
