import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { usePageHeader } from '../components/CompactPageBarContext';
import { confirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Notice';
import { Sheet } from '../components/Sheet';
import { priceLabel } from '../lib/money';
import { groupSignups } from '../lib/mySignups';
import { displaySectionName } from '../lib/section';
import type { MySignup } from '../types';
import { DemoEntryPayment } from './commerce/DemoEntryPayment';
import '../components/sitePages.css';

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

/** The status word on the right of a row, and whether it is the one that needs the person (an unpaid entry). */
function statusOf(s: ExtendedMySignup): { label: string; due: boolean } {
  if (s.status === 2) return { label: 'Refunded', due: false };
  if (s.refundPending) return { label: 'Refund pending', due: false };
  if (s.isWithdrawn) return { label: 'Withdrawn', due: false };
  if (s.status === 3) return { label: 'Cancelled', due: false };
  if (s.status === 0) return s.isWaitlist ? { label: 'Waiting list', due: false } : { label: 'Not paid', due: true };
  return { label: 'Paid', due: false };
}

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
  const [openId, setOpenId] = useState<number | null>(null);
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

  usePageHeader({ title: 'My entries', plain: true, backTo: '/me', backLabel: 'Back to Me' });

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[560px] pt-3">
        <div className="mg-card flex flex-wrap items-center gap-3 p-4">
          <p className="mg-lede">Sign in to see comps you've entered.</p>
          <Link to="/login" className="mg-btn mg-btn-primary !min-h-11 !px-4 !text-[15px]">Sign in</Link>
        </div>
      </div>
    );
  }

  if (signups == null && !loadFailed) {
    return <div className="mx-auto w-full max-w-[560px] pt-3"><p role="status" className="sp-note">Loading your entries…</p></div>;
  }

  const { comingUp, past } = groupSignups(signups ?? [], now);
  const pairRequests = (signups ?? []).filter((s) => s.pairRequestFromSignupId && s.pairRequestStatus === 'Pending');
  const open = (signups ?? []).find((s) => s.id === openId) ?? null;
  return (
    <div className="skin mx-auto flex w-full max-w-[560px] flex-col pb-4 pt-3">
      {loadFailed && signups == null && <Notice actionLabel="Try again" onAction={() => { setLoadFailed(false); setAttempt((n) => n + 1); }}>Couldn’t load your entries. Check your signal and try again.</Notice>}
      {error && <Notice onDismiss={() => setError(null)}>{error}</Notice>}

      {signups && signups.length === 0 && (
        <div className="mg-card space-y-3 p-5">
          <p className="mg-lede">You haven't entered any competitions yet.</p>
          <Link to="/events" className="mg-btn mg-btn-primary !min-h-11 !px-4 !text-[15px]">Browse competitions</Link>
        </div>
      )}

      {pairRequests.length > 0 && (
        <section aria-label="Pair request">
          <h2 className="sp-sec sp-first">{pairRequests.length === 1 ? 'Pair request' : 'Pair requests'}</h2>
          <div className="sp-card">
            {pairRequests.map((s) => (
              <div key={s.id} className="sp-row flex-wrap">
                <span className="sp-grow">
                  <span className="sp-t1">{[s.pairRequestFromName ?? 'Another rider', s.pairRequestFromClub].filter(Boolean).join(' · ')}</span>
                  <span className="sp-t2">{[s.competitionName, displaySectionName(s.sectionName)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button type="button" className="sp-red" aria-label={`Decline pair request from ${s.pairRequestFromName ?? 'another rider'}`} onClick={() => void respondPair(s.id, false)}>Decline</button>
                  <button type="button" className="sp-pill sp-pill-fill sp-pill-sm" aria-label={`Accept pair request from ${s.pairRequestFromName ?? 'another rider'}`} onClick={() => void respondPair(s.id, true)}>Accept</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {([['Coming up', comingUp], ['Past', past]] as const).map(([title, rows]) => rows.length > 0 && (
        <section key={title} aria-label={title}>
          <h2 className={`sp-sec ${title === 'Coming up' && pairRequests.length === 0 ? 'sp-first' : ''}`}>{title}</h2>
          <ul className="sp-card m-0 list-none p-0">
            {rows.map((s) => {
              const status = statusOf(s as ExtendedMySignup);
              return (
                <li key={s.id}>
                  <button type="button" className="sp-row" onClick={() => setOpenId(s.id)}>
                    <span className="sp-grow">
                      <span className="sp-t1">{s.competitionName}</span>
                      <span className="sp-t2">{[displaySectionName(s.sectionName), priceLabel(s.amountMinor)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className={`sp-t2 ${status.due ? 'sp-st-amber' : ''}`}>{status.label}</span>
                    <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {open && <EntrySheet signup={open} onClose={() => setOpenId(null)} onWithdraw={withdrawSignup} />}
    </div>
  );
}

/** One entry: what it is, then what can be done with it. Withdrawing closes the sheet first, then asks. */
function EntrySheet({ signup: s, onClose, onWithdraw }: { signup: ExtendedMySignup; onClose: () => void; onWithdraw: (signupId: number) => Promise<void> }) {
  const status = statusOf(s);
  const canWithdraw = (s.status === 0 || s.status === 1) && !s.isWithdrawn && !s.drawComplete;
  const declarationTeams = s.declarationAccessGranted && s.status < 2 && !s.isWithdrawn
    ? s.linkedTeams?.length ? s.linkedTeams : s.teamId ? [{ id: s.teamId, name: s.teamName || s.fullName }] : [] : [];
  const paid = s.status === 1 && s.paidAt ? ` on ${new Date(s.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
  const notes = [
    s.lookingForPair && !s.teamId ? 'Looking for a Pair (50% entry)' : null,
    s.waitingForGuestSpot && !s.teamId ? 'Waiting for a Guest Ride Spot' : null,
    s.lookingForGuestRiders ? 'Looking for Guest Rider(s)' : null,
    (s.stablesCount ?? 0) > 0 ? `Stabling: ${s.stablesCount} ${s.stablesCount === 1 ? 'stable' : 'stables'}${s.stablingClubOrTeam ? ` (${s.stablingClubOrTeam})` : ''}` : null,
    s.pairRequestToSignupId && s.pairRequestStatus === 'Pending' ? `Pair request sent to ${s.pairRequestToName ?? 'a rider'}, waiting for an answer` : null,
    s.ponyClubName ? `Pony Club: ${s.ponyClubName}` : null,
  ].filter((note): note is string => note !== null);
  return (
    <Sheet title={s.competitionName} onClose={onClose}
      description={`${[displaySectionName(s.sectionName), s.teamName || s.fullName, priceLabel(s.amountMinor)].filter(Boolean).join(' · ')} · ${status.label}${paid}`}>
      {({ close }) => (
        <>
          {notes.map((note) => <p key={note} className="kit-sheet-text m-0">{note}</p>)}
          <div className="flex flex-col gap-2">
            {status.due && <Link to={`/competitions/${s.competitionId}/details`} className="kit-pill kit-pill-fill" aria-label={`How to pay for ${s.competitionName}`}>How to pay</Link>}
            {declarationTeams.map((t) => (
              <Link key={t.id} to={`/competitions/${s.competitionId}/declarations?team=${t.id}`} className="kit-pill">
                {declarationTeams.length === 1 ? 'Fill in dec form' : `Dec form for ${t.name}`}
              </Link>
            ))}
          </div>
          {s.amountMinor > 0 && <DemoEntryPayment signupId={s.id} signupStatus={s.status} />}
          <div className="flex items-center justify-between gap-2">
            {canWithdraw
              ? <button type="button" className="kit-redtext" onClick={() => close(() => { onClose(); void onWithdraw(s.id); })}>Withdraw</button>
              : <span />}
            <button type="button" className="kit-pill" onClick={() => close()}>Close</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
