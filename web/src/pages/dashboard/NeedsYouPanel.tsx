import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { priceLabel } from '../../lib/money';
import { displaySectionName } from '../../lib/section';
import type { CompetitionPickerItem, PayoutsTo, SectionSignup, TrainerRequest } from '../../types';
import type { ExtendedMySignup } from '../MySignupsPage';
import { useNeedsYou } from '../profile/needsYou';
import '../../components/sitePages.css';

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
 * What is waiting on the person, one row each with the action on the row: join requests (Approve, Decline), dec forms
 * still to fill in, entries of their own still to pay, and for organisers the unpaid entries, flagged dec forms and
 * payout set-up that need a look. Nothing shows when nothing is waiting.
 */
export function NeedsYouPanel({ events = [], dueEntries = [] }: { events?: CompetitionPickerItem[]; dueEntries?: ExtendedMySignup[] }) {
  const { requests, decForms, review, reviewError } = useNeedsYou();
  const attention = useAttention(events);
  const [failed, setFailed] = useState<string | null>(null);
  const count = requests.length + decForms.length + dueEntries.length + attention.pendingEntries.length + attention.flaggedForms.length + (attention.payoutsNotReady ? 1 : 0);

  async function decide(request: TrainerRequest, action: 'approve' | 'decline') {
    setFailed(null);
    if (action === 'decline' && !(await confirmDialog({ title: `Decline ${request.fullName}’s request?`, message: 'Their account stays a member.', confirmLabel: 'Decline', destructive: true }))) return;
    if (!(await review(request, action))) setFailed(request.userId);
  }

  if (count === 0) return null;
  return (
    <section aria-label="Needs you">
      <h2 className="sp-sec">Needs you<small>{count}</small></h2>
      <div className="sp-card">
        {requests.map((request) => (
          <div key={request.userId}>
            <div className="sp-row flex-wrap">
              <span className="sp-grow">
                <span className="sp-t1">{request.fullName}</span>
                <span className="sp-t2">Wants to join as {request.requestedRole === 'Manager' ? 'a team manager' : 'a trainer'}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" className="sp-red" aria-label={`Decline ${request.fullName}`} onClick={() => decide(request, 'decline')}>Decline</button>
                <button type="button" className="sp-pill sp-pill-fill sp-pill-sm" aria-label={`Approve ${request.fullName}`} onClick={() => decide(request, 'approve')}>Approve</button>
              </span>
            </div>
            {failed === request.userId && <div className="px-3.5 pb-3"><Notice>{reviewError ?? 'Couldn’t update this request. Check your signal and try again.'}</Notice></div>}
          </div>
        ))}
        {decForms.map((t) => (
          <NeedsRow key={`form-${t.id}`} count="1" title="Dec form to send" sub={t.displayName} act="Fill in" to={`/competitions/${t.competitionId}/declarations?team=${t.id}`} />
        ))}
        {dueEntries.map((entry) => (
          <NeedsRow key={`due-${entry.id}`} count={priceLabel(entry.amountMinor)} title="Pay for your entry" sub={[entry.competitionName, displaySectionName(entry.sectionName)].filter(Boolean).join(' · ')}
            act="How to pay" to={`/competitions/${entry.competitionId}/details`} />
        ))}
        {attention.pendingEntries.map((entry) => (
          <NeedsRow key={`entries-${entry.id}`} count={String(entry.count)} title={entry.count === 1 ? 'Entry not paid' : 'Entries not paid'} sub={entry.name} act="Open" to={`/competitions/${entry.id}/details`} />
        ))}
        {attention.flaggedForms.map((entry) => (
          <NeedsRow key={`flags-${entry.id}`} count={String(entry.count)} title={entry.count === 1 ? 'Dec form flagged' : 'Dec forms flagged'} sub={entry.name} act="Open" to={`/competitions/${entry.id}/declarations`} />
        ))}
        {attention.payoutsNotReady && (
          <NeedsRow count="!" warn title="Payouts aren’t set up" sub="Entry money can’t be paid out until this is done" act="Set up" to="/me/payouts" />
        )}
      </div>
    </section>
  );
}

function NeedsRow({ count, title, sub, act, to, warn }: { count: string; title: string; sub: string; act: string; to: string; warn?: boolean }) {
  return (
    <div className="sp-row">
      <span className="sp-num" data-tone={warn ? 'warn' : undefined}>{count}</span>
      <span className="sp-grow"><span className="sp-t1">{title}</span><span className="sp-t2">{sub}</span></span>
      <Link to={to} className="sp-pill sp-pill-sm" aria-label={`${act}: ${title}, ${sub}`}>{act}</Link>
    </div>
  );
}
