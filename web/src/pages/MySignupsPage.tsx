import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CreditCard, Trophy, Check, RotateCcw, Ban, Hourglass, Users } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import type { MySignup, SignupPaymentStatus } from '../types';

const STATUS_META: Record<SignupPaymentStatus, { label: string; icon: typeof Check; cls: string }> = {
  0: { label: 'Awaiting payment', icon: Hourglass, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-200' },
  1: { label: 'Paid', icon: Check, cls: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-200' },
  2: { label: 'Refunded', icon: RotateCcw, cls: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-200' },
  3: { label: 'Cancelled', icon: Ban, cls: 'text-rose-600 bg-rose-50 dark:bg-rose-900/30 dark:text-rose-200' },
};

function priceLabel(minor: number): string {
  if (!minor) return 'Free';
  return `£${(minor / 100).toFixed(2)}`;
}

export function MySignupsPage() {
  const { user } = useAuth();
  const [signups, setSignups] = useState<MySignup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api.get<MySignup[]>('/me/signups')
      .then((r) => setSignups(r.data))
      .catch(() => setError('Could not load your signups.'));
  }, [user]);

  if (!user) {
    return (
      <div className="card p-4 text-sm">
        Sign in to see comps you've entered.
        <Link to="/login" className="ml-2 btn-primary !py-1 !px-3 text-xs">Sign in</Link>
      </div>
    );
  }

  if (signups == null && !error) {
    return <div className="card p-4 text-sm text-slate-500">Loading your signups…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-brand-600" /> My signups
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Every competition you've signed up to, and whether the organiser has marked
          your entry paid yet.
        </p>
      </div>

      {error && (
        <div className="card p-3 text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30">
          {error}
        </div>
      )}

      {signups && signups.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-500 space-y-2">
          <Trophy className="w-8 h-8 mx-auto text-brand-600/50" />
          <p>You haven't signed up to any competitions yet.</p>
          <Link to="/competitions" className="btn-primary !py-1.5 !px-3 text-xs">Browse competitions</Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {signups?.map((s) => {
            const meta = STATUS_META[s.status];
            const Icon = meta.icon;
            return (
              <li key={s.id} className="card p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/competitions/${s.competitionId}`}
                    className="font-bold text-sm sm:text-base hover:text-brand-700 dark:hover:text-brand-300"
                  >
                    {s.competitionName}
                  </Link>
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${meta.cls}`}>
                    <Icon className="w-3 h-3" /> {meta.label}
                  </span>
                  <span className="ml-auto text-sm font-bold text-brand-700 dark:text-brand-200">
                    {priceLabel(s.amountMinor)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px]">
                  <div>
                    <dt className="text-slate-500 uppercase font-semibold">Section</dt>
                    <dd className="font-medium">{s.sectionName}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 uppercase font-semibold flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" /> Starts
                    </dt>
                    <dd>{new Date(s.competitionStart).toLocaleDateString()}</dd>
                  </div>
                  {s.teamName && (
                    <div>
                      <dt className="text-slate-500 uppercase font-semibold flex items-center gap-1">
                        <Users className="w-3 h-3" /> Team
                      </dt>
                      <dd>{s.teamName}</dd>
                    </div>
                  )}
                  {s.paidAt && (
                    <div>
                      <dt className="text-slate-500 uppercase font-semibold">Paid at</dt>
                      <dd>{new Date(s.paidAt).toLocaleString()}</dd>
                    </div>
                  )}
                </dl>
                {s.ponyClubName && (
                  <p className="text-[11px] text-slate-500">Pony Club: {s.ponyClubName}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
