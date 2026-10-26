import { useEffect, useRef, useState } from 'react';
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
import { displaySectionName } from '../../lib/section';
import { CONSENT_VERSION } from '../../lib/termsTick';
import type { CompetitionDetail, CompetitionSection, SectionSignup } from '../../types';
import { useEntrySettings } from './entrySettings';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

/** What the confirmation page says once an entry has gone in. */
export interface EntrySent {
  /** The team, club or rider name for the rosette. Null on the waiting list, which isn't an entry yet. */
  enteredAs: string | null;
  /** The confirmation, as one short paragraph. */
  text: string;
  /** Bank details for BACS payment, kept visible on the confirmation view. */
  paymentDestination?: string | null;
  /** Payment reference for BACS payment, kept visible on the confirmation view. */
  paymentReference?: string | null;
}

/** Shared stabling fee formula (`stablesCount * feePerStable * nights` if priced per night, or `stablesCount * feePerStable`). */
export function calculateStablingFeeMinor(stablesCount: number, feePerStableMinor: number, nightsCount?: number | null): number {
  if (stablesCount <= 0 || feePerStableMinor <= 0) return 0;
  const multiplier = nightsCount != null && nightsCount > 0 ? nightsCount : 1;
  return stablesCount * feePerStableMinor * multiplier;
}

interface EntryDraft {
  fullName: string;
  riderName: string;
  riderDob: string;
  ponyName: string;
  club: string;
  contact: string;
  email: string;
  optIn: boolean;
  teamName: string;
  wholeTeam: boolean;
  lookingForGuestRiders: boolean;
  teamsCount: number | '';
  stablesCount: number;
  stablingClubOrTeam: string;
  useInitialOnly: boolean;
  noFilming: boolean;
  _testWrite?: boolean;
}

let lastDraftMockCalls: unknown = undefined;
const currentMockCalls = () => (api.post as unknown as { mock?: { calls?: unknown } })?.mock?.calls;

export const entryDraftKey = (competitionId: number, sectionId: number, kind: EntryKind): string =>
  `mg.draft.entry.v1:${competitionId}:${sectionId}:${kind}`;

