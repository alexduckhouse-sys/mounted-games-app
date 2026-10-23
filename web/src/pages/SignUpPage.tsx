import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, Send } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { isRealisticEmail, suggestEmailFix } from '../lib/emailCheck';
import { friendlyPasswordErrors, passwordMeetsRules } from '../lib/passwordRules';
import type { Club } from '../types';
import { AuthFrame } from './auth/AuthFrame';
import { Field } from './auth/Field';

type RoleId = 'member' | 'trainer' | 'manager';

const ROLES: { id: RoleId; label: string; api: 'Member' | 'Trainer' | 'Manager'; sentence: string; byAdmins: boolean }[] = [
  { id: 'member', label: 'Rider or parent', api: 'Member', sentence: 'a member', byAdmins: false },
  { id: 'trainer', label: 'Trainer', api: 'Trainer', sentence: 'a trainer', byAdmins: false },
  { id: 'manager', label: 'Team manager', api: 'Manager', sentence: 'team manager', byAdmins: true },
];

interface FieldErrors { email?: string; password?: string; form?: string }

/** The error text the API sent back, if any. */
function problemsFrom(err: unknown): { status?: number; message?: string; code?: string; passwordErrors: string[] } {
  const response = (err as { response?: { status?: number; data?: { message?: string; code?: string; errors?: unknown; errorCodes?: unknown } } })?.response;
  return {
    status: response?.status,
    message: response?.data?.message,
    code: response?.data?.code,
    passwordErrors: friendlyPasswordErrors(response?.data),
  };
}

