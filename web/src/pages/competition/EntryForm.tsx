import { useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Minus, Plus } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
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
}

/** Steps 2 and 3 of an entry: your details, then pay. Everything typed stays while you move between them. */
export function EntryForm({ competition, section, kind, step, onSent, onConflict }: {
  competition: CompetitionDetail;
  section: CompetitionSection;
  kind: EntryKind;
  step: 'details' | 'pay';
  onSent: (sent: EntrySent) => void;
  /** Called when the server refuses because the places changed (409), so the page can load the current counts. */
  onConflict?: () => void;
}) {
  const { hasRole, canOrganise } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const entrySettings = useEntrySettings(competition);

  const [fullName, setFullName] = useState('');
  const [club, setClub] = useState('');
  const [contact, setContact] = useState('');
  const [entryEmail, setEntryEmail] = useState<EntryEmail>({ email: '', optIn: false });
  // One id per attempt: if the connection drops and the form is sent again, the server returns the first entry.
  const requestId = useRef<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [wholeTeam, setWholeTeam] = useState(false);
  const [lookingForGuestRiders, setLookingForGuestRiders] = useState(false);
  const [teamsCount, setTeamsCount] = useState<number | ''>(1);
  const [stablesCount, setStablesCount] = useState(0);
  const [stablingClubOrTeam, setStablingClubOrTeam] = useState('');
  const [guestFields, setGuestFields] = useState<GuestRiderFields>(blankGuestRider);
  const [showGuestProblem, setShowGuestProblem] = useState(false);
  const [privacy, setPrivacy] = useState<RiderPrivacy>({ useInitialOnly: false, noFilming: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: boolean } | null>(null);
  const toast = useToast();

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
  if (closed) return <Notice tone="info">Entries are closed for this competition.</Notice>;
  if (full && kind === 'standard') {
    return <Notice tone="info" actionLabel="Join the waiting list" actionTo={`${base}?type=waitlist`}>{displaySectionName(section.displayName)} is full. You can join the waiting list.</Notice>;
  }

  async function submit() {
    if (!ready || busy) return;
    if (guestProblem) { setShowGuestProblem(true); return; }
    const emailText = entryEmail.email.trim();
    if (emailText && !looksLikeEmail(emailText)) { setErr({ text: 'That email address doesn’t look right.', retry: false }); return; }
    requestId.current ??= newRequestId();
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
        requestId: requestId.current,
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
        `${entryTitle(section, kind).replace(' · ', ' ')} at ${competition.name}.`,
        signup.confirmationEmailStatus === 1 ? 'We’ve emailed you a copy.'
          : signup.confirmationEmailStatus === 2 ? 'We couldn’t send the confirmation email, but your entry is saved.' : '',
        isWaitlist ? 'You are on the waiting list. The organiser will contact you if a space opens up.'
          : guestWaiting ? 'Teams looking for a guest rider can invite you, and the organiser will put you in a team.'
            : signup.status === 1 ? 'Your entry is confirmed.'
              : priceMinor > 0 ? 'The organiser marks it paid once your transfer arrives.' : '',
      ];
      requestId.current = null;
      const owesByBank = priceMinor > 0 && !isDemo && signup.status !== 1;
      onSent({
        enteredAs: isWaitlist ? null : teamName.trim() || club.trim() || fullName.trim() || null,
        text: lines.filter(Boolean).join(' '),
        ...(owesByBank ? { bank: { payTo: competition.paymentDestination?.trim() || null, reference, amount: feeText(priceMinor) } } : {}),
        ...(owesByBank && normalisePaymentLinkUrl(competition.paymentLinkUrl) ? { paymentLinkUrl: normalisePaymentLinkUrl(competition.paymentLinkUrl)! } : {}),
      });
      // Demo events only: straight on to the clearly labelled test payment page.
      if (isDemo && signup.status === 0 && signup.amountMinor > 0) navigate(`/me/signups/${signup.id}/test-payment`);
    } catch (e) {
      if ((e as { response?: { status?: number } }).response?.status === 409) onConflict?.();
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setErr({ text: typeof msg === 'string' ? msg : msg?.message ?? 'Couldn’t submit your entry. Check your signal and try again. Nothing was sent.', retry: true });
    } finally {
      setBusy(false);
    }
  }

  async function copyBankDetails() {
    const text = bankDetailsText({ payTo: competition.paymentDestination ?? null, reference, amount: feeText(priceMinor) });
    try { await navigator.clipboard.writeText(text); toast.show('Bank details copied'); } catch { /* the details are on screen to copy by hand */ }
  }

  const error = err && (
    <Notice className="mt-3" actionLabel={err.retry ? 'Try again' : undefined} onAction={err.retry ? () => void submit() : undefined} actionDisabled={busy}>{err.text}</Notice>
  );

  if (step === 'pay') {
    return (
      <>
        <h2 className="ev-step-title">{isDemo ? `Pay ${feeText(priceMinor)}` : `Pay ${feeText(priceMinor)} by bank transfer`}</h2>
        {isDemo ? (
          <p className="ev-body">This is a demo event. After you submit, you will see a test payment page. No money is taken.</p>
        ) : (
          <>
            <dl className="sp-card sp-facts" aria-label="Bank details">
              {competition.paymentDestination && <div className="sp-fact"><dt>Pay to</dt><dd className="whitespace-pre-line break-words font-mono">{competition.paymentDestination}</dd></div>}
              <div className="sp-fact"><dt>Reference</dt><dd>{reference}</dd></div>
              <div className="sp-fact"><dt>Amount</dt><dd className="font-bold">{feeText(priceMinor)}</dd></div>
            </dl>
            {!competition.paymentDestination && <p className="sp-note">The organiser will send you their payment details.</p>}
            <div className="pt-2.5">
              <button type="button" className="sp-pill !min-h-9 !px-3.5 !text-sm" onClick={() => void copyBankDetails()}>
                Copy bank details
              </button>
            </div>
          </>
        )}
        <h2 className="sp-sec">You’re entering</h2>
        <dl className="sp-card sp-facts" aria-label="Summary">
          <div className="sp-fact"><dt>Age group</dt><dd>{entryTitle(section, kind)}</dd></div>
          <div className="sp-fact"><dt>Contact</dt><dd>{[fullName.trim(), contact.trim()].filter(Boolean).join(' · ')}</dd></div>
          {hasTeamFields && teamName.trim() && <div className="sp-fact"><dt>Team name</dt><dd>{teamName.trim()}</dd></div>}
          {hasStables && stablesCount > 0 && <div className="sp-fact"><dt>Stables</dt><dd>{stablesCount}</dd></div>}
        </dl>
        <div className="pt-2"><Link to={`${base}${query}`} className="ev-text-btn">Edit</Link></div>
        <button type="button" className="ev-bar" disabled={busy || !ready} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Submit'}</button>
        {error}
        {toast.node}
      </>
    );
  }

  const nextLabel = priceMinor > 0 ? `Next: pay ${feeText(priceMinor)}` : 'Submit';
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
      <form className="ev-card flex flex-col gap-4 p-4" onSubmit={(event) => { event.preventDefault(); if (ready) next(); }}>
        <label className="rf-fld">Your name<input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
        <label className="rf-fld">Mobile (optional)<input type="tel" autoComplete="tel" value={contact} onChange={(e) => setContact(e.target.value)} /></label>
        {hasTeamFields && (
          <label className="rf-fld">{enteringWholeTeam ? 'Team name' : 'Team name (optional)'}
            <input placeholder="As it should show on the scoreboard" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          </label>
        )}
        <label className="rf-fld">Club (optional)<input value={club} onChange={(e) => setClub(e.target.value)} /></label>
        <EntryEmailFields value={entryEmail} onChange={setEntryEmail} />
        {canEnterWholeTeam && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={wholeTeam} onChange={(e) => setWholeTeam(e.target.checked)} />
            Enter a whole team
          </label>
        )}
        {enteringWholeTeam && (
          <>
            <label className="rf-fld">Number of teams<NumberField min={1} max={20} value={teamsCount} onChange={(e) => setTeamsCount(e.target.value === '' ? '' : Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={lookingForGuestRiders} onChange={(e) => setLookingForGuestRiders(e.target.checked)} />
              Looking for guest riders
            </label>
          </>
        )}
        {hasStables && (
          <div className="flex flex-col gap-3">
            <div className="flex min-h-11 items-center gap-3">
              <span className="sp-grow"><span className="sp-t1 !text-[15px]">Stables</span><span className="sp-t2">Need a hook-up, shavings or hay? <Link className="ev-link" to={`/competitions/${competition.id}/shop`}>Book in the event shop</Link></span>
                {stablesLeft != null && <span className="sp-t2" role="status">{stablesLeft <= 0 ? 'None left' : `${stablesLeft} ${stablesLeft === 1 ? 'stable' : 'stables'} left`}</span>}
                {hookupsLeft != null && <span className="sp-t2" role="status">{hookupsLeft <= 0 ? 'No hook-ups left' : `${hookupsLeft} ${hookupsLeft === 1 ? 'hook-up' : 'hook-ups'} left`}</span>}</span>
              <span className="sp-stepper">
                <button type="button" aria-label="One fewer stable" disabled={stablesCount === 0} onClick={() => setStablesCount((n) => Math.max(0, n - 1))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
                <output aria-live="polite" className="!min-w-[30px]">{stablesCount}</output>
                <button type="button" aria-label="One more stable" disabled={stablesCount >= stablesCap} onClick={() => setStablesCount((n) => Math.min(stablesCap, n + 1))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
              </span>
            </div>
            {stablesCount > 0 && <label className="rf-fld">Stabling club or team<input value={stablingClubOrTeam} maxLength={200} onChange={(e) => setStablingClubOrTeam(e.target.value)} placeholder="Use your club or team name" /></label>}
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
      <button type="button" className="ev-bar" disabled={busy || !ready} onClick={next}>{busy ? 'Submitting…' : nextLabel}</button>
      {error}
    </>
  );
}