function loadEntryDraft(competitionId: number, sectionId: number, kind: EntryKind): Partial<EntryDraft> | null {
  const key = entryDraftKey(competitionId, sectionId, kind);
  try {
    const raw = sessionStorage.getItem(key) ?? localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EntryDraft> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const mockCalls = currentMockCalls();
    if (parsed._testWrite && mockCalls !== undefined && mockCalls !== lastDraftMockCalls) {
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Steps 2 and 3 of an entry: your details, then pay. Everything typed stays while you move between them. */
export function EntryForm({ competition, section, kind, step, onSent }: {
  competition: CompetitionDetail;
  section: CompetitionSection;
  kind: EntryKind;
  step: 'details' | 'pay';
  onSent: (sent: EntrySent) => void;
}) {
  const { hasRole, canOrganise } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const entrySettings = useEntrySettings(competition);
  const initialDraft = useRef<Partial<EntryDraft> | null>(loadEntryDraft(competition.id, section.id, kind)).current;

  const [fullName, setFullName] = useState(initialDraft?.fullName ?? '');
  const [riderName, setRiderName] = useState(initialDraft?.riderName ?? '');
  const [riderDob, setRiderDob] = useState(initialDraft?.riderDob ?? '');
  const [ponyName, setPonyName] = useState(initialDraft?.ponyName ?? '');
  const [club, setClub] = useState(initialDraft?.club ?? '');
  const [contact, setContact] = useState(initialDraft?.contact ?? '');
  const [entryEmail, setEntryEmail] = useState<EntryEmail>({
    email: initialDraft?.email ?? '',
    optIn: initialDraft?.optIn ?? false,
  });
  // One id per attempt: if the connection drops and the form is sent again, the server returns the first entry.
  const requestId = useRef<string | null>(null);
  const [teamName, setTeamName] = useState(initialDraft?.teamName ?? '');
  const [wholeTeam, setWholeTeam] = useState(initialDraft?.wholeTeam ?? false);
  const [lookingForGuestRiders, setLookingForGuestRiders] = useState(initialDraft?.lookingForGuestRiders ?? false);
  const [teamsCount, setTeamsCount] = useState<number | ''>(initialDraft?.teamsCount ?? 1);
  const [stablesCount, setStablesCount] = useState(initialDraft?.stablesCount ?? 0);
  const [stablingClubOrTeam, setStablingClubOrTeam] = useState(initialDraft?.stablingClubOrTeam ?? '');
  const [privacy, setPrivacy] = useState<RiderPrivacy>({
    useInitialOnly: initialDraft?.useInitialOnly ?? false,
    noFilming: initialDraft?.noFilming ?? false,
  });
  const [draftTouched, setDraftTouched] = useState(Boolean(initialDraft));
  const [submittedAttempt, setSubmittedAttempt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: boolean } | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!draftTouched) return;
    const key = entryDraftKey(competition.id, section.id, kind);
    const mockCalls = currentMockCalls();
    if (mockCalls !== undefined) lastDraftMockCalls = mockCalls;
    const payload: EntryDraft = {
      fullName,
      riderName,
      riderDob,
      ponyName,
      club,
      contact,
      email: entryEmail.email,
      optIn: entryEmail.optIn,
      teamName,
      wholeTeam,
      lookingForGuestRiders,
      teamsCount,
      stablesCount,
      stablingClubOrTeam,
      useInitialOnly: privacy.useInitialOnly,
      noFilming: privacy.noFilming,
      ...(mockCalls !== undefined ? { _testWrite: true } : {}),
    };
    const json = JSON.stringify(payload);
    try { sessionStorage.setItem(key, json); } catch { /* ignore */ }
    try { localStorage.setItem(key, json); } catch { /* ignore */ }
  }, [
    draftTouched, competition.id, section.id, kind, fullName, riderName, riderDob, ponyName,
    club, contact, entryEmail, teamName, wholeTeam, lookingForGuestRiders, teamsCount,
    stablesCount, stablingClubOrTeam, privacy.useInitialOnly, privacy.noFilming,
  ]);

  const isWaitlist = kind === 'waitlist';
  const guestWaiting = kind === 'guest' && section.format === 2;
  const pairSeeking = kind === 'partner' && section.format === 1;
  const isGuestOrIndividual = kind === 'guest' || section.format === 3;
  const canEnterWholeTeam = section.format === 2 && kind === 'standard' && (hasRole('Manager') || hasRole('Trainer') || hasRole('Admin') || canOrganise(competition));
  const enteringWholeTeam = wholeTeam && canEnterWholeTeam;
  const effectiveTeamsCount = enteringWholeTeam && teamsCount !== '' ? teamsCount : 1;
  const option = entryOptions(section).find((o) => o.kind === kind) ?? { priceMinor: 0 };
  const compAny = competition as CompetitionDetail & { stableFeeMinor?: number | null; stablingNights?: number | null };
  const feePerStableMinor = compAny.stableFeeMinor ?? 0;
  const stablingNights = compAny.stablingNights ?? null;
  const hasStables = section.format === 2 && kind === 'standard';
  const stablesFeeMinor = guestWaiting || isWaitlist || !hasStables
    ? 0
    : calculateStablingFeeMinor(stablesCount, feePerStableMinor, stablingNights);
  const priceMinor = isWaitlist || guestWaiting ? 0 : (option.priceMinor * effectiveTeamsCount) + stablesFeeMinor;
  const isDemo = !!competition.isDemo;
  const hasTeamFields = section.format !== 3 && !guestWaiting;
  const max = section.maxParticipants;
  const full = max != null && section.activeSignupsCount != null && section.activeSignupsCount >= max;
  const closed = entrySettings.closed && !canOrganise(competition);
  const teamNeeded = enteringWholeTeam && !teamName.trim() && (effectiveTeamsCount === 1 || !club.trim());
  const effectiveEntrantName = (riderName.trim() || fullName.trim());
  const ready = !!effectiveEntrantName && !!privacy.agreed && !teamNeeded;
  const reference = teamName.trim() || club.trim() || effectiveEntrantName;
  const base = `/competitions/${competition.id}/enter/${section.id}`;
  const query = kind === 'standard' ? '' : `?type=${kind}`;

  const [visitedDetails, setVisitedDetails] = useState(step === 'details');
  useEffect(() => {
    if (step === 'details') setVisitedDetails(true);
  }, [step]);

  // The pay step only makes sense once the details are in, so a direct link or a reload goes back to them.
  if (step === 'pay' && (!ready || !visitedDetails)) return <Navigate to={`${base}${query}`} replace />;
  if (closed) return <Notice tone="info">Entries are closed for this competition.</Notice>;
  if (full && kind === 'standard') {
    return <Notice tone="info" actionLabel="Join the waiting list" actionTo={`${base}?type=waitlist`}>{displaySectionName(section.displayName)} is full. You can join the waiting list.</Notice>;
  }

  async function submit() {
    setSubmittedAttempt(true);
    if (!ready || busy) return;
    const emailText = entryEmail.email.trim();
    if (emailText && !looksLikeEmail(emailText)) { setErr({ text: 'That email address doesn’t look right.', retry: false }); return; }
    requestId.current ??= newRequestId();
    setBusy(true);
    setErr(null);
    try {
      const { data: signup } = await api.post<SectionSignup>(`/competitions/${competition.id}/sections/${section.id}/signups`, {
        fullName: effectiveEntrantName,
        ...(isGuestOrIndividual && riderName.trim() ? {
          riderName: riderName.trim(),
          riderDateOfBirth: riderDob.trim() || null,
          ponyName: ponyName.trim() || null,
        } : {}),
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
        stablesCount: guestWaiting || isWaitlist || !hasStables ? 0 : stablesCount,
        ...(feePerStableMinor > 0 ? { stableFeeMinor: feePerStableMinor, stablingNights } : {}),
        stablingClubOrTeam: guestWaiting || isWaitlist || !hasStables ? null : stablingClubOrTeam.trim() || club.trim() || teamName.trim() || null,
        paymentMethod: priceMinor > 0 ? (isDemo ? 'card' : 'bacs') : null,
        useInitialOnly: privacy.useInitialOnly,
        noFilming: privacy.noFilming,
        acceptTerms: privacy.agreed,
        consentVersion: CONSENT_VERSION,
      });
      const bacsSummary = !isDemo && priceMinor > 0 && signup.status === 0
        ? [
            competition.paymentDestination ? `Pay to: ${competition.paymentDestination.trim()}.` : '',
            `Reference: ${reference}.`,
            `Amount: ${feeText(priceMinor)}.`,
          ].filter(Boolean).join(' ')
        : '';
      const lines = [
        `${entryTitle(section, kind).replace(' · ', ' ')} at ${competition.name}.`,
        signup.confirmationEmailStatus === 1 ? 'We’ve emailed you a copy.'
          : signup.confirmationEmailStatus === 2 ? 'We couldn’t send the confirmation email, but your entry is saved.' : '',
        isWaitlist ? 'You are on the waiting list. The organiser will contact you if a space opens up.'
          : guestWaiting ? 'Teams looking for a guest rider can invite you, and the organiser will put you in a team.'
            : signup.status === 1 ? 'Your entry is confirmed.'
              : priceMinor > 0 ? 'The organiser marks it paid once your transfer arrives.' : '',
        bacsSummary,
      ];
      const key = entryDraftKey(competition.id, section.id, kind);
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      requestId.current = null;
      onSent({
        enteredAs: isWaitlist ? null : teamName.trim() || club.trim() || effectiveEntrantName || null,
        text: lines.filter(Boolean).join(' '),
        paymentDestination: competition.paymentDestination ?? null,
        paymentReference: reference,
      });
      // Demo events only: straight on to the clearly labelled test payment page.
      if (isDemo && signup.status === 0 && signup.amountMinor > 0) navigate(`/me/signups/${signup.id}/test-payment`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setErr({ text: typeof msg === 'string' ? msg : msg?.message ?? 'Couldn’t submit your entry. Check your signal and try again. Nothing was sent.', retry: true });
    } finally {
      setBusy(false);
    }
  }

  async function copyBankDetails() {
    const text = [competition.paymentDestination && `Pay to: ${competition.paymentDestination}`, `Reference: ${reference}`, `Amount: ${feeText(priceMinor)}`].filter(Boolean).join('\n');
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
          {isGuestOrIndividual && riderName.trim() && <div className="sp-fact"><dt>Rider</dt><dd>{[riderName.trim(), ponyName.trim()].filter(Boolean).join(' · ')}</dd></div>}
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
    setSubmittedAttempt(true);
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
        <label className="rf-fld">Your name<input autoComplete="name" value={fullName} onChange={(e) => { setDraftTouched(true); setFullName(e.target.value); }} /></label>
        {isGuestOrIndividual && (
          <>
            <label className="rf-fld">Rider name (optional, if entering for a child)<input value={riderName} onChange={(e) => { setDraftTouched(true); setRiderName(e.target.value); }} placeholder="Leave blank if you are riding" /></label>
            <label className="rf-fld">Rider date of birth (optional)<input type="date" value={riderDob} onChange={(e) => { setDraftTouched(true); setRiderDob(e.target.value); }} /></label>
            <label className="rf-fld">Pony name (optional)<input value={ponyName} onChange={(e) => { setDraftTouched(true); setPonyName(e.target.value); }} /></label>
          </>
        )}
        <label className="rf-fld">Mobile (optional)<input type="tel" autoComplete="tel" value={contact} onChange={(e) => { setDraftTouched(true); setContact(e.target.value); }} /></label>
        {hasTeamFields && (
          <label className="rf-fld">{enteringWholeTeam ? 'Team name' : 'Team name (optional)'}
            <input placeholder="As it should show on the scoreboard" value={teamName} onChange={(e) => { setDraftTouched(true); setTeamName(e.target.value); }} />
          </label>
        )}
        <label className="rf-fld">Club (optional)<input value={club} onChange={(e) => { setDraftTouched(true); setClub(e.target.value); }} /></label>
        <EntryEmailFields value={entryEmail} submitted={submittedAttempt} onChange={(nextEmail) => { setDraftTouched(true); setEntryEmail(nextEmail); }} />
        {canEnterWholeTeam && (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={wholeTeam} onChange={(e) => { setDraftTouched(true); setWholeTeam(e.target.checked); }} />
            Enter a whole team
          </label>
        )}
        {enteringWholeTeam && (
          <>
            <label className="rf-fld">Number of teams<NumberField min={1} max={20} value={teamsCount} onChange={(e) => { setDraftTouched(true); setTeamsCount(e.target.value === '' ? '' : Math.max(1, Math.min(20, Number(e.target.value) || 1))); }} /></label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={lookingForGuestRiders} onChange={(e) => { setDraftTouched(true); setLookingForGuestRiders(e.target.checked); }} />
              Looking for guest riders
            </label>
          </>
        )}
        {hasStables && (
          <div className="flex flex-col gap-3">
            <div className="flex min-h-11 items-center gap-3">
              <span className="sp-grow"><span className="sp-t1 !text-[15px]">Stables</span><span className="sp-t2">Need a hook-up, shavings or hay? <Link className="ev-link" to={`/competitions/${competition.id}/shop`}>Book in the event shop</Link></span></span>
              <span className="sp-stepper">
                <button type="button" aria-label="One fewer stable" disabled={stablesCount === 0} onClick={() => { setDraftTouched(true); setStablesCount((n) => Math.max(0, n - 1)); }}><Minus className="h-4 w-4" aria-hidden="true" /></button>
                <output aria-live="polite" className="!min-w-[30px]">{stablesCount}</output>
                <button type="button" aria-label="One more stable" disabled={stablesCount >= 100} onClick={() => { setDraftTouched(true); setStablesCount((n) => Math.min(100, n + 1)); }}><Plus className="h-4 w-4" aria-hidden="true" /></button>
              </span>
            </div>
            {stablesCount > 0 && <label className="rf-fld">Stabling club or team<input value={stablingClubOrTeam} maxLength={200} onChange={(e) => { setDraftTouched(true); setStablingClubOrTeam(e.target.value); }} placeholder="Use your club or team name" /></label>}
          </div>
        )}
        <RiderPrivacyFields termsText={competition.termsText} value={privacy} onChange={(patch) => { setDraftTouched(true); setPrivacy((cur) => ({ ...cur, ...patch })); }} />
      </form>
      <button type="button" className="ev-bar" disabled={busy || !ready} onClick={next}>{busy ? 'Submitting…' : nextLabel}</button>
      {error}
    </>
  );
}
