import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Minus, Plus } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n/LanguageContext';
import { DemoPaymentNotice } from '../../components/DemoPaymentNotice';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { EntryEmailFields, type EntryEmail } from '../../components/EntryEmailFields';
import { NumberField } from '../../components/NumberField';
import { RiderPrivacyFields, type RiderPrivacy } from '../../components/RiderPrivacyFields';
import { EMAIL_OPT_IN_VERSION, looksLikeEmail, newRequestId } from '../../lib/emailOptIn';
import { entryOptions, entryTitle, feeText, type EntryKind } from '../../lib/entryOptions';
import { ageGroupWarning, blankGuestRider, guestDobIso, guestRiderBody, guestRiderProblem, MAX_GUEST_NAME, type GuestRiderFields } from '../../lib/guestRider';
import { normalisePaymentLinkUrl } from '../../lib/paymentLink';
import { displaySectionName } from '../../lib/section';
import { CONSENT_VERSION } from '../../lib/termsTick';
import type { CompetitionDetail, CompetitionSection, SectionSignup } from '../../types';
import { useEntrySettings } from './entrySettings';
import { clearEntryDraft, entryDraftKey, readEntryDraft, saveEntryDraft } from './entryDraft';
import { bankDetailsText, type BankDetails } from '../../lib/bankDetails';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

/** What the confirmation page says once an entry has gone in. */
export interface EntrySent {
  /** The team, club or rider name for the rosette. Null on the waiting list, which isn't an entry yet. */
  enteredAs: string | null;
  /** The confirmation, as one short paragraph. */
  text: string;
  /** Set when money is still owed by bank transfer, so the confirmation can keep showing where to send it. */
  bank?: BankDetails;
  /** The organiser's optional online payment link (https only), shown beside the bank details. */
  paymentLinkUrl?: string;
  /** Set when the entry carries a fee, so the confirmation can repeat that this is a demo. */
  hasFee?: boolean;
}

/** Steps 2 and 3 of an entry: your details, then pay. Everything typed stays while you move between them. */
interface EntryFormProps {
  competition: CompetitionDetail;
  section: CompetitionSection;
  kind: EntryKind;
  step: 'details' | 'pay';
  onSent: (sent: EntrySent) => void;
  /** Called when the server refuses because the places changed (409), so the page can load the current counts. */
  onConflict?: () => void;
}

export function EntryForm(props: EntryFormProps) {
  const { user } = useAuth();
  if (!user) return null;
  const draftKey = entryDraftKey(user.id, props.competition.id, props.section.id, props.kind);
  return <EntryFormDetails key={draftKey} {...props} draftKey={draftKey} />;
}

