import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import { tr, type Translate } from '../i18n/translate';
import { usePageHeader } from '../components/CompactPageBarContext';
import { confirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Notice';
import { Sheet } from '../components/Sheet';
import { priceLabel } from '../lib/money';
import { guestRiderSummary } from '../lib/guestRider';
import { groupSignups } from '../lib/mySignups';
import { buildLorryStablingPassFromMySignup, downloadOfflineWalletPass } from '../lib/stablingPass';
import { displaySectionName } from '../lib/section';
import type { MySignup } from '../types';
import { DemoEntryPayment } from './commerce/DemoEntryPayment';
import type { TestPayment } from './commerce/types';
import { offerTimeLeft, qrSvgMarkup, waitlistOfferState } from './operations/entryLogic';
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
/** `demoPaid`: the entry was paid through the demo checkout, so it says so instead of "Paid". */
function statusOf(s: ExtendedMySignup, demoPaid = false): { label: string; due: boolean } {
  if (s.status === 2) return { label: tr('account.signups.refunded'), due: false };
  if (s.refundPending) return { label: tr('account.signups.refundPending'), due: false };
  if (s.isWithdrawn) return { label: tr('account.signups.withdrawn'), due: false };
  if (s.status === 3) return { label: tr('account.signups.cancelled'), due: false };
  if (s.status === 0) return s.isWaitlist ? { label: waitlistOfferState(s.waitlistOfferExpiresAt).state === 'open' ? tr('account.signups.placeOffered') : tr('account.signups.waitingList'), due: false } : { label: tr('account.signups.notPaid'), due: true };
  return { label: tr(demoPaid ? 'account.signups.demoPaid' : 'account.signups.paid'), due: false };
}

/** "5h 20m left" in the chosen language, for an open waiting-list offer. */
function offerLeft(expiresAt: string | null | undefined, now: Date, t: Translate): string {
  const { h, m } = offerTimeLeft(new Date(expiresAt ?? 0).getTime() - now.getTime());
  return h > 0 ? t('account.signups.timeLeftHm', { h, m }) : t('account.signups.timeLeftM', { m });
}

export function MySignupsPage() {
  const { user } = useAuth();
  return <SignupList key={user?.id ?? 'signed-out'} />;
}

function SignupList() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [signups, setSignups] = useState<ExtendedMySignup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  // Entries paid through the demo checkout. A failed or odd answer leaves it empty, and they read "Paid" as before.
  const [demoPaid, setDemoPaid] = useState<ReadonlySet<number>>(new Set());
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.get<ExtendedMySignup[]>('/me/signups')
      .then((r) => { if (!cancelled) { setSignups(r.data); setError(null); setLoadFailed(false); } })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [user, attempt]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.get<TestPayment[]>('/commerce/entry-payments/mine')
      .then((r) => {
        if (cancelled || !Array.isArray(r.data)) return;
        setDemoPaid(new Set(r.data.filter((p) => p?.isTest === true && p.target === 1).map((p) => p.targetId)));
      })
      .catch(() => { /* without the list, entries read "Paid" */ });
    return () => { cancelled = true; };
  }, [user, attempt]);

  // The pair request being answered, so its buttons switch off until the answer comes back.
  const [responding, setResponding] = useState<number | null>(null);
  async function respondPair(signupId: number, accept: boolean) {
    if (responding !== null) return;
    setResponding(signupId);
    try {
      const { data } = await api.post<ExtendedMySignup>(`/my/signups/${signupId}/pair-respond`, { accept });
      setSignups((cur) => cur?.map((item) => (item.id === signupId ? data : item)) ?? null);
    } catch {
      setError(t('account.signups.pairFailed'));
    } finally {
      setResponding(null);
    }
  }

  async function withdrawSignup(signupId: number) {
    const entry = signups?.find((item) => item.id === signupId);
    const who = entry ? [entry.teamName || entry.fullName, entry.competitionName && t('account.signups.at', { competition: entry.competitionName })].filter(Boolean).join(' ') : t('account.signups.thisEntry');
    if (!(await confirmDialog({ title: t('account.signups.withdrawTitle'), message: t('account.signups.withdrawMessage', { who }), confirmLabel: t('account.signups.withdrawConfirm'), destructive: true }))) return;
    setError(null);
    try {
      const { data } = await api.post<ExtendedMySignup>(`/my/signups/${signupId}/withdraw`, {});
      setSignups((cur) => cur?.map((item) => (item.id === signupId ? { ...item, ...data } : item)) ?? null);
    } catch (caught) {
      // Once the draw has happened the API says so with a code; anything else is most likely the connection.
      const data = (caught as { response?: { status?: number; data?: { code?: string; message?: string } } }).response?.data;
      setError(data?.code === 'draw-happened'
        ? data.message || t('account.signups.drawHappened')
        : t('account.signups.withdrawFailed'));
    }
  }

  async function acceptSpot(signupId: number) {
    const entry = signups?.find((item) => item.id === signupId);
    if (!entry) return;
    const fee = entry.amountMinor > 0
      ? `${t('account.signups.takeFee', { price: priceLabel(entry.amountMinor) })} ${t('common.demoPayment.entry')}`
      : t('account.signups.takeFree');
    if (!(await confirmDialog({ title: t('account.signups.takeTitle'), message: `${entry.competitionName}, ${displaySectionName(entry.sectionName)}. ${fee}`, confirmLabel: t('account.signups.acceptPlace') }))) return;
    setError(null);
    try {
      const { data } = await api.post<ExtendedMySignup>(`/competitions/${entry.competitionId}/signups/${signupId}/accept-waitlist-spot`, {});
      setSignups((cur) => cur?.map((item) => (item.id === signupId ? { ...item, ...data } : item)) ?? null);
    } catch (caught) {
      const data = (caught as { response?: { data?: { message?: string } | string } }).response?.data;
      const message = typeof data === 'string' ? data : data?.message;
      setError(message || t('account.signups.acceptFailed'));
    }
  }

  usePageHeader({ title: t('account.signups.title'), plain: true, backTo: '/me', backLabel: t('account.backToMe') });

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[560px] pt-3">
        <div className="mg-card flex flex-wrap items-center gap-3 p-4">
          <p className="mg-lede">{t('account.signups.signInPrompt')}</p>
          <Link to="/login" className="mg-btn mg-btn-primary !min-h-11 !px-4 !text-[15px]">{t('common.signIn')}</Link>
        </div>
      </div>
    );
  }

  if (signups == null && !loadFailed) {
    return <div className="mx-auto w-full max-w-[560px] pt-3"><p role="status" className="sp-note">{t('account.signups.loading')}</p></div>;
  }

  const { comingUp, past } = groupSignups(signups ?? [], now);
  const pairRequests = (signups ?? []).filter((s) => s.pairRequestFromSignupId && s.pairRequestStatus === 'Pending');
  const open = (signups ?? []).find((s) => s.id === openId) ?? null;
  return (
    <div className="skin mx-auto flex w-full max-w-[560px] flex-col pb-4 pt-3">
      {loadFailed && signups == null && <Notice actionLabel={t('common.tryAgain')} onAction={() => { setLoadFailed(false); setAttempt((n) => n + 1); }}>{t('account.signups.loadFailed')}</Notice>}
      {error && <Notice onDismiss={() => setError(null)}>{error}</Notice>}

      {signups && signups.length === 0 && (
        <div className="mg-card space-y-3 p-5">
          <p className="mg-lede">{t('account.signups.none')}</p>
          <Link to="/events" className="mg-btn mg-btn-primary !min-h-11 !px-4 !text-[15px]">{t('account.signups.browse')}</Link>
        </div>
      )}

      {pairRequests.length > 0 && (
        <section aria-label={t('account.signups.pairRequest')}>
          <h2 className="sp-sec sp-first">{pairRequests.length === 1 ? t('account.signups.pairRequest') : t('account.signups.pairRequests')}</h2>
          <div className="sp-card">
            {pairRequests.map((s) => (
              <div key={s.id} className="sp-row flex-wrap">
                <span className="sp-grow">
                  <span className="sp-t1">{[s.pairRequestFromName ?? t('account.signups.anotherRider'), s.pairRequestFromClub].filter(Boolean).join(' · ')}</span>
                  <span className="sp-t2">{[s.competitionName, displaySectionName(s.sectionName)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button type="button" className="sp-red sp-red-tall" disabled={responding !== null} aria-label={t('account.signups.declinePair', { name: s.pairRequestFromName ?? t('account.signups.anotherRider') })} onClick={() => void respondPair(s.id, false)}>{t('account.signups.decline')}</button>
                  <button type="button" className="sp-pill sp-pill-fill" disabled={responding !== null} aria-label={t('account.signups.acceptPair', { name: s.pairRequestFromName ?? t('account.signups.anotherRider') })} onClick={() => void respondPair(s.id, true)}>{t('account.signups.accept')}</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {([['up', comingUp], ['past', past]] as const).map(([part, rows]) => rows.length > 0 && (
        <section key={part} aria-label={part === 'up' ? t('account.signups.comingUp') : t('account.signups.past')}>
          <h2 className={`sp-sec ${part === 'up' && pairRequests.length === 0 ? 'sp-first' : ''}`}>{part === 'up' ? t('account.signups.comingUp') : t('account.signups.past')}</h2>
          <ul className="sp-card m-0 list-none p-0">
            {rows.map((s) => {
              const status = statusOf(s as ExtendedMySignup, demoPaid.has(s.id));
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

      {open && <EntrySheet signup={open} demoPaid={demoPaid.has(open.id)} onClose={() => setOpenId(null)} onWithdraw={withdrawSignup} onAccept={acceptSpot} />}
    </div>
  );
}

/** One entry: what it is, then what can be done with it. Withdrawing closes the sheet first, then asks. */
function EntrySheet({ signup: s, demoPaid, onClose, onWithdraw, onAccept }: { signup: ExtendedMySignup; demoPaid: boolean; onClose: () => void; onWithdraw: (signupId: number) => Promise<void>; onAccept: (signupId: number) => Promise<void> }) {
  const { t, locale } = useLanguage();
  const status = statusOf(s, demoPaid);
  // Re-read every 30 seconds so the offer's countdown moves while the sheet is open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!s.waitlistOfferExpiresAt) return;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [s.waitlistOfferExpiresAt]);
  const offer = s.isWaitlist && !s.isWithdrawn ? waitlistOfferState(s.waitlistOfferExpiresAt, now) : { state: 'none' as const };
  const guestLine = guestRiderSummary(s.guest);
  const hasPass = s.status === 1 && !s.isWaitlist && !s.isWithdrawn
    && ((s.stablesCount ?? 0) > 0 || (s.hookupsCount ?? 0) > 0 || !!s.stableAssignment?.trim() || !!s.vehicleRegistration?.trim());
  function savePass() {
    const pass = buildLorryStablingPassFromMySignup(s);
    downloadOfflineWalletPass(pass, qrSvgMarkup(pass.verificationUrl));
  }
  const canWithdraw = (s.status === 0 || s.status === 1) && !s.isWithdrawn && !s.drawComplete;
  const declarationTeams = s.declarationAccessGranted && s.status < 2 && !s.isWithdrawn
    ? s.linkedTeams?.length ? s.linkedTeams : s.teamId ? [{ id: s.teamId, name: s.teamName || s.fullName }] : [] : [];
  const paid = s.status === 1 && s.paidAt ? t('account.signups.paidOn', { date: new Date(s.paidAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) }) : '';
  const notes = [
    s.lookingForPair && !s.teamId ? t('account.signups.lookingPair') : null,
    s.waitingForGuestSpot && !s.teamId ? t('account.signups.waitingGuest') : null,
    s.lookingForGuestRiders ? t('account.signups.lookingGuests') : null,
    (s.stablesCount ?? 0) > 0 ? `${t('account.signups.stabling', { count: s.stablesCount ?? 0 })}${s.stablingClubOrTeam ? ` (${s.stablingClubOrTeam})` : ''}` : null,
    s.pairRequestToSignupId && s.pairRequestStatus === 'Pending' ? t('account.signups.pairSent', { name: s.pairRequestToName ?? t('account.signups.aRider') }) : null,
    s.ponyClubName ? t('account.signups.ponyClub', { name: s.ponyClubName }) : null,
    guestLine ? t('account.signups.riderLine', { rider: guestLine }) : null,
  ].filter((note): note is string => note !== null);
  return (
    <Sheet title={s.competitionName} onClose={onClose}
      description={`${[displaySectionName(s.sectionName), s.teamName || s.fullName, priceLabel(s.amountMinor)].filter(Boolean).join(' · ')} · ${status.label}${paid}`}>
      {({ close }) => (
        <>
          {notes.map((note) => <p key={note} className="kit-sheet-text m-0">{note}</p>)}
          {offer.state !== 'none' && (
            <section aria-label={t('account.signups.placeOffered')} className="flex flex-col gap-2 rounded-[14px] border-[1.5px] border-[rgb(var(--mg-button))] bg-[rgb(var(--mg-tint)/.55)] p-3.5">
              <p className="kit-sheet-text m-0 font-semibold">{offer.state === 'open' ? t('account.signups.offerOpenTitle') : t('account.signups.offerExpiredTitle')}</p>
              <p className="kit-sheet-text m-0" role="status">{offer.state === 'open' ? t('account.signups.offerOpenBody', { left: offerLeft(s.waitlistOfferExpiresAt, now, t) }) : t('account.signups.offerExpiredBody')}</p>
              {offer.state === 'open' && <button type="button" className="kit-pill kit-pill-fill" onClick={() => close(() => { onClose(); void onAccept(s.id); })}>{t('account.signups.acceptPlace')}</button>}
            </section>
          )}
          <div className="flex flex-col gap-2">
            {hasPass && <button type="button" className="kit-pill" onClick={savePass}>{t('account.signups.saveArrivalPass')}</button>}
            {status.due && <Link to={`/competitions/${s.competitionId}/details`} className="kit-pill kit-pill-fill" aria-label={t('account.signups.howToPayAria', { competition: s.competitionName })}>{t('account.signups.howToPay')}</Link>}
            {declarationTeams.map((team) => (
              <Link key={team.id} to={`/competitions/${s.competitionId}/declarations?team=${team.id}`} className="kit-pill">
                {declarationTeams.length === 1 ? t('account.signups.fillDec') : t('account.signups.decFor', { name: team.name })}
              </Link>
            ))}
          </div>
          {s.amountMinor > 0 && <DemoEntryPayment signupId={s.id} signupStatus={s.status} />}
          <div className="flex items-center justify-between gap-2">
            {canWithdraw
              ? <button type="button" className="kit-redtext" onClick={() => close(() => { onClose(); void onWithdraw(s.id); })}>{t('account.signups.withdraw')}</button>
              : <span />}
            <button type="button" className="kit-pill" onClick={() => close()}>{t('common.close')}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
