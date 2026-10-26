import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ClipboardList, CreditCard, Flag, Landmark } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { initialsOf } from '../../lib/profile';
import type { CompetitionPickerItem, PayoutsTo, SectionSignup, TrainerRequest } from '../../types';
import { useNeedsYou } from '../profile/needsYou';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';

interface Attention {
  /** Events with entries still waiting to be paid or confirmed. */
  pendingEntries: { id: number; name: string; count: number }[];
  /** Events with dec forms that broke a rule the organiser set (teams with at least one flag). */
  flaggedForms: { id: number; name: string; count: number }[];
  /** True when the person's club can't take payouts yet. */
  payoutsNotReady: boolean;
}

const NONE: Attention = { pendingEntries: [], flaggedForms: [], payoutsNotReady: false };

/** Work that is waiting on an organiser: unpaid entries for events this week, and the club's payout set-up. */
function useAttention(events: CompetitionPickerItem[]): Attention {
  const { user, hasRole, canOrganise } = useAuth();
  const [found, setFound] = useState<{ key: string; value: Attention } | null>(null);
  const clubId = user?.clubId ?? null;
  const runsClub = hasRole('Admin') || hasRole('Manager');
  const mine = events.filter((event) => canOrganise({ id: event.id })).slice(0, 4);
  const key = `${user?.id ?? ''}:${runsClub ? clubId ?? '' : ''}:${mine.map((event) => event.id).join(',')}`;

  useEffect(() => {
    const checkPayouts = runsClub && clubId != null;
    if (!user || (mine.length === 0 && !checkPayouts)) return;
    let cancelled = false;
    Promise.all([
      Promise.all(mine.map((event) => api.get<SectionSignup[]>(`/competitions/${event.id}/signups`)
        .then(({ data }) => ({ id: event.id, name: event.name, count: Array.isArray(data) ? data.filter((s) => s.status === 0).length : 0 }))
        .catch(() => ({ id: event.id, name: event.name, count: 0 })))),
      Promise.all(mine.map((event) => api.get<unknown[]>(`/competitions/${event.id}/dec-form-flags`)
        .then(({ data }) => ({ id: event.id, name: event.name, count: Array.isArray(data) ? data.length : 0 }))
        .catch(() => ({ id: event.id, name: event.name, count: 0 })))),
      checkPayouts
        ? api.get<PayoutsTo>(`/clubs/${clubId}/payouts/summary`).then(({ data }) => data?.ready === false).catch(() => false)
        : Promise.resolve(false),
    ]).then(([entries, flags, payoutsNotReady]) => {
      if (!cancelled) setFound({ key, value: { pendingEntries: entries.filter((e) => e.count > 0), flaggedForms: flags.filter((e) => e.count > 0), payoutsNotReady } });
    });
    return () => { cancelled = true; };
    // `key` stands for the user, club and event list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return found && found.key === key ? found.value : NONE;
}

/**
 * What is waiting on the person: join requests with Approve and Decline right here, dec forms still to fill in,
 * and for organisers the unpaid entries and payout set-up that need a look. Shown on the Me page for everyone.
 */
export function NeedsYouPanel({ events = [] }: { events?: CompetitionPickerItem[] }) {
  const { requests, decForms, review, reviewError } = useNeedsYou();
  const attention = useAttention(events);
  const [failed, setFailed] = useState<string | null>(null);
  const count = requests.length + decForms.length + attention.pendingEntries.length + attention.flaggedForms.length + (attention.payoutsNotReady ? 1 : 0);

  async function decide(request: TrainerRequest, action: 'approve' | 'decline') {
    setFailed(null);
    if (action === 'decline' && !(await confirmDialog({ title: `Decline ${request.fullName}’s request?`, message: 'Their account stays a member.', confirmLabel: 'Decline', destructive: true }))) return;
    if (!(await review(request, action))) setFailed(request.userId);
  }

  if (count === 0) return null;
  return (
    <section aria-label="Needs you" className="flex flex-col gap-2">
      <div className="mg-section-head"><h2>Needs you</h2><span>{count}</span></div>
      {requests.map((request) => (
        <div key={request.userId} className="mg-card flex flex-col gap-2.5 px-3.5 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="mg-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--mg-late-bg))] text-[15px] font-bold text-[rgb(var(--mg-late-ink))]">
              {initialsOf(request.fullName, request.email)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold leading-tight">{request.fullName}</div>
              <div className="text-sm text-[rgb(var(--mg-muted))]">Wants to join as {request.requestedRole === 'Manager' ? 'a team manager' : 'a trainer'}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="mg-btn mg-btn-primary !min-h-11 flex-1 !text-[15px]" onClick={() => decide(request, 'approve')}>Approve</button>
            <button type="button" className="mg-btn mg-btn-secondary !min-h-11 flex-1 !text-[15px]" onClick={() => decide(request, 'decline')}>Decline</button>
          </div>
          {failed === request.userId && <Notice>{reviewError ?? 'Couldn’t update this request. Check your signal and try again.'}</Notice>}
        </div>
      ))}
      {decForms.map((t) => (
        <NeedsLink key={`form-${t.id}`} to={`/competitions/${t.competitionId}/declarations?team=${t.id}`} urgent icon={<ClipboardList aria-hidden="true" className="h-6 w-6 shrink-0" />}>
          Dec form needed: {t.displayName}
        </NeedsLink>
      ))}
      {attention.pendingEntries.map((entry) => (
        <NeedsLink key={`entries-${entry.id}`} to={`/competitions/${entry.id}/details`} sub={entry.name}
          icon={<CreditCard aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" />}>
          {entry.count} {entry.count === 1 ? 'entry' : 'entries'} waiting for payment
        </NeedsLink>
      ))}
      {attention.flaggedForms.map((entry) => (
        <NeedsLink key={`flags-${entry.id}`} to={`/competitions/${entry.id}/declarations`} sub={entry.name}
          icon={<Flag aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-late-time))]" />}>
          {entry.count} dec {entry.count === 1 ? 'form' : 'forms'} flagged
        </NeedsLink>
      ))}
      {attention.payoutsNotReady && (
        <NeedsLink to="/me/payouts" sub="Entry money can’t be paid out until this is done"
          icon={<Landmark aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" />}>
          Club payouts aren’t ready
        </NeedsLink>
      )}
    </section>
  );
}

function NeedsLink({ to, icon, urgent, sub, children }: { to: string; icon: ReactNode; urgent?: boolean; sub?: string; children: ReactNode }) {
  return (
    <Link to={to} className={`flex min-h-[60px] items-center gap-3 rounded-xl px-3.5 py-2 ${urgent ? 'bg-[rgb(var(--mg-problem-bg))] text-[rgb(var(--mg-problem-ink))]' : 'mg-card'}`}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold leading-tight text-[rgb(var(--mg-ink))]">{children}</span>
        {sub && <span className="block truncate text-sm text-[rgb(var(--mg-muted))]">{sub}</span>}
      </span>
      <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
    </Link>
  );
}