function EntryFormDetails({ competition, section, kind, step, onSent, onConflict, draftKey }: EntryFormProps & { draftKey: string }) {
  const t = useT();
  const { user, hasRole, canOrganise } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const entrySettings = useEntrySettings(competition);

  // Read once per account/event/section/type; subsequent profile or live updates must not replace typing.
  const [draft] = useState(() => readEntryDraft(draftKey));
  const [fullName, setFullName] = useState(draft?.fullName ?? user?.fullName ?? '');
  const [club, setClub] = useState(draft?.club ?? user?.clubName ?? '');
  const [contact, setContact] = useState('');
  const [entryEmail, setEntryEmail] = useState<EntryEmail>({ email: (user?.email && looksLikeEmail(user.email) && !/@(?:[^@]*\.)?mg\.local$/i.test(user.email) ? user.email : ''), optIn: false });
  // One id per attempt: if the connection drops and the form is sent again, the server returns the first entry.
  const [requestId] = useState(() => draft?.requestId ?? newRequestId());
  const completed = useRef(false);
  const mounted = useRef(false);
  const [draftSaved, setDraftSaved] = useState(true);
  const [teamName, setTeamName] = useState(draft?.teamName ?? '');
  const [wholeTeam, setWholeTeam] = useState(draft?.wholeTeam ?? false);
  const [lookingForGuestRiders, setLookingForGuestRiders] = useState(draft?.lookingForGuestRiders ?? false);
  const [teamsCount, setTeamsCount] = useState<number | ''>(draft?.teamsCount ?? 1);
  const [stablesCount, setStablesCount] = useState(draft?.stablesCount ?? 0);
  const [stablingClubOrTeam, setStablingClubOrTeam] = useState(draft?.stablingClubOrTeam ?? '');
  const [guestFields, setGuestFields] = useState<GuestRiderFields>(blankGuestRider);
  const [showGuestProblem, setShowGuestProblem] = useState(false);
  const [privacy, setPrivacy] = useState<RiderPrivacy>({ useInitialOnly: draft?.useInitialOnly ?? false, noFilming: draft?.noFilming ?? false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: boolean } | null>(null);
  const toast = useToast();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (completed.current) return;
    setDraftSaved(saveEntryDraft(draftKey, {
      fullName, club, teamName, wholeTeam, lookingForGuestRiders,
      teamsCount, stablesCount, stablingClubOrTeam, useInitialOnly: privacy.useInitialOnly,
      noFilming: privacy.noFilming, requestId,
    }));
  }, [draftKey, fullName, club, teamName, wholeTeam, lookingForGuestRiders,
    teamsCount, stablesCount, stablingClubOrTeam, privacy.useInitialOnly, privacy.noFilming, requestId]);

  const isWaitlist = kind === 'waitlist';
  const guestWaiting = kind === 'guest' && section.format === 2;
  const pairSeeking = kind === 'partner' && section.format === 1;
  const canEnterWholeTeam = section.format === 2 && kind === 'standard' && (hasRole('Manager') || hasRole('Trainer') || hasRole('Admin') || canOrganise(competition));
  const enteringWholeTeam = wholeTeam && canEnterWholeTeam;
  const effectiveTeamsCount = enteringWholeTeam && teamsCount !== '' ? teamsCount : 1;
  const option = entryOptions(section).find((o) => o.kind === kind) ?? { priceMinor: 0 };
  const priceMinor = isWaitlist || guestWaiting ? 0 : option.priceMinor * effectiveTeamsCount;
  const isDemo = !!competition.isDemo;
  const hasTeamFields = section.format !== 3 && !guestWaiting;
  const hasStables = section.format === 2 && kind === 'standard';
  // The rider and the parent are asked about on guest, solo and individual entries, never on a whole team.
  const hasGuestRider = !enteringWholeTeam && (kind === 'guest' || kind === 'partner' || section.format !== 2);
  const guestProblem = hasGuestRider ? guestRiderProblem(guestFields) : null;
  const dobIso = guestFields.riderDob.trim() ? guestDobIso(guestFields.riderDob) : null;
  const ageWarning = hasGuestRider ? ageGroupWarning(dobIso, section.displayName, competition.startDate) : null;
  const stablesLeft = entrySettings.stablesRemaining;
  const hookupsLeft = entrySettings.hookupsRemaining;
  const stablesCap = stablesLeft == null ? 100 : Math.max(0, Math.min(100, stablesLeft));
  const setGuest = (patch: Partial<GuestRiderFields>) => setGuestFields((cur) => ({ ...cur, ...patch }));
  const max = section.maxParticipants;
  const full = max != null && section.activeSignupsCount != null && section.activeSignupsCount >= max;
  const closed = entrySettings.closed && !canOrganise(competition);
  const teamNeeded = enteringWholeTeam && !teamName.trim() && (effectiveTeamsCount === 1 || !club.trim());
  const ready = !!fullName.trim() && !!privacy.agreed && !teamNeeded;
  const reference = teamName.trim() || club.trim() || fullName.trim();
  const base = `/competitions/${competition.id}/enter/${section.id}`;
  const query = kind === 'standard' ? '' : `?type=${kind}`;

  // The pay step only makes sense once the details are in, so a direct link or a reload goes back to them.
  if (step === 'pay' && (!ready || guestProblem)) return <Navigate to={`${base}${query}`} replace />;
  if (closed) return <Notice tone="info">{t('entries.page.closed')}</Notice>;
  if (full && kind === 'standard') {
    return <Notice tone="info" actionLabel={t('entries.kind.waitlist')} actionTo={`${base}?type=waitlist`}>{t('entries.form.full', { section: displaySectionName(section.displayName) })}</Notice>;
  }

  async function submit() {
    if (!ready || busy) return;
    if (guestProblem) { setShowGuestProblem(true); return; }
    const emailText = entryEmail.email.trim();
    if (emailText && !looksLikeEmail(emailText)) { setErr({ text: t('entries.form.emailInvalid'), retry: false }); return; }
    setBusy(true);
    setErr(null);
    try {
      const { data: signup } = await api.post<SectionSignup>(`/competitions/${competition.id}/sections/${section.id}/signups`, {
        fullName: fullName.trim(),
        ponyClubName: club.trim() || null,
        contactInfo: contact.trim() || null,
        contactEmail: emailText || null,
        emailOptIn: !!emailText && entryEmail.optIn,
        emailOptInVersion: emailText && entryEmail.optIn ? EMAIL_OPT_IN_VERSION : null,
        requestId,
        teamCode: null,
        teamName: !hasTeamFields ? null : teamName.trim() || (enteringWholeTeam && effectiveTeamsCount > 1 ? club.trim() : null) || null,
        lookingForPair: pairSeeking,
        lookingForGuestRiders: enteringWholeTeam && lookingForGuestRiders,
        waitingForGuestSpot: guestWaiting,
        wholeTeam: enteringWholeTeam,
        teamsCount: effectiveTeamsCount,
        isWaitlist,
        // Flat fields, as the API reads them. A whole-team entry sends none.
        ...(hasGuestRider ? guestRiderBody(guestFields) : {}),
        stablesCount: guestWaiting || isWaitlist || !hasStables ? 0 : Math.min(stablesCount, stablesCap),
        stablingClubOrTeam: guestWaiting || isWaitlist || !hasStables ? null : stablingClubOrTeam.trim() || club.trim() || teamName.trim() || null,
        paymentMethod: priceMinor > 0 ? (isDemo ? 'card' : 'bacs') : null,
        useInitialOnly: privacy.useInitialOnly,
        noFilming: privacy.noFilming,
        acceptTerms: privacy.agreed,
        consentVersion: CONSENT_VERSION,
      });
      const lines = [
        t('entries.form.sentTitle', { entry: entryTitle(section, kind).replace(' · ', ' '), competition: competition.name }),
        signup.confirmationEmailStatus === 1 ? t('entries.form.emailedCopy')
          : signup.confirmationEmailStatus === 2 ? t('entries.form.emailFailed') : '',
        isWaitlist ? t('entries.form.onWaitlist')
          : guestWaiting ? t('entries.form.guestWaiting')
            : signup.status === 1 ? t('entries.form.confirmed')
              : priceMinor > 0 ? t('entries.form.markedPaid') : '',
      ];
      completed.current = true;
      clearEntryDraft(draftKey);
      if (!mounted.current) return;
      const owesByBank = priceMinor > 0 && !isDemo && signup.status !== 1;
      onSent({
        enteredAs: isWaitlist ? null : teamName.trim() || club.trim() || fullName.trim() || null,
        text: lines.filter(Boolean).join(' '),
        ...(priceMinor > 0 ? { hasFee: true } : {}),
        ...(owesByBank ? { bank: { payTo: competition.paymentDestination?.trim() || null, reference, amount: feeText(priceMinor) } } : {}),
        ...(owesByBank && normalisePaymentLinkUrl(competition.paymentLinkUrl) ? { paymentLinkUrl: normalisePaymentLinkUrl(competition.paymentLinkUrl)! } : {}),
      });
      // Demo events only: straight on to the clearly labelled test payment page.
      if (isDemo && signup.status === 0 && signup.amountMinor > 0) navigate(`/me/signups/${signup.id}/test-payment`);
    } catch (e) {
      if (!mounted.current) return;
      if ((e as { response?: { status?: number } }).response?.status === 409) onConflict?.();
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setErr({ text: typeof msg === 'string' ? msg : msg?.message ?? t('entries.form.submitFailed'), retry: true });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function copyBankDetails() {
    const text = bankDetailsText({ payTo: competition.paymentDestination ?? null, reference, amount: feeText(priceMinor) });
    try { await navigator.clipboard.writeText(text); toast.show(t('entries.form.bankCopied')); } catch { /* the details are on screen to copy by hand */ }
  }

  const error = err && (
    <Notice className="mt-3" actionLabel={err.retry ? t('common.tryAgain') : undefined} onAction={err.retry ? () => void submit() : undefined} actionDisabled={busy}>{err.text}</Notice>
  );

  if (step === 'pay') {
    return (
      <>
        <h2 className="ev-step-title">{isDemo ? t('entries.form.payAmount', { fee: feeText(priceMinor) }) : t('entries.form.payByTransfer', { fee: feeText(priceMinor) })}</h2>
        <DemoPaymentNotice what="entry" className="mb-3" />
        {isDemo ? (
          <p className="ev-body">{t('entries.form.demoNote')}</p>
        ) : (
          <>
            <dl className="sp-card sp-facts" aria-label={t('entries.form.bankDetails')}>
              {competition.paymentDestination && <div className="sp-fact"><dt>{t('entries.form.payTo')}</dt><dd className="whitespace-pre-line break-words font-mono">{competition.paymentDestination}</dd></div>}
              <div className="sp-fact"><dt>{t('entries.form.reference')}</dt><dd>{reference}</dd></div>
              <div className="sp-fact"><dt>{t('entries.form.amount')}</dt><dd className="font-bold">{feeText(priceMinor)}</dd></div>
            </dl>
            {!competition.paymentDestination && <p className="sp-note">{t('entries.form.sendDetails')}</p>}
            <div className="pt-2.5">
              <button type="button" className="sp-pill !min-h-9 !px-3.5 !text-sm" onClick={() => void copyBankDetails()}>
                {t('entries.form.copyBank')}
              </button>
            </div>
          </>
        )}
        <h2 className="sp-sec">{t('entries.form.youreEntering')}</h2>
        <dl className="sp-card sp-facts" aria-label={t('entries.form.summary')}>
          <div className="sp-fact"><dt>{t('entries.form.ageGroup')}</dt><dd>{entryTitle(section, kind)}</dd></div>
          <div className="sp-fact"><dt>{t('entries.form.contact')}</dt><dd>{[fullName.trim(), contact.trim()].filter(Boolean).join(' · ')}</dd></div>
          {hasTeamFields && teamName.trim() && <div className="sp-fact"><dt>{t('entries.form.teamName')}</dt><dd>{teamName.trim()}</dd></div>}
          {hasStables && stablesCount > 0 && <div className="sp-fact"><dt>{t('entries.form.stables')}</dt><dd>{stablesCount}</dd></div>}
        </dl>
        <div className="pt-2"><Link to={`${base}${query}`} className="ev-text-btn">{t('entries.form.edit')}</Link></div>
        <button type="button" className="ev-bar" disabled={busy || !ready} onClick={() => void submit()}>{busy ? t('entries.form.submitting') : t('entries.form.submit')}</button>
        {error}
        {toast.node}
      </>
    );
  }

  const nextLabel = priceMinor > 0 ? t('entries.form.nextPay', { fee: feeText(priceMinor) }) : t('entries.form.submit');
  const next = () => {
    if (guestProblem) { setShowGuestProblem(true); return; }
    if (priceMinor > 0) navigate(`${base}/pay${query}`, { state: location.state });
    else void submit();
  };
  return (
    <>
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 className="ev-step-title">{entryTitle(section, kind)}</h2>
        <span className="ev-price !text-2xl">{feeText(priceMinor)}</span>
      </div>
      <p className="sp-note">{t('entries.form.forSomeoneElse')}</p>
      {!draftSaved && <Notice tone="info">{t('entries.form.draftUnsaved')}</Notice>}
      <form className="ev-card flex flex-col gap-4 p-4" onSubmit={(event) => { event.preventDefault(); if (ready) next(); }}>
        <label className="rf-fld">{t('entries.form.yourName')}<input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
        <label className="rf-fld">{t('entries.form.mobile')}<input type="tel" autoComplete="tel" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
        {hasTeamFields && (
          <label className="rf-fld">{enteringWholeTeam ? t('entries.form.teamName') : t('entries.form.teamNameOptional')}
            <input placeholder={t('entries.form.teamNamePlaceholder')} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          </label>
        )}
        <label className="rf-fld">{t('entries.form.club')}<input value={club} onChange={(e) => setClub(e.target.value)} /></label>
        <EntryEmailFields value={entryEmail} onChange={setEntryEmail} />
        {canEnterWholeTeam && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={wholeTeam} onChange={(e) => setWholeTeam(e.target.checked)} />
            {t('entries.form.wholeTeam')}
          </label>
        )}
        {enteringWholeTeam && (
          <>
            <label className="rf-fld">{t('entries.form.teamsCount')}<NumberField min={1} max={20} value={teamsCount} onChange={(e) => setTeamsCount(e.target.value === '' ? '' : Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={lookingForGuestRiders} onChange={(e) => setLookingForGuestRiders(e.target.checked)} />
              {t('entries.form.guestRiders')}
            </label>
          </>
        )}
        {hasStables && (
          <div className="flex flex-col gap-3">
            <div className="flex min-h-11 items-center gap-3">
              <span className="sp-grow"><span className="sp-t1 !text-[15px]">{t('entries.form.stables')}</span><span className="sp-t2">{t('entries.form.stablesHelp')} <Link className="ev-link" to={`/competitions/${competition.id}/shop`}>{t('entries.form.bookShop')}</Link></span>
                {stablesLeft != null && <span className="sp-t2" role="status">{stablesLeft <= 0 ? 'None left' : `${stablesLeft} ${stablesLeft === 1 ? 'stable' : 'stables'} left`}</span>}
                {hookupsLeft != null && <span className="sp-t2" role="status">{hookupsLeft <= 0 ? 'No hook-ups left' : `${hookupsLeft} ${hookupsLeft === 1 ? 'hook-up' : 'hook-ups'} left`}</span>}</span>
              <span className="sp-stepper">
                <button type="button" aria-label={t('entries.form.fewerStable')} disabled={stablesCount === 0} onClick={() => setStablesCount((n) => Math.max(0, n - 1))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
                <output aria-live="polite" className="!min-w-[30px]">{stablesCount}</output>
                <button type="button" aria-label={t('entries.form.moreStable')} disabled={stablesCount >= stablesCap} onClick={() => setStablesCount((n) => Math.min(stablesCap, n + 1))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
              </span>
            </div>
            {stablesCount > 0 && <label className="rf-fld">{t('entries.form.stablingClub')}<input value={stablingClubOrTeam} maxLength={200} onChange={(e) => setStablingClubOrTeam(e.target.value)} placeholder={t('entries.form.stablingPlaceholder')} /></label>}
          </div>
        )}
        {hasGuestRider && (
          <div className="flex flex-col gap-4" onBlur={() => setShowGuestProblem(true)}>
            <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-[14px] border border-[rgb(var(--mg-line))] bg-[rgb(var(--mg-tint)/.4)] p-3.5">
              <legend className="px-1.5 text-[13px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-heading))]">Rider</legend>
              <p className="sp-note !m-0">Who will be riding. If that is a child, put their name here, not yours. Leave this section blank if you are the rider.</p>
              <label className="rf-fld">Rider’s name<input autoComplete="off" maxLength={MAX_GUEST_NAME} value={guestFields.riderName} onChange={(e) => setGuest({ riderName: e.target.value })} /></label>
              <label className="rf-fld">Rider’s date of birth<input type="date" autoComplete="off" max={new Date().toISOString().slice(0, 10)} value={guestFields.riderDob} onChange={(e) => setGuest({ riderDob: e.target.value })} /></label>
              {ageWarning && <Notice tone="info">{ageWarning} You can still enter, and the organiser will check it.</Notice>}
              <label className="rf-fld">Pony’s name<input autoComplete="off" maxLength={MAX_GUEST_NAME} value={guestFields.ponyName} onChange={(e) => setGuest({ ponyName: e.target.value })} /></label>
            </fieldset>
            <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-[14px] border border-[rgb(var(--mg-line))] p-3.5">
              <legend className="px-1.5 text-[13px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--mg-heading))]">Parent or guardian and emergency contact</legend>
              <p className="sp-note !m-0">For the organiser to reach on the day. Only the organiser and the people running the event can see these details.</p>
              <label className="rf-fld">Parent or guardian’s name<input autoComplete="off" maxLength={MAX_GUEST_NAME} value={guestFields.guardianName} onChange={(e) => setGuest({ guardianName: e.target.value })} /></label>
              <label className="rf-fld">Parent or guardian’s mobile<input type="tel" autoComplete="off" value={guestFields.guardianPhone} onChange={(e) => setGuest({ guardianPhone: e.target.value })} /></label>
              <label className="rf-fld">Emergency contact’s name<input autoComplete="off" maxLength={MAX_GUEST_NAME} value={guestFields.emergencyName} onChange={(e) => setGuest({ emergencyName: e.target.value })} /></label>
              <label className="rf-fld">Emergency contact’s mobile<input type="tel" autoComplete="off" value={guestFields.emergencyPhone} onChange={(e) => setGuest({ emergencyPhone: e.target.value })} /></label>
            </fieldset>
            {showGuestProblem && guestProblem && <Notice role="alert">{guestProblem}</Notice>}
          </div>
        )}
        <RiderPrivacyFields termsText={competition.termsText} value={privacy} onChange={(patch) => setPrivacy((cur) => ({ ...cur, ...patch }))} />
      </form>
      {draftSaved && <p className="sp-note">{t('entries.form.draftSaved')}</p>}
      {priceMinor > 0 && <DemoPaymentNotice what="entry" className="mt-3" />}
      <button type="button" className="ev-bar" disabled={busy || !ready} onClick={next}>{busy ? t('entries.form.submitting') : nextLabel}</button>
      {error}
    </>
  );
}
