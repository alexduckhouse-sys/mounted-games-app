import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../../components/Notice';
import { externalErrorMessage } from '../../lib/externalAuthError';
import type { MessageKey } from '../../i18n/en';
import { useT } from '../../i18n/LanguageContext';
import type { Club } from '../../types';
import { Field } from './Field';

export type SignupRoleId = 'member' | 'trainer' | 'manager';

const SIGNUP_ROLE_CHOICES: {
  id: SignupRoleId;
  label: MessageKey;
  api: 'Member' | 'Trainer' | 'Manager';
  byAdmins: boolean;
}[] = [
  { id: 'member', label: 'auth.signup.roleRider', api: 'Member', byAdmins: false },
  { id: 'trainer', label: 'auth.signup.roleTrainer', api: 'Trainer', byAdmins: false },
  { id: 'manager', label: 'auth.signup.roleManager', api: 'Manager', byAdmins: true },
];

/**
 * A provider sign-in that found no account yet. The token has been used; the ten-minute sign-up ticket finishes the
 * account with the club and role. `email` is the provider's: a sign-in that didn't share one gets no ticket.
 */
export interface PendingExternalSignup {
  provider: string;
  ticket: string;
  email: string;
  suggestedName: string;
}

interface ExternalOnboardingFormProps {
  pending: PendingExternalSignup;
  initialClubs?: Club[];
  /** `emailConfirmed` is false when a confirmation email has gone out. */
  onComplete: (result: { club: string; role: SignupRoleId; emailConfirmed: boolean }) => void;
  onCancel: () => void;
}

/**
 * In-page completion step shown when someone signs in with a provider for the first time and needs to pick their
 * Pony Club / team and role. The API makes the account the same way as the email sign-up.
 */
export function ExternalOnboardingForm({
  pending,
  initialClubs,
  onComplete,
  onCancel,
}: ExternalOnboardingFormProps) {
  const t = useT();
  const { completeExternalSignup, loading } = useAuth();
  const [name, setName] = useState(pending.suggestedName);
  const [club, setClub] = useState('');
  const [clubPicked, setClubPicked] = useState(false);
  const [role, setRole] = useState<SignupRoleId | null>(null);
  const [clubs, setClubs] = useState<Club[]>(initialClubs ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialClubs && initialClubs.length > 0) return;
    let cancelled = false;
    api.get<Club[]>('/clubs')
      .then((r) => { if (!cancelled && Array.isArray(r.data)) setClubs(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [initialClubs]);

  const typed = club.trim();
  const matches = useMemo(() => {
    const q = typed.toLowerCase();
    return q ? clubs.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3) : [];
  }, [clubs, typed]);
  const exact = clubs.some((c) => c.name.toLowerCase() === typed.toLowerCase());
  const chosenRole = SIGNUP_ROLE_CHOICES.find((r) => r.id === role) ?? null;
  const ready = name.trim() !== '' && typed !== '' && clubPicked && chosenRole !== null;
  const approvedBy = chosenRole?.byAdmins ? t('auth.signup.approvedByAdmins') : t('auth.signup.approvedByManager', { club: typed });

  function pickClub(value: string) {
    setClub(value);
    setClubPicked(true);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !chosenRole || loading) return;
    setError(null);
    try {
      const profile = await completeExternalSignup(pending.ticket, {
        fullName: name.trim(),
        clubName: typed,
        role: chosenRole.api,
      });
      onComplete({ club: typed, role: chosenRole.id, emailConfirmed: profile.emailConfirmed !== false });
    } catch (err: unknown) {
      setError(externalErrorMessage(err, t('auth.signup.failed')));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-[18px]" noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="mg-h1 !text-[34px] !leading-none">{t('auth.external.title')}</h1>
        {pending.email && (
          <p className="m-0 text-sm text-[rgb(var(--mg-muted))]">
            {t('auth.external.signedInAs')} <span className="font-semibold text-[rgb(var(--mg-ink))]">{pending.email}</span>
          </p>
        )}
      </div>

      <Field label={t('auth.field.yourName')}>
        {({ id }) => (
          <div className="mg-field">
            <input
              id={id}
              value={name}
              autoComplete="name"
              autoFocus
              onChange={(e) => { setName(e.target.value); setError(null); }}
            />
          </div>
        )}
      </Field>

      <div className="flex flex-col gap-1.5">
        <Field label={t('auth.signup.club')}>
          {({ id }) => (
            <div className="mg-field">
              <input
                id={id}
                value={club}
                placeholder={t('auth.signup.clubPlaceholder')}
                autoComplete="off"
                onChange={(e) => { setClub(e.target.value); setClubPicked(false); setError(null); }}
              />
            </div>
          )}
        </Field>
        {!clubPicked && typed !== '' && (
          <div role="group" aria-label={t('auth.signup.clubSuggestions')} className="mg-card mg-list">
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickClub(c.name)}
                className="flex min-h-11 w-full items-center px-3.5 text-left text-base font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]"
              >
                {c.name}
              </button>
            ))}
            {!exact && (
              <button
                type="button"
                onClick={() => pickClub(typed)}
                className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[15px] font-semibold text-[rgb(var(--mg-heading))] hover:bg-[rgb(var(--mg-subtle))]"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />{t('auth.signup.addClub', { club: typed })}
              </button>
            )}
          </div>
        )}
      </div>

      <div role="radiogroup" aria-labelledby="external-signup-role" className="flex flex-col gap-2">
        <span id="external-signup-role" className="text-sm font-semibold text-[rgb(var(--mg-body))]">{t('auth.signup.iAmA')}</span>
        {SIGNUP_ROLE_CHOICES.map((r) => {
          const on = r.id === role;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => { setRole(r.id); setError(null); }}
              className={`flex min-h-14 w-full items-center gap-3 rounded-[10px] bg-[rgb(var(--mg-surface))] px-3.5 text-left ${on ? 'border-2 border-[rgb(var(--mg-heading))]' : 'border border-[rgb(var(--mg-control))]'}`}
            >
              <span
                aria-hidden="true"
                className={`box-border h-[22px] w-[22px] shrink-0 rounded-full ${on ? 'border-[7px] border-[rgb(var(--mg-heading))]' : 'border-[1.5px] border-[rgb(var(--mg-control))]'}`}
              />
              <span className={`flex-1 text-base font-semibold ${on ? 'text-[rgb(var(--mg-heading))]' : 'text-[rgb(var(--mg-ink))]'}`}>
                {t(r.label)}
              </span>
            </button>
          );
        })}
      </div>

      {clubPicked && chosenRole && (
        <p className="text-sm font-medium leading-[1.4] text-[rgb(var(--mg-muted))]">{approvedBy}</p>
      )}

      {error && <Notice>{error}</Notice>}

      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        <button type="submit" disabled={!ready || loading} className="mg-btn mg-btn-primary w-full">
          {t('auth.signup.submit')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="mx-auto flex min-h-11 items-center gap-2 text-[15px] font-semibold text-[rgb(var(--mg-muted))]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t('auth.external.useDifferent')}
        </button>
      </div>
    </form>
  );
}
