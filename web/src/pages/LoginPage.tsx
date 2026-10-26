import { useId, useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { friendlyPasswordErrors, passwordMeetsRules } from '../lib/passwordRules';
import { AuthFrame } from './auth/AuthFrame';
import { Field } from './auth/Field';

interface NavState { from?: string }

/** Sign in with an email and password, or swap to the organiser's shared key. */
export function LoginPage() {
  const { login, loginWithAdminKey, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const rulesId = useId();
  const [useKey, setUseKey] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [organiserTitle, setOrganiserTitle] = useState('');
  const [organiserEmail, setOrganiserEmail] = useState('');
  const [organiserPassword, setOrganiserPassword] = useState('');
  const [showOrganiserPassword, setShowOrganiserPassword] = useState(false);
  const [organiserKey, setOrganiserKey] = useState('');
  const [showOrganiserKey, setShowOrganiserKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(res?.data?.message || 'Too many tries. Wait a minute and try again.');
      } else if (useKey) {
        const pwErrors = friendlyPasswordErrors(res?.data);
        if (status === 400) setError(pwErrors[0] || res?.data?.message || 'Check your details and key.');
        else if (status === 401) setError(res?.data?.message && res.data.message !== 'Invalid admin key.' ? res.data.message : 'That key or password didn’t work.');
        else setError('That key or password didn’t work.');
      } else {
        setError(status === 401 || status === 400 ? 'Email or password is wrong.' : 'Couldn’t sign in. Check your signal and try again.');
      }
    }
  }

  function swap() {
    setUseKey((v) => !v);
    setShowOrganiserKey(false);
    setShowOrganiserPassword(false);
    setError(null);
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-[18px]" noValidate>
        <h1 className="mg-h1 !text-[34px] !leading-none">{useKey ? 'Organiser sign in' : 'Sign in'}</h1>

        {useKey ? (
          <>
            <Field label="Title or role">
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} type="text" value={organiserTitle} placeholder="e.g. Chief Steward, Show Secretary" autoFocus
                    onChange={(e) => { setOrganiserTitle(e.target.value); setError(null); }} />
                </div>
              )}
            </Field>
            <Field label="Email">
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} type="email" value={organiserEmail} autoComplete="email"
                    onChange={(e) => { setOrganiserEmail(e.target.value); setError(null); }} />
                </div>
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <Field label="Password">
                {({ id }) => (
                  <div className="mg-field">
                    <input id={id} type={showOrganiserPassword ? 'text' : 'password'} value={organiserPassword}
                      autoComplete="new-password" aria-describedby={rulesId}
                      onChange={(e) => { setOrganiserPassword(e.target.value); setError(null); }} />
                    <button
                      type="button"
                      onClick={() => setShowOrganiserPassword((v) => !v)}
                      aria-label={showOrganiserPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showOrganiserPassword}
                      className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[rgb(var(--mg-muted))] hover:text-[rgb(var(--mg-ink))]"
                    >
                      {showOrganiserPassword ? <EyeOff aria-hidden="true" className="h-[18px] w-[18px]" /> : <Eye aria-hidden="true" className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                )}
              </Field>
              <PasswordChecklist password={organiserPassword} id={rulesId} />
              <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">
                Sets your account password the first time so you can sign in normally next time.
              </p>
            </div>
            <Field label="Organiser key" error={error}>
              {({ id, invalid, describedBy }) => (
                <div className="mg-field" data-invalid={invalid}>
                  <input id={id} type={showOrganiserKey ? 'text' : 'password'} value={organiserKey}
                    autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    aria-invalid={invalid} aria-describedby={describedBy}
                    onChange={(e) => { setOrganiserKey(e.target.value); setError(null); }} />
                  <button type="button" className="flex min-h-11 min-w-11 items-center justify-center text-[rgb(var(--mg-muted))]"
                    onClick={() => setShowOrganiserKey((shown) => !shown)} aria-pressed={showOrganiserKey}
                    aria-label={showOrganiserKey ? 'Hide key' : 'Show key'}>
                    {showOrganiserKey ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                  </button>
                </div>
              )}
            </Field>
          </>
        ) : (
          <>
            <Field label="Email">
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} type="email" value={email} autoComplete="email" autoFocus
                    onChange={(e) => { setEmail(e.target.value); setError(null); }} />
                </div>
              )}
            </Field>
            <Field label="Password" error={error}>
              {({ id, invalid, describedBy }) => (
                <div className="mg-field" data-invalid={invalid}>
                  <input id={id} type={showPassword ? 'text' : 'password'} value={password} autoComplete="current-password" aria-invalid={invalid} aria-describedby={describedBy}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }} />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[rgb(var(--mg-muted))] hover:text-[rgb(var(--mg-ink))]"
                  >
                    {showPassword ? <EyeOff aria-hidden="true" className="h-[18px] w-[18px]" /> : <Eye aria-hidden="true" className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              )}
            </Field>
          </>
        )}

        <button type="submit" disabled={!ready || loading} className="mg-btn mg-btn-primary w-full">Sign in</button>

        {!useKey && (
          <p className="text-center text-[15px] font-medium text-[rgb(var(--mg-body))]">
            New here? <Link to="/signup" state={loc.state} className="font-semibold text-[rgb(var(--mg-heading))] !underline">Create an account</Link>
          </p>
        )}

        <div className="flex-1" />
        <button type="button" onClick={swap} className="mx-auto flex min-h-11 items-center gap-2 text-[15px] font-semibold text-[rgb(var(--mg-muted))]">
          {useKey ? <ArrowLeft aria-hidden="true" className="h-4 w-4" /> : <KeyRound aria-hidden="true" className="h-4 w-4" />}
          {useKey ? 'Back to sign in' : 'Organiser with a shared key'}
        </button>
      </form>
    </AuthFrame>
  );
}
