import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { usePageHeader } from '../components/CompactPageBarContext';
import { confirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Notice';
import { priceLabel } from '../lib/money';
import { groupSignups } from '../lib/mySignups';
import { displaySectionName } from '../lib/section';
import type { MySignup, SignupPaymentStatus } from '../types';
import { DemoEntryPayment } from './commerce/DemoEntryPayment';

export interface ExtendedMySignup extends MySignup {
  lookingForPair?: boolean;
  lookingForGuestRiders?: boolean;
  waitingForGuestSpot?: boolean;
  pairRequestFromSignupId?: number | null;
  pairRequestFromName?: string | null;
  pairRequestFromClub?: string | null;
  pairRequestToSignupId?: number | null;
  pairRequestToName?: string | null;
  pairRequestStatus?: string | null;
  stablesCount?: number;
  stablingClubOrTeam?: string | null;
  paymentMethod?: string | null;
  isWaitlist?: boolean;
  isWithdrawn?: boolean;
  refundPending?: boolean;
  teamsCount?: number;
  drawComplete?: boolean;
  declarationAccessGranted?: boolean;
  linkedTeams?: { id: number; name: string }[];
}

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
  const [signups, setSignups] = useState<ExtendedMySignup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.get<ExtendedMySignup[]>('/me/signups')
      .then((r) => { if (!cancelled) { setSignups(r.data); setError(null); setLoadFailed(false); } })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [user, attempt]);

  async function respondPair(signupId: number, accept: boolean) {
    try {
      const { data } = await api.post<ExtendedMySignup>(`/my/signups/${signupId}/pair-respond`, { accept });
      setSignups((cur) => cur?.map((item) => (item.id === signupId ? data : item)) ?? null);
    } catch {
      setError('Couldn’t update the pair request. Check your signal and try again.');
    }
  }

  async function withdrawSignup(signupId: number) {
    const entry = signups?.find((item) => item.id === signupId);
    const who = entry ? [entry.teamName || entry.fullName, entry.competitionName && `at ${entry.competitionName}`].filter(Boolean).join(' ') : 'This entry';
    if (!(await confirmDialog({ title: 'Withdraw this entry?', message: `${who}. You can’t withdraw once the draw has happened.`, confirmLabel: 'Withdraw entry', destructive: true }))) return;
    setError(null);
    try {
      const { data } = await api.post<ExtendedMySignup>(`/my/signups/${signupId}/withdraw`, {});
      setSignups((cur) => cur?.map((item) => (item.id === signupId ? { ...item, ...data } : item)) ?? null);
    } catch {
      setError('Couldn’t withdraw this entry. Check your signal and try again. If the draw has happened, it can’t be withdrawn.');
    }
  }

  const waiting = signups?.filter((s) => s.status === 0 && !s.isWaitlist && !s.isWithdrawn).length ?? 0;
  usePageHeader({
    title: 'My signups',
    subtitle: signups ? (waiting ? `${waiting} waiting for payment` : `${signups.length} ${signups.length === 1 ? 'entry' : 'entries'}`) : undefined,
    plain: true,
    backTo: '/me',
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

  if (signups == null && !loadFailed) {
    return <div className="mx-auto w-full max-w-xl pt-3"><p role="status" className="mg-meta px-1">Loading your signups…</p></div>;
  }

  const { comingUp, past } = groupSignups(signups ?? [], now);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-2 pt-3">
      {loadFailed && signups == null && <Notice actionLabel="Try again" onAction={() => { setLoadFailed(false); setAttempt((n) => n + 1); }}>Couldn’t load your signups. Check your signal and try again.</Notice>}
      {error && <Notice onDismiss={() => setError(null)}>{error}</Notice>}

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
            {rows.map((s) => (
              <SignupRow
                key={s.id}
                signup={s}
                onRespondPair={respondPair}
                onWithdraw={withdrawSignup}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SignupRow({
  signup: s,
  onRespondPair,
  onWithdraw,
}: {
  signup: ExtendedMySignup;
  onRespondPair: (signupId: number, accept: boolean) => Promise<void>;
  onWithdraw: (signupId: number) => Promise<void>;
}) {
  const status = s.status === 2 ? STATUS[2] : s.refundPending
    ? { label: 'Withdrawn — refund pending', cls: 'mg-tag-late' }
    : s.isWithdrawn ? { label: 'Withdrawn', cls: '' }
    : s.isWaitlist && s.status === 0
      ? { label: 'Waiting list', cls: 'mg-tag-late' }
      : STATUS[s.status];
  const due = s.status === 0 && !s.isWaitlist && !s.isWithdrawn;
  const canWithdraw = (s.status === 0 || s.status === 1) && !s.isWithdrawn && !s.drawComplete;
  const declarationTeams = s.declarationAccessGranted && s.status < 2 && !s.isWithdrawn
    ? s.linkedTeams?.length ? s.linkedTeams : s.teamId ? [{ id: s.teamId, name: s.teamName || s.fullName }] : [] : [];
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
      {s.lookingForPair && !s.teamId && (
        <span className="text-xs font-semibold text-[rgb(var(--mg-heading))]">Looking for a Pair (50% entry)</span>
      )}
      {s.waitingForGuestSpot && !s.teamId && (
        <span className="text-xs font-semibold text-[rgb(var(--mg-heading))]">Waiting for a Guest Ride Spot</span>
      )}
      {s.lookingForGuestRiders && (
        <span className="text-xs font-semibold text-[rgb(var(--mg-heading))]">Looking for Guest Rider(s)</span>
      )}
      {(s.stablesCount ?? 0) > 0 && (
        <span className="text-xs text-[rgb(var(--mg-muted))]">
          Stabling: {s.stablesCount} {s.stablesCount === 1 ? 'stable' : 'stables'}{s.stablingClubOrTeam ? ` (${s.stablingClubOrTeam})` : ''}
        </span>
      )}
      {s.pairRequestFromSignupId && s.pairRequestStatus === 'Pending' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-tint))] p-2.5 text-xs">
          <span className="font-semibold text-[rgb(var(--mg-heading))]">
            Pair request from {s.pairRequestFromName ?? 'another rider'}{s.pairRequestFromClub ? ` (${s.pairRequestFromClub})` : ''}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => void onRespondPair(s.id, true)}
              className="mg-btn mg-btn-primary !min-h-8 !px-3 !py-1 !text-xs"
            >
              Accept pair
            </button>
            <button
              type="button"
              onClick={() => void onRespondPair(s.id, false)}
              className="mg-btn mg-btn-secondary !min-h-8 !px-3 !py-1 !text-xs"
            >
              Decline
            </button>
          </div>
        </div>
      )}
      {s.pairRequestToSignupId && s.pairRequestStatus === 'Pending' && (
        <span className="text-xs text-[rgb(var(--mg-muted))]">
          Pair request sent to {s.pairRequestToName ?? 'rider'} · awaiting response
        </span>
      )}
      {declarationTeams.map((t) => <Link key={t.id} to={`/competitions/${s.competitionId}/declarations?team=${t.id}`} className="mg-btn mg-btn-secondary !min-h-11">Dec form for {t.name}</Link>)}
      {due && <Link to={`/competitions/${s.competitionId}/details`} className="mg-btn mg-btn-primary !min-h-11 w-full !rounded-lg !text-sm">How to pay<span className="sr-only"> for {s.competitionName}</span></Link>}
      {s.status === 1 && s.paidAt && <span className="text-xs text-[rgb(var(--mg-muted))]">Paid {new Date(s.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
      {s.ponyClubName && <span className="text-xs text-[rgb(var(--mg-muted))]">Pony Club: {s.ponyClubName}</span>}
      {s.amountMinor > 0 && <DemoEntryPayment signupId={s.id} signupStatus={s.status} />}
      {canWithdraw && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => void onWithdraw(s.id)}
            className="mg-btn mg-btn-secondary !min-h-8 !px-3 !py-1 !text-xs"
          >
            Withdraw Entry
          </button>
        </div>
      )}
    </li>
  );
}
