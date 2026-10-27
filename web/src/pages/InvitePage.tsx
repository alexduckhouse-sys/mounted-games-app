import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { tr } from '../i18n/translate';
import { Notice } from '../components/Notice';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { friendlyPasswordErrors, passwordMeetsRules } from '../lib/passwordRules';
import { tokenFromHash } from '../offline/scorerLink';
import type { InvitePreview } from './admin/accountAccessTypes';
import { AuthFrame } from './auth/AuthFrame';
import { Field } from './auth/Field';

// A null message means the standard "expired or not valid" text, written in whatever language is showing.
type Lookup = { state: 'looking' } | { state: 'ready'; preview: InvitePreview } | { state: 'invalid'; message: string | null };

/** Opened from the emailed link `/invite#t=<token>`. The token stays in the fragment, which the browser never sends to a server. Asks only for a name and password, then signs the person in. */
export function InvitePage() {
  const t = useT();
  const { acceptInvite, loading } = useAuth();
  const nav = useNavigate();
  const rulesId = useId();
  // Read once, then take it out of the address bar and history.
  const [token] = useState(() => tokenFromHash(window.location.hash));
  const [lookup, setLookup] = useState<Lookup>(token ? { state: 'looking' } : { state: 'invalid', message: null });
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.location.hash) return;
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* history may be blocked */ }
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.post<InvitePreview>('/auth/invites/lookup', { token })
      .then(({ data }) => { if (!cancelled) setLookup({ state: 'ready', preview: data }); })
      .catch((caught: { response?: { status?: number; data?: { message?: string } } }) => {
        if (cancelled) return;
        const gone = caught.response?.status === 404 || caught.response?.status === 400;
        setLookup({ state: 'invalid', message: gone ? caught.response?.data?.message ?? null : tr('auth.invite.checkFailed') });
      });
    return () => { cancelled = true; };
  }, [token]);

  const ready = fullName.trim().length > 0 && passwordMeetsRules(password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || loading || !token) return;
    setError(null);
    try {
      await acceptInvite(token, fullName.trim(), password);
      nav('/', { replace: true });
    } catch (caught) {
      const response = (caught as { response?: { data?: { errors?: unknown; errorCodes?: unknown; detail?: string; message?: string } } }).response;
      const rules = friendlyPasswordErrors(response?.data);
      setError(rules[0] || response?.data?.detail || response?.data?.message || t('auth.invite.setupFailed'));
    }
  }

  return (
    <AuthFrame>
      {lookup.state === 'looking' && <p role="status" className="text-[15px]">{t('auth.invite.looking')}</p>}
      {lookup.state === 'invalid' && (
        <div className="flex flex-col gap-4">
          <h1 className="mg-h1 !text-[34px] !leading-none">{t('auth.invite.title')}</h1>
          <Notice>{lookup.message ?? t('auth.invite.invalid')}</Notice>
        </div>
      )}
      {lookup.state === 'ready' && (
        <form onSubmit={submit} className="flex flex-1 flex-col gap-[18px]" noValidate>
          <h1 className="mg-h1 !text-[34px] !leading-none">{t('auth.invite.join')}</h1>
          <Field label={t('auth.field.email')}>
            {({ id }) => <div className="mg-field"><input id={id} type="email" value={lookup.preview.email} readOnly autoComplete="email" /></div>}
          </Field>
          <Field label={t('auth.field.yourName')}>
            {({ id }) => (
              <div className="mg-field">
                <input id={id} type="text" value={fullName} autoComplete="name" autoFocus onChange={(event) => { setFullName(event.target.value); setError(null); }} />
              </div>
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <Field label={t('auth.field.password')} error={error}>
              {({ id, invalid, describedBy }) => (
                <div className="mg-field" data-invalid={invalid}>
                  <input id={id} type={show ? 'text' : 'password'} value={password} autoComplete="new-password" aria-invalid={invalid}
                    aria-describedby={[rulesId, describedBy].filter(Boolean).join(' ')} onChange={(event) => { setPassword(event.target.value); setError(null); }} />
                  <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('auth.password.hide') : t('auth.password.show')} aria-pressed={show}
                    className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[rgb(var(--mg-muted))] hover:text-[rgb(var(--mg-ink))]">
                    {show ? <EyeOff aria-hidden="true" className="h-[18px] w-[18px]" /> : <Eye aria-hidden="true" className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              )}
            </Field>
            <PasswordChecklist password={password} id={rulesId} />
          </div>
          <button type="submit" disabled={!ready || loading} className="mg-btn mg-btn-primary w-full">{t('auth.signup.submit')}</button>
        </form>
      )}
    </AuthFrame>
  );
}