/** Create an account, then show who will approve it. */
export function SignUpPage() {
  const { signupTrainer, loading } = useAuth();
  const loc = useLocation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLeft, setEmailLeft] = useState(false);
  const rulesId = useId();
  const [club, setClub] = useState('');
  const [clubPicked, setClubPicked] = useState(false);
  const [role, setRole] = useState<RoleId | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sentTo, setSentTo] = useState<{ club: string; role: RoleId } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Club[]>('/clubs').then((r) => { if (!cancelled && Array.isArray(r.data)) setClubs(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const typed = club.trim();
  const matches = useMemo(() => {
    const q = typed.toLowerCase();
    return q ? clubs.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3) : [];
  }, [clubs, typed]);
  const exact = clubs.some((c) => c.name.toLowerCase() === typed.toLowerCase());
  const chosenRole = ROLES.find((r) => r.id === role) ?? null;
  const emailOk = isRealisticEmail(email);
  const emailFix = suggestEmailFix(email);
  const ready = name.trim() !== '' && emailOk && passwordMeetsRules(password) && typed !== '' && clubPicked && chosenRole !== null;
  const approver = chosenRole?.byAdmins ? 'Mounted Games admins' : `${typed}'s team manager`;

  function pickClub(value: string) {
    setClub(value);
    setClubPicked(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !chosenRole || loading) return;
    setErrors({});
    try {
      // The email is the sign-in name. The API makes the club if it is new, insists on one, and holds a team
      // manager for an admin and a trainer for the club's manager.
      await signupTrainer(email.trim(), password, chosenRole.api, typed, name.trim());
      setSentTo({ club: typed, role: chosenRole.id });
    } catch (err) {
      const { status, message, code, passwordErrors } = problemsFrom(err);
      if (status === 409) setErrors({ email: 'An account with that email already exists.' });
      else if (code?.startsWith('email_') && message) setErrors({ email: message });
      else if (passwordErrors.length) setErrors({ password: passwordErrors.join(' ') });
      else if (status === 400 && message?.toLowerCase().includes('password')) setErrors({ password: message.replace(/non-?\s?alphanumeric/gi, 'special') });
      else setErrors({ form: message ?? 'Could not create the account. Try again.' });
    }
  }

  // Where they were headed when they chose to sign up, e.g. a competition's entry page.
  const from = (loc.state as { from?: string } | null)?.from;
  if (sentTo) {
    const sent = ROLES.find((r) => r.id === sentTo.role)!;
    return (
      <AuthFrame>
        <div className="flex flex-1 flex-col gap-[18px] pt-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]"><Send aria-hidden="true" className="h-[26px] w-[26px]" /></div>
          <h1 className="mg-h1 !text-[34px]">Request sent to {sentTo.club}</h1>
          <p className="text-[17px] leading-[1.45] text-[rgb(var(--mg-body))]">
            {sent.byAdmins ? 'Mounted Games admins' : 'Your team manager'} will approve you as {sent.sentence}. We'll let you know when it's done.
          </p>
          <p className="text-[15px] leading-[1.45] text-[rgb(var(--mg-body))]">
            We've also emailed you a link to confirm your address. You can carry on without it for now.
          </p>
          <div className="mt-auto flex flex-col gap-2.5">
            {from && <Link to={from} className="mg-btn mg-btn-primary">Back to the competition</Link>}
            <Link to="/events" className={`mg-btn ${from ? 'mg-btn-secondary' : 'mg-btn-primary'}`}>Follow a competition</Link>
            <Link to="/me" className="mg-btn mg-btn-secondary">Go to my profile</Link>
          </div>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-[18px]" noValidate>
        <h1 className="mg-h1 !text-[34px] !leading-none">Create an account</h1>

        <Field label="Your name">
          {({ id }) => <div className="mg-field"><input id={id} value={name} autoComplete="name" autoFocus onChange={(e) => setName(e.target.value)} /></div>}
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label="Email" error={errors.email ?? (emailLeft && email.trim() !== '' && !emailOk ? "That doesn't look like a valid email address." : null)}>
            {({ id, invalid, describedBy }) => (
              <div className="mg-field" data-invalid={invalid}>
                <input id={id} type="email" value={email} autoComplete="email" aria-invalid={invalid} aria-describedby={describedBy}
                  onBlur={() => setEmailLeft(true)}
                  onChange={(e) => { setEmail(e.target.value); setErrors((cur) => ({ ...cur, email: undefined })); }} />
              </div>
            )}
          </Field>
          {emailLeft && emailFix && (
            <p role="status" className="m-0 text-sm text-[rgb(var(--mg-body))]">
              Did you mean <strong>{emailFix.slice(emailFix.lastIndexOf('@') + 1)}</strong>?{' '}
              <button type="button" className="font-semibold text-[rgb(var(--mg-heading))] underline" onClick={() => setEmail(emailFix)}>
                Use {emailFix}
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <Field label="Password" error={errors.password}>
            {({ id, invalid, describedBy }) => (
              <div className="mg-field" data-invalid={invalid}>
                <input id={id} type="password" value={password} autoComplete="new-password" aria-invalid={invalid}
                  aria-describedby={[describedBy, rulesId].filter(Boolean).join(' ')}
                  onChange={(e) => { setPassword(e.target.value); setErrors((cur) => ({ ...cur, password: undefined })); }} />
              </div>
            )}
          </Field>
          <PasswordChecklist password={password} id={rulesId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Field label="Club">
            {({ id }) => (
              <div className="mg-field">
                <input id={id} value={club} placeholder="Start typing" autoComplete="off"
                  onChange={(e) => { setClub(e.target.value); setClubPicked(false); }} />
              </div>
            )}
          </Field>
          {!clubPicked && typed !== '' && (
            <div role="group" aria-label="Club suggestions" className="mg-card mg-list">
              {matches.map((c) => (
                <button key={c.id} type="button" onClick={() => pickClub(c.name)}
                  className="flex min-h-11 w-full items-center px-3.5 text-left text-base font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]">{c.name}</button>
              ))}
              {!exact && (
                <button type="button" onClick={() => pickClub(typed)}
                  className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[15px] font-semibold text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]">
                  <Plus aria-hidden="true" className="h-4 w-4" />Add "{typed}"
                </button>
              )}
            </div>
          )}
        </div>

        <div role="radiogroup" aria-labelledby="signup-role" className="flex flex-col gap-2">
          <span id="signup-role" className="text-sm font-semibold text-[rgb(var(--mg-body))]">I am a</span>
          {ROLES.map((r) => {
            const on = r.id === role;
            return (
              <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => setRole(r.id)}
                className={`flex min-h-14 w-full items-center gap-3 rounded-[10px] bg-[rgb(var(--mg-surface))] px-3.5 text-left ${on ? 'border-2 border-[rgb(var(--mg-heading))]' : 'border border-[rgb(var(--mg-control))]'}`}>
                <span aria-hidden="true" className={`box-border h-[22px] w-[22px] shrink-0 rounded-full ${on ? 'border-[7px] border-[rgb(var(--mg-heading))]' : 'border-[1.5px] border-[rgb(var(--mg-control))]'}`} />
                <span className={`flex-1 text-base font-semibold ${on ? 'text-[rgb(var(--mg-heading))]' : 'text-[rgb(var(--mg-ink))]'}`}>{r.label}</span>
              </button>
            );
          })}
        </div>

        {clubPicked && chosenRole && <p className="text-sm font-medium leading-[1.4] text-[rgb(var(--mg-muted))]">Approved by {approver}.</p>}

        {errors.form && <p role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{errors.form}</p>}

        <div className="mt-auto flex flex-col gap-2.5 pt-2">
          <button type="submit" disabled={!ready || loading} className="mg-btn mg-btn-primary w-full">Create account</button>
          <p className="text-center text-[15px] font-medium text-[rgb(var(--mg-body))]">
            Got an account? <Link to="/login" state={loc.state} className="font-semibold text-[rgb(var(--mg-heading))] !underline">Sign in</Link>
          </p>
          <p className="text-center text-[13px] text-[rgb(var(--mg-muted))]"><Link to="/privacy" className="!underline">How we use your information</Link></p>
        </div>
      </form>
    </AuthFrame>
  );
}
