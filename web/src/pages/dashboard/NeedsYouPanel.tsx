import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n/LanguageContext';
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
function useAttention(events: CompetitionPickerItem[]): { attention: Attention; loaded: boolean } {
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

  // Nothing to look up counts as answered.
  const nothingToCheck = !user || (mine.length === 0 && !(runsClub && clubId != null));
  const answered = found != null && found.key === key;
  return { attention: answered ? found.value : NONE, loaded: answered || nothingToCheck };
}

/**
 * What is waiting on the person, one row each with the action on the row: join requests (Approve, Decline), dec forms
 * still to fill in, entries of their own still to pay, and for organisers the unpaid entries, flagged dec forms and
 * payout set-up that need a look. Nothing shows when nothing is waiting.
 */
export function NeedsYouPanel({ events = [], dueEntries = [], pairRequests = [], onSettled }: {
  events?: CompetitionPickerItem[]; dueEntries?: ExtendedMySignup[]; pairRequests?: ExtendedMySignup[];
  /** Called once the panel has everything it looks up, so a page can show it and its neighbours together. */
  onSettled?: () => void;
}) {
  const t = useT();
  const { requests, decForms, review, reviewError } = useNeedsYou();
  const { attention, loaded } = useAttention(events);
  useEffect(() => { if (loaded) onSettled?.(); }, [loaded, onSettled]);
  const [failed, setFailed] = useState<string | null>(null);
  const count = pairRequests.length + requests.length + decForms.length + dueEntries.length + attention.pendingEntries.length + attention.flaggedForms.length + (attention.payoutsNotReady ? 1 : 0);

  async function decide(request: TrainerRequest, action: 'approve' | 'decline') {
    setFailed(null);
    if (action === 'decline' && !(await confirmDialog({ title: t('account.needs.declineTitle', { name: request.fullName }), message: t('account.needs.declineMessage'), confirmLabel: t('account.signups.decline'), destructive: true }))) return;
    if (!(await review(request, action))) setFailed(request.userId);
  }

  if (count === 0) return null;
  return (
    <section aria-label={t('account.needs.title')}>
      <h2 className="sp-sec">{t('account.needs.title')}<small>{count}</small></h2>
      <div className="sp-card">
        {requests.map((request) => (
          <div key={request.userId}>
            <div className="sp-row flex-wrap">
              <span className="sp-grow">
                <span className="sp-t1">{request.fullName}</span>
                <span className="sp-t2">{t(request.requestedRole === 'Manager' ? 'account.needs.wantsManager' : 'account.needs.wantsTrainer')}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" className="sp-red sp-red-tall" aria-label={t('account.needs.declineAria', { name: request.fullName })} onClick={() => decide(request, 'decline')}>{t('account.signups.decline')}</button>
                <button type="button" className="sp-pill sp-pill-fill sp-pill-sm sp-pill-tall" aria-label={t('account.needs.approveAria', { name: request.fullName })} onClick={() => decide(request, 'approve')}>{t('account.needs.approve')}</button>
              </span>
            </div>
            {failed === request.userId && <div className="px-3.5 pb-3"><Notice>{reviewError ?? t('account.needs.updateFailed')}</Notice></div>}
          </div>
        ))}
        {decForms.map((team) => (
          <NeedsRow key={`form-${team.id}`} count="1" title={t('account.needs.decToSend')} sub={team.displayName} act={t('account.needs.fillIn')} to={`/competitions/${team.competitionId}/declarations?team=${team.id}`} />
        ))}
        {pairRequests.map((entry) => (
          <NeedsRow key={`pair-${entry.id}`} count="1" title={t('account.needs.pairRequest', { name: entry.pairRequestFromName || t('account.needs.pairRequestAnother') })}
            sub={[entry.competitionName, displaySectionName(entry.sectionName)].filter(Boolean).join(' · ')} act={t('account.needs.review')} to="/me/signups" />
        ))}
        {dueEntries.map((entry) => (
          <NeedsRow key={`due-${entry.id}`} count={priceLabel(entry.amountMinor)} title={t('account.needs.payTitle')} sub={[entry.competitionName, displaySectionName(entry.sectionName)].filter(Boolean).join(' · ')}
            act={t('account.signups.howToPay')} to={`/competitions/${entry.competitionId}/details`} />
        ))}
        {attention.pendingEntries.map((entry) => (
          <NeedsRow key={`entries-${entry.id}`} count={String(entry.count)} title={t('account.needs.entryUnpaid', { count: entry.count })} sub={entry.name} act={t('account.needs.open')} to={`/competitions/${entry.id}/details`} />
        ))}
        {attention.flaggedForms.map((entry) => (
          <NeedsRow key={`flags-${entry.id}`} count={String(entry.count)} title={t('account.needs.formFlagged', { count: entry.count })} sub={entry.name} act={t('account.needs.open')} to={`/competitions/${entry.id}/declarations`} />
        ))}
        {attention.payoutsNotReady && (
          <NeedsRow count="!" warn title={t('account.needs.payoutsTitle')} sub={t('account.needs.payoutsSub')} act={t('account.needs.setUp')} to="/me/payouts" />
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
