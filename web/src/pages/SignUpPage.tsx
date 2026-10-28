import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, Plus, Send } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { Notice } from '../components/Notice';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { PasswordInput } from '../components/PasswordInput';
import { SocialLoginButtons, type SocialCredential } from '../components/SocialLoginButtons';
import { isRealisticEmail, suggestEmailFix } from '../lib/emailCheck';
import { externalErrorMessage } from '../lib/externalAuthError';
import { friendlyPasswordErrors, passwordMeetsRules } from '../lib/passwordRules';
import type { MessageKey } from '../i18n/en';
import type { Club } from '../types';
import { AuthFrame } from './auth/AuthFrame';
import { ExternalOnboardingForm, type PendingExternalSignup } from './auth/ExternalOnboardingForm';
import { Field } from './auth/Field';

type RoleId = 'member' | 'trainer' | 'manager';

const ROLES: { id: RoleId; label: MessageKey; hint: MessageKey; api: 'Member' | 'Trainer' | 'Manager'; sentence: MessageKey; byAdmins: boolean }[] = [
  { id: 'member', label: 'auth.signup.roleRider', hint: 'auth.signup.roleRiderHint', api: 'Member', sentence: 'auth.signup.asMember', byAdmins: false },
  { id: 'trainer', label: 'auth.signup.roleTrainer', hint: 'auth.signup.roleTrainerHint', api: 'Trainer', sentence: 'auth.signup.asTrainer', byAdmins: false },
  { id: 'manager', label: 'auth.signup.roleManager', hint: 'auth.signup.roleManagerHint', api: 'Manager', sentence: 'auth.signup.asManager', byAdmins: true },
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
  const t = useT();
  const { signupTrainer, loginWithExternal, loading } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLeft, setEmailLeft] = useState(false);
  const rulesId = useId();
  const roleId = useId();
  const [club, setClub] = useState('');
  const [clubPicked, setClubPicked] = useState(false);
  const [role, setRole] = useState<RoleId | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  // `emailed` is false when a provider sign-up started confirmed (the provider runs the mailbox), so no email went out.
  const [sentTo, setSentTo] = useState<{ club: string; role: RoleId; emailed: boolean } | null>(null);
  const [pendingExternal, setPendingExternal] = useState<PendingExternalSignup | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);

  // Where they were headed when they chose to sign up, e.g. a competition's entry page.
  const from = (loc.state as { from?: string } | null)?.from;

  const handleCredential = useCallback(async ({ provider, idToken, nonce, providerName }: SocialCredential) => {
    setExternalError(null);
    try {
      const res = await loginWithExternal(provider, idToken, { nonce, providerName });
      if (res.needsSignup) {
        setPendingExternal({ provider: res.provider, ticket: res.ticket, email: res.email, suggestedName: res.suggestedName });
      } else {
        nav(from ?? '/', { replace: true });
      }
    } catch (err: unknown) {
      setExternalError(externalErrorMessage(err, t('auth.login.noSignal')));
    }
  }, [from, loginWithExternal, nav, t]);

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
  const approvedBy = chosenRole?.byAdmins ? t('auth.signup.approvedByAdmins') : t('auth.signup.approvedByManager', { club: typed });

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
      setSentTo({ club: typed, role: chosenRole.id, emailed: true });
    } catch (err) {
      const { status, message, code, passwordErrors } = problemsFrom(err);
      if (status === 409) setErrors({ email: t('auth.signup.emailTaken') });
      else if (code?.startsWith('email_') && message) setErrors({ email: message });
      else if (passwordErrors.length) setErrors({ password: passwordErrors.join(' ') });
      else if (status === 400 && message?.toLowerCase().includes('password')) setErrors({ password: message.replace(/non-?\s?alphanumeric/gi, 'special') });
      else setErrors({ form: message ?? t('auth.signup.failed') });
    }
  }

  if (sentTo) {
    const sent = ROLES.find((r) => r.id === sentTo.role)!;
    return (
      <AuthFrame>
        <div className="flex flex-1 flex-col gap-[18px] pt-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]"><Send aria-hidden="true" className="h-[26px] w-[26px]" /></div>
          <h1 className="mg-h1 !text-[34px]">{t('auth.signup.sentTitle', { club: sentTo.club })}</h1>
          <p className="text-[17px] leading-[1.45] text-[rgb(var(--mg-body))]">
            {t(sent.byAdmins ? 'auth.signup.sentAdmins' : 'auth.signup.sentManager', { role: t(sent.sentence) })}
          </p>
          {sentTo.emailed && (
            <p className="text-[15px] leading-[1.45] text-[rgb(var(--mg-body))]">
              {t('auth.signup.sentEmail')}
            </p>
          )}
          <div className="mt-auto flex flex-col gap-2.5">
            {from && <Link to={from} className="mg-btn mg-btn-primary">{t('auth.signup.backToCompetition')}</Link>}
            <Link to="/events" className={`mg-btn ${from ? 'mg-btn-secondary' : 'mg-btn-primary'}`}>{t('auth.signup.followCompetition')}</Link>
            <Link to="/me" className="mg-btn mg-btn-secondary">{t('auth.signup.toProfile')}</Link>
          </div>
        </div>
      </AuthFrame>
    );
  }

  if (pendingExternal) {
    return (
      <AuthFrame>
        <ExternalOnboardingForm
          pending={pendingExternal}
          initialClubs={clubs}
          onComplete={({ club, role, emailConfirmed }) => setSentTo({ club, role, emailed: !emailConfirmed })}
          onCancel={() => { setPendingExternal(null); setExternalError(null); }}
        />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-[18px]" noValidate>
        <h1 className="mg-h1 !text-[34px] !leading-none">{t('auth.createAccount')}</h1>

        <SocialLoginButtons disabled={loading} onCredential={handleCredential} onError={setExternalError} />
        {externalError && <Notice>{externalError}</Notice>}

        <Field label={t('auth.field.yourName')}>
          {({ id }) => <div className="mg-field"><input id={id} value={name} autoComplete="name" autoFocus onChange={(e) => setName(e.target.value)} /></div>}
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label={t('auth.field.email')} error={errors.email ?? (emailLeft && email.trim() !== '' && !emailOk ? t('auth.signup.emailInvalid') : null)}>
            {({ id, invalid, describedBy }) => (
              <div className="mg-field" data-invalid={invalid}>
                <input id={id} type="email" value={email} autoComplete="email" aria-invalid={invalid} aria-describedby={describedBy}
                  onBlur={() => setEmailLeft(true)}
                  onChange={(e) => { setEmail(e.target.value); setErrors((cur) => ({ ...cur, email: undefined })); }} />
              </div>
            )}
          </Field>
          {emailLeft && emailFix && (
            <Notice tone="info" actionLabel={t('auth.signup.useThat')} onAction={() => setEmail(emailFix)}>{t('auth.signup.didYouMean', { email: emailFix })}</Notice>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <Field label={t('auth.field.password')} error={errors.password}>
            {({ id, invalid, describedBy }) => (
              <PasswordInput id={id} value={password} autoComplete="new-password" invalid={invalid}
                describedBy={[describedBy, rulesId].filter(Boolean).join(' ')}
                onChange={(e) => { setPassword(e.target.value); setErrors((cur) => ({ ...cur, password: undefined })); }} />
            )}
          </Field>
          <PasswordChecklist password={password} id={rulesId} />
        </div>

        <div className="relative">
          <Field label={t('auth.signup.club')}>
            {({ id }) => (
              <div className="mg-field">
                <input id={id} value={club} placeholder={t('auth.signup.clubPlaceholder')} autoComplete="off"
                  onChange={(e) => { setClub(e.target.value); setClubPicked(false); }} />
              </div>
            )}
          </Field>
          {!clubPicked && typed !== '' && (
            <div role="group" aria-label={t('auth.signup.clubSuggestions')} className="mg-card mg-list mg-swap absolute inset-x-0 top-full z-20 mt-1 overflow-hidden shadow-lg">
              {matches.map((c) => (
                <button key={c.id} type="button" onClick={() => pickClub(c.name)}
                  className="flex min-h-11 w-full items-center px-3.5 text-left text-base font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]">{c.name}</button>
              ))}
              {!exact && (
                <button type="button" onClick={() => pickClub(typed)}
                  className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[15px] font-semibold text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]">
                  <Plus aria-hidden="true" className="h-4 w-4" />{t('auth.signup.addClub', { club: typed })}
                </button>
              )}
            </div>
          )}
        </div>

        <div role="radiogroup" aria-labelledby="signup-role" className="flex flex-col gap-2">
          <span id="signup-role" className="text-sm font-semibold text-[rgb(var(--mg-body))]">{t('auth.signup.iAmA')}</span>
          <div className="mg-card mg-list overflow-hidden">
            {ROLES.map((r) => {
              const on = r.id === role;
              return (
                <button key={r.id} type="button" role="radio" aria-checked={on} aria-labelledby={`${roleId}-${r.id}`} aria-describedby={`${roleId}-${r.id}-hint`} onClick={() => setRole(r.id)}
                  className={`flex min-h-14 w-full items-center gap-3 px-3.5 py-2 text-left ${on ? 'bg-[rgb(var(--mg-tint))]' : ''}`}>
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span id={`${roleId}-${r.id}`} className={`text-base font-semibold ${on ? 'text-[rgb(var(--mg-heading))]' : 'text-[rgb(var(--mg-ink))]'}`}>{t(r.label)}</span>
                    <span id={`${roleId}-${r.id}-hint`} className="text-[13px] leading-[1.3] text-[rgb(var(--mg-muted))]">{t(r.hint)}</span>
                  </span>
                  <Check aria-hidden="true" strokeWidth={3} className={`h-5 w-5 shrink-0 text-[rgb(var(--mg-heading))] transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} />
                </button>
              );
            })}
          </div>
        </div>

        {clubPicked && chosenRole && <p className="text-sm font-medium leading-[1.4] text-[rgb(var(--mg-muted))]">{approvedBy}</p>}

        {errors.form && <Notice>{errors.form}</Notice>}

        <div className="mt-auto flex flex-col gap-2.5 pt-2">
          <button type="submit" disabled={!ready || loading} className="mg-btn mg-btn-primary w-full">{t('auth.signup.submit')}</button>
          <p className="text-center text-[15px] font-medium text-[rgb(var(--mg-body))]">
            {t('auth.signup.gotAccount')} <Link to="/login" state={loc.state} className="font-semibold text-[rgb(var(--mg-heading))] !underline">{t('common.signIn')}</Link>
          </p>
          <p className="text-center text-[13px] text-[rgb(var(--mg-muted))]"><Link to="/privacy" className="inline-flex min-h-11 items-center !underline">{t('auth.signup.privacy')}</Link></p>
        </div>
      </form>
    </AuthFrame>
  );
}
