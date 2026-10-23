import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { usePageHeader } from '../components/CompactPageBarContext';
import { priceLabel } from '../lib/money';
import { groupSignups } from '../lib/mySignups';
import { displaySectionName } from '../lib/section';
import type { MySignup, SignupPaymentStatus } from '../types';
import { DemoEntryPayment } from './commerce/DemoEntryPayment';

const STATUS: Record<SignupPaymentStatus, { label: string; cls: string }> = {
  0: { label: 'Awaiting payment', cls: 'mg-tag-late' },
  1: { label: 'Paid', cls: 'mg-tag-ok' },
  2: { label: 'Refunded', cls: '' },
  3: { label: 'Cancelled', cls: '!bg-[rgb(var(--mg-done-bg))] !text-[rgb(var(--mg-body))]' },
};

export function MySignupsPage() {
  const { user } = useAuth();
  return <SignupList key={user?.id ?? 'signed-out'} />;
}

function SignupList() {
  const { user } = useAuth();
  const [signups, setSignups] = useState<MySignup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.get<MySignup[]>('/me/signups')
      .then((r) => { if (!cancelled) { setSignups(r.data); setError(null); } })
      .catch(() => { if (!cancelled) setError('Could not load your signups.'); });
    return () => { cancelled = true; };
  }, [user]);

  const waiting = signups?.filter((s) => s.status === 0).length ?? 0;
  usePageHeader({
    title: 'My signups',
    subtitle: signups ? (waiting ? `${waiting} waiting for payment` : `${signups.length} ${signups.length === 1 ? 'entry' : 'entries'}`) : undefined,
    plain: true,
    backTo: '/dashboard',
    backLabel: 'Back to Me',
  });

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-xl pt-3">
        <div className="mg-card flex flex-wrap items-center gap-3 p-4">
          <p className="mg-lede">Sign in to see comps you've entered.</p>
          <Link to="/login" className="mg-btn mg-btn-primary !min-h-11 !px-4 !text-[15px]">Sign in</Link>
        </div>
      </div>
    );
  }

  if (signups == null && !error) {
    return <div className="mx-auto w-full max-w-xl pt-3"><p role="status" className="mg-meta px-1">Loading your signups…</p></div>;
  }

  const { comingUp, past } = groupSignups(signups ?? [], now);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 pt-3">
      {error && <div role="alert" className="mg-notice">{error}</div>}

      {signups && signups.length === 0 && (
        <div className="mg-card space-y-3 p-5">
          <p className="mg-lede">You haven't signed up to any competitions yet.</p>
          <Link to="/events" className="mg-btn mg-btn-primary !min-h-11 !px-4 !text-[15px]">Browse competitions</Link>
        </div>
      )}

      {([['Coming up', comingUp], ['Past', past]] as const).map(([title, rows]) => rows.length > 0 && (
        <section key={title} className="mg-sec" aria-label={title}>
          <div className="mg-sec-head"><h2>{title}</h2></div>
          <ul className="mg-lines">
            {rows.map((s) => <SignupRow key={s.id} signup={s} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SignupRow({ signup: s }: { signup: MySignup }) {
  const status = STATUS[s.status];
  const due = s.status === 0;
  return (
    <li className={`flex flex-col gap-2 px-3 py-2.5 ${due ? 'mg-line-late' : ''}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2.5">
        <span className="flex min-w-0 flex-col gap-[3px]">
          <Link to={`/competitions/${s.competitionId}`} className="truncate text-[15px] font-semibold !text-[rgb(var(--mg-ink))]">{s.competitionName}</Link>
          <span className="text-xs text-[rgb(var(--mg-muted))]">{[displaySectionName(s.sectionName), s.teamName || s.fullName].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="mg-display text-lg font-bold leading-none tabular-nums text-[rgb(var(--mg-heading))]">{priceLabel(s.amountMinor)}</span>
          <span className={`mg-tag !text-[11px] !font-bold ${status.cls}`}>{status.label}</span>
        </span>
      </div>
      {due && <Link to={`/competitions/${s.competitionId}/details`} className="mg-btn mg-btn-primary !min-h-11 w-full !rounded-lg !text-sm">How to pay<span className="sr-only"> for {s.competitionName}</span></Link>}
      {s.status === 1 && s.paidAt && <span className="text-xs text-[rgb(var(--mg-muted))]">Paid {new Date(s.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
      {s.ponyClubName && <span className="text-xs text-[rgb(var(--mg-muted))]">Pony Club: {s.ponyClubName}</span>}
      {s.amountMinor > 0 && <DemoEntryPayment signupId={s.id} signupStatus={s.status} />}
    </li>
  );
}
