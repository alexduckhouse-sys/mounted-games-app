import { useCallback, useId, useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { Notice } from '../components/Notice';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { PasswordInput } from '../components/PasswordInput';
import { SocialLoginButtons, type SocialCredential } from '../components/SocialLoginButtons';
import { externalErrorMessage } from '../lib/externalAuthError';
import { friendlyPasswordErrors, passwordMeetsRules } from '../lib/passwordRules';
import { AuthFrame } from './auth/AuthFrame';
import { ExternalOnboardingForm, type PendingExternalSignup } from './auth/ExternalOnboardingForm';
import { Field } from './auth/Field';

interface NavState { from?: string }

/** Sign in with Google or Apple (when switched on), an email and password, or swap to the organiser's shared key. */
export function LoginPage() {
  const t = useT();
  const { login, loginWithAdminKey, loginWithExternal, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const rulesId = useId();
  const [useKey, setUseKey] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // "Forgot your password?" only shows once a password has been turned down, so it doesn't crowd a first try.
  const [passwordRefused, setPasswordRefused] = useState(false);
  const [organiserTitle, setOrganiserTitle] = useState('');
  const [organiserEmail, setOrganiserEmail] = useState('');
  const [organiserPassword, setOrganiserPassword] = useState('');
  const [organiserKey, setOrganiserKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingExternal, setPendingExternal] = useState<PendingExternalSignup | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);

  const handleCredential = useCallback(async ({ provider, idToken, nonce, providerName }: SocialCredential) => {
    setExternalError(null);
    try {
      const res = await loginWithExternal(provider, idToken, { nonce, providerName });
      if (res.needsSignup) {
        setPendingExternal({ provider: res.provider, ticket: res.ticket, email: res.email, suggestedName: res.suggestedName });
      } else {
        nav((loc.state as NavState | null)?.from ?? '/', { replace: true });
      }
    } catch (err: unknown) {
      setExternalError(externalErrorMessage(err, t('auth.login.noSignal')));
    }
  }, [loc.state, loginWithExternal, nav, t]);

  const ready = useKey
    ? organiserTitle.trim().length > 0 && organiserEmail.trim().includes('@') && passwordMeetsRules(organiserPassword) && organiserKey.trim().length > 0
    : email.trim().length > 0 && password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || loading) return;
    setError(null);
    try {
      if (useKey) await loginWithAdminKey(organiserKey.trim(), organiserTitle.trim(), organiserEmail.trim(), organiserPassword);
      else await login(email.trim(), password);
      nav((loc.state as NavState | null)?.from ?? '/', { replace: true });
    } catch (err: unknown) {
      const res = (err as { response?: { status?: number; data?: { message?: string; errors?: unknown; errorCodes?: unknown } } })?.response;
      const status = res?.status;
      if (status === 429) {
        setError(res?.data?.message || t('auth.login.tooMany'));
        if (!useKey) setPasswordRefused(true);
      } else if (useKey) {
        const pwErrors = friendlyPasswordErrors(res?.data);
        if (status === 400) setError(pwErrors[0] || res?.data?.message || t('auth.login.checkDetails'));
        else if (status === 401) setError(res?.data?.message && res.data.message !== 'Invalid admin key.' ? res.data.message : t('auth.login.keyFailed'));
        else if (status === 409) setError(res?.data?.message || t('auth.login.keyFailed'));
        else setError(t('auth.login.keyFailed'));
      } else {
        setError(status === 401 || status === 400 ? t('auth.login.wrong') : t('auth.login.noSignal'));
        if (status === 401 || status === 400) setPasswordRefused(true);
      }
    }
  }

  function swap() {
    setUseKey((v) => !v);
    setError(null);
  }

  if (pendingExternal) {
    return (
      <AuthFrame>
        <ExternalOnboardingForm
          pending={pendingExternal}
          onComplete={() => nav((loc.state as NavState | null)?.from ?? '/', { replace: true })}
          onCancel={() => { setPendingExternal(null); setExternalError(null); }}
        />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
       {/* Keyed so the form fades when it swaps to the shared-key version and back. */}
       <div key={useKey ? 'key' : 'password'} className="mg-swap flex flex-col gap-[18px]">
        <h1 className="mg-h1 !text-[34px] !leading-none">{useKey ? t('auth.login.organiserTitle') : t('common.signIn')}</h1>

        {!useKey && (
          <>
            <SocialLoginButtons disabled={loading} onCredential={handleCredential} onError={setExternalError} />
            {externalError && <Notice>{externalError}</Notice>}
          </>
        )}

        {useKey ? (
          <>
            <Field label={t('auth.login.titleLabel')}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} type="text" value={organiserTitle} placeholder={t('auth.login.titlePlaceholder')} autoFocus
                    onChange={(e) => { setOrganiserTitle(e.target.value); setError(null); }} />
                </div>
              )}
            </Field>
            <Field label={t('auth.field.email')}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} type="email" value={organiserEmail} autoComplete="email"
                    onChange={(e) => { setOrganiserEmail(e.target.value); setError(null); }} />
                </div>
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <Field label={t('auth.field.password')}>
                {({ id }) => (
                  <PasswordInput id={id} value={organiserPassword} autoComplete="new-password" describedBy={rulesId}
                    onChange={(e) => { setOrganiserPassword(e.target.value); setError(null); }} />
                )}
              </Field>
              <PasswordChecklist password={organiserPassword} id={rulesId} />
              <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">
                {t('auth.login.setsPassword')}
              </p>
            </div>
            <Field label={t('auth.login.organiserKey')} error={error}>
              {({ id, invalid, describedBy }) => (
                <PasswordInput id={id} value={organiserKey} autoComplete="off" secret invalid={invalid} describedBy={describedBy}
                  showLabel={t('auth.login.keyShow')} hideLabel={t('auth.login.keyHide')}
                  onChange={(e) => { setOrganiserKey(e.target.value); setError(null); }} />
              )}
            </Field>
          </>
        ) : (
          <>
            <Field label={t('auth.field.email')}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} type="email" value={email} autoComplete="email" autoFocus
                    onChange={(e) => { setEmail(e.target.value); setError(null); }} />
                </div>
              )}
            </Field>
            <Field label={t('auth.field.password')} error={error}>
              {({ id, invalid, describedBy }) => (
                <PasswordInput id={id} value={password} autoComplete="current-password" invalid={invalid} describedBy={describedBy}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }} />
              )}
            </Field>
            {passwordRefused && <Link to="/forgot-password" className="-mt-2 self-end text-sm font-semibold text-[rgb(var(--mg-heading))] !underline">{t('auth.forgot.link')}</Link>}
          </>
        )}

        <button type="submit" disabled={!ready || loading} className="mg-btn mg-btn-primary w-full">{t('common.signIn')}</button>

        {!useKey && (
          <p className="text-center text-[15px] font-medium text-[rgb(var(--mg-body))]">
            {t('auth.login.newHere')} <Link to="/signup" state={loc.state} className="font-semibold text-[rgb(var(--mg-heading))] !underline">{t('auth.createAccount')}</Link>
          </p>
        )}

        <button type="button" onClick={swap} className="mx-auto flex min-h-11 items-center gap-2 text-[15px] font-semibold text-[rgb(var(--mg-muted))]">
          {useKey ? <ArrowLeft aria-hidden="true" className="h-4 w-4" /> : <KeyRound aria-hidden="true" className="h-4 w-4" />}
          {useKey ? t('auth.login.backToSignIn') : t('auth.login.sharedKey')}
        </button>
       </div>
      </form>
    </AuthFrame>
  );
}
