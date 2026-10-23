import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CreditCard, Trophy, Check, RotateCcw, Ban, Hourglass, Users } from 'lucide-react';
import { api } from '../api';
import { DemoEntryPayment } from './commerce/DemoEntryPayment';
import { useAuth } from '../auth/AuthContext';
import type { MySignup, SignupPaymentStatus } from '../types';

const STATUS_META: Record<SignupPaymentStatus, { label: string; icon: typeof Check; cls: string }> = {
  0: { label: 'Awaiting payment', icon: Hourglass, cls: 'bg-[rgb(var(--mg-late-bg))] text-[rgb(var(--mg-late-ink))]' },
  1: { label: 'Paid', icon: Check, cls: 'bg-[rgb(var(--mg-done-bg))] text-[rgb(var(--mg-heading))]' },
  2: { label: 'Refunded', icon: RotateCcw, cls: 'bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-body))]' },
  3: { label: 'Cancelled', icon: Ban, cls: 'bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-elim))]' },
};

function priceLabel(minor: number): string {
  if (!minor) return 'Free';
  return `£${(minor / 100).toFixed(2)}`;
}

export function MySignupsPage() {
  const { user } = useAuth();
  return <SignupList key={user?.id ?? 'signed-out'} />;
}

function SignupList() {
  const { user } = useAuth();
  const [signups, setSignups] = useState<MySignup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!user) return;
    api.get<MySignup[]>('/me/signups')
      .then((r) => { setSignups(r.data); setError(null); })
      .catch(() => setError('Could not load your signups.'));
  }, [user]);
  useEffect(() => { reload(); }, [reload]);

  if (!user) {
    return (
      <div className="skin mx-auto w-full max-w-[560px] py-4">
        <div className="mg-card mg-lede flex flex-wrap items-center gap-3 p-4">
          Sign in to see comps you've entered.
          <Link to="/login" className="mg-btn mg-btn-primary !min-h-10 !px-4 !text-[15px]">Sign in</Link>
        </div>
      </div>
    );
  }

  if (signups == null && !error) {
    return <div className="skin mx-auto w-full max-w-[560px] py-4"><div className="mg-card mg-meta p-4">Loading your signups…</div></div>;
  }

  return (
    <div className="skin mx-auto w-full max-w-[560px] space-y-3 py-4">
      <div>
        <h1 className="mg-h1 mg-h1-sm flex items-center gap-2">
          <CreditCard className="h-6 w-6" aria-hidden="true" /> My signups
        </h1>
        <p className="mg-meta mt-1">
          Every competition you've signed up to, and whether the organiser has marked
          your entry paid yet.
        </p>
      </div>

      {error && (
        <div className="mg-notice">
          {error}
        </div>
      )}

      {signups && signups.length === 0 ? (
        <div className="mg-card mg-lede space-y-3 p-6 text-center">
          <Trophy className="mx-auto h-8 w-8 text-[rgb(var(--mg-muted))]" aria-hidden="true" />
          <p>You haven't signed up to any competitions yet.</p>
          <Link to="/competitions" className="mg-btn mg-btn-primary !min-h-10 !px-4 !text-[15px]">Browse competitions</Link>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {signups?.map((s) => {
            const meta = STATUS_META[s.status];
            const Icon = meta.icon;
            return (
              <li key={s.id} className="mg-card space-y-2 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/competitions/${s.competitionId}`}
                    className="mg-h2 !text-lg hover:underline"
                  >
                    {s.competitionName}
                  </Link>
                  <span className={`mg-display text-xs uppercase font-bold tracking-wide px-2 py-0.5 rounded-md flex items-center gap-1 ${meta.cls}`}>
                    <Icon className="w-3 h-3" /> {meta.label}
                  </span>
                  <span className="mg-display ml-auto text-lg font-bold text-[rgb(var(--mg-heading))]">
                    {priceLabel(s.amountMinor)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[13px]">
                  <div>
                    <dt className="text-[rgb(var(--mg-muted))] uppercase font-semibold">Age group</dt>
                    <dd className="font-medium">{s.sectionName}</dd>
                  </div>
                  <div>
                    <dt className="text-[rgb(var(--mg-muted))] uppercase font-semibold flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" /> Starts
                    </dt>
                    <dd>{new Date(s.competitionStart).toLocaleDateString()}</dd>
                  </div>
                  {s.teamName && (
                    <div>
                      <dt className="text-[rgb(var(--mg-muted))] uppercase font-semibold flex items-center gap-1">
                        <Users className="w-3 h-3" /> Team
                      </dt>
                      <dd>{s.teamName}</dd>
                    </div>
                  )}
                  {s.paidAt && (
                    <div>
                      <dt className="text-[rgb(var(--mg-muted))] uppercase font-semibold">Paid at</dt>
                      <dd>{new Date(s.paidAt).toLocaleString()}</dd>
                    </div>
                  )}
                </dl>
                {s.ponyClubName && (
                  <p className="mg-meta">Pony Club: {s.ponyClubName}</p>
                )}
                {s.amountMinor > 0 && (
                  <DemoEntryPayment signupId={s.id} amountMinor={s.amountMinor} signupStatus={s.status} onChanged={reload} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
