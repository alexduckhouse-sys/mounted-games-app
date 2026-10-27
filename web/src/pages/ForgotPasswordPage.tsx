import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api } from '../api';
import { apiErrorMessage, apiErrorStatus } from '../lib/apiError';
import { Notice } from '../components/Notice';
import { AuthFrame } from './auth/AuthFrame';
import { Field } from './auth/Field';

/**
 * Asks for the sign-in email and sends a reset link. The API gives the same answer whether or not there is an account,
 * so this page does too: it never says whether the address is known.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const address = email.trim();
  const ready = address.includes('@') && !sending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    setSending(true);
    try {
      await api.post('/auth/password-reset/request', { email: address });
      setSentTo(address);
    } catch (caught) {
      const status = apiErrorStatus(caught);
      setError(status === 429 ? 'Too many tries. Wait a minute and try again.'
        : status === 400 || status === 403 ? apiErrorMessage(caught, 'Check the address and try again.')
          : 'Couldn’t send the link. Check your signal and try again.');
    } finally {
      setSending(false);
    }
  }

  if (sentTo !== null) {
    return (
      <AuthFrame>
        <div className="flex flex-1 flex-col gap-[18px]">
          <h1 className="mg-h1 !text-[34px] !leading-none">Check your email</h1>
          <Notice tone="info" icon={MailCheck}>
            If there’s an account for {sentTo}, we’ve sent it a link to choose a new password. The link works for 30 minutes.
          </Notice>
          <p className="m-0 text-[15px] text-[rgb(var(--mg-body))]">
            Nothing after a few minutes? Check your spam folder, or{' '}
            <button type="button" className="font-semibold text-[rgb(var(--mg-heading))] underline" onClick={() => setSentTo(null)}>try again</button>.
          </p>
          <Link to="/login" className="mg-btn mg-btn-primary w-full">Back to sign in</Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-[18px]" noValidate>
        <h1 className="mg-h1 !text-[34px] !leading-none">Reset your password</h1>
        <p className="m-0 text-[15px] text-[rgb(var(--mg-body))]">Enter the email address you sign in with and we’ll send you a link to choose a new password.</p>
        <Field label="Email" error={error}>
          {({ id, invalid, describedBy }) => (
            <div className="mg-field" data-invalid={invalid}>
              <input id={id} type="email" value={email} autoComplete="email" autoFocus aria-invalid={invalid} aria-describedby={describedBy}
                onChange={(event) => { setEmail(event.target.value); setError(null); }} />
            </div>
          )}
        </Field>
        <button type="submit" disabled={!ready} className="mg-btn mg-btn-primary w-full">{sending ? 'Sending…' : 'Send reset link'}</button>
        <p className="text-center text-[15px] font-medium text-[rgb(var(--mg-body))]">
          Remembered it? <Link to="/login" className="font-semibold text-[rgb(var(--mg-heading))] !underline">Sign in</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
