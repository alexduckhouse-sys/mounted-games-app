import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api } from '../api';
import { apiErrorMessage, apiErrorStatus } from '../lib/apiError';
import { Notice } from '../components/Notice';
import { AuthFrame } from './auth/AuthFrame';
import { Field } from './auth/Field';
import { useT } from '../i18n/LanguageContext';

/**
 * Asks for the sign-in email and sends a reset link. The API gives the same answer whether or not there is an account,
 * so this page does too: it never says whether the address is known.
 */
export function ForgotPasswordPage() {
  const t = useT();
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
      setError(status === 429 ? t('auth.forgot.tooMany')
        : status === 400 || status === 403 ? apiErrorMessage(caught, t('auth.forgot.checkAddress'))
          : t('auth.forgot.sendFailed'));
    } finally {
      setSending(false);
    }
  }

  if (sentTo !== null) {
    return (
      <AuthFrame>
        <div className="flex flex-1 flex-col gap-[18px]">
          <h1 className="mg-h1 !text-[34px] !leading-none">{t('auth.forgot.checkTitle')}</h1>
          <Notice tone="info" icon={MailCheck}>
            {t('auth.forgot.sentNotice', { email: sentTo })}
          </Notice>
          <p className="m-0 text-[15px] text-[rgb(var(--mg-body))]">
            {t('auth.forgot.nothingYet')}{' '}
            <button type="button" className="font-semibold text-[rgb(var(--mg-heading))] underline" onClick={() => setSentTo(null)}>{t('auth.forgot.tryAgain')}</button>.
          </p>
          <Link to="/login" className="mg-btn mg-btn-primary w-full">{t('auth.login.backToSignIn')}</Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-[18px]" noValidate>
        <h1 className="mg-h1 !text-[34px] !leading-none">{t('auth.forgot.title')}</h1>
        <p className="m-0 text-[15px] text-[rgb(var(--mg-body))]">{t('auth.forgot.intro')}</p>
        <Field label={t('auth.field.email')} error={error}>
          {({ id, invalid, describedBy }) => (
            <div className="mg-field" data-invalid={invalid}>
              <input id={id} type="email" value={email} autoComplete="email" autoFocus aria-invalid={invalid} aria-describedby={describedBy}
                onChange={(event) => { setEmail(event.target.value); setError(null); }} />
            </div>
          )}
        </Field>
        <button type="submit" disabled={!ready} className="mg-btn mg-btn-primary w-full">{sending ? t('auth.forgot.sending') : t('auth.forgot.send')}</button>
        <p className="text-center text-[15px] font-medium text-[rgb(var(--mg-body))]">
          {t('auth.forgot.remembered')} <Link to="/login" className="font-semibold text-[rgb(var(--mg-heading))] !underline">{t('common.signIn')}</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
