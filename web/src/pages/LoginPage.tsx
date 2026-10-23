import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { AuthFrame } from './auth/AuthFrame';
import { Field } from './auth/Field';

interface NavState { from?: string }

/** Sign in with an email and password, or swap to the organiser's shared key. */
export function LoginPage() {
  const { login, loginWithAdminKey, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [useKey, setUseKey] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organiserKey, setOrganiserKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ready = useKey ? organiserKey.trim().length > 0 : email.trim().length > 0 && password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || loading) return;
    setError(null);
    try {
      if (useKey) await loginWithAdminKey(organiserKey.trim());
      else await login(email.trim(), password);
      nav((loc.state as NavState | null)?.from ?? '/', { replace: true });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (useKey) setError('That key did not work.');
      else setError(status === 401 || status === 400 ? 'Email or password is wrong.' : 'Could not sign in. Try again.');
    }
  }

  function swap() {
    setUseKey((v) => !v);
    setError(null);
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-[18px]" noValidate>
        <h1 className="mg-h1 !text-[34px] !leading-none">{useKey ? 'Organiser sign in' : 'Sign in'}</h1>

        {useKey ? (
          <Field label="Organiser key" error={error}>
            {({ id, invalid, describedBy }) => (
              <div className="mg-field" data-invalid={invalid}>
                <input id={id} type="password" value={organiserKey} autoComplete="off" autoFocus aria-invalid={invalid} aria-describedby={describedBy}
                  onChange={(e) => { setOrganiserKey(e.target.value); setError(null); }} />
              </div>
            )}
          </Field>
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
                  <input id={id} type="password" value={password} autoComplete="current-password" aria-invalid={invalid} aria-describedby={describedBy}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }} />
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
