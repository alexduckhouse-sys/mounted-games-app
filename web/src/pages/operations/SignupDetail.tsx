import { useState } from 'react';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { feeText } from '../../lib/entryOptions';
import { hasActiveWaitlistOffer, normaliseVehicleReg } from '../../lib/entryWorkflows';
import { guestContactLines, guestRiderSummary } from '../../lib/guestRider';
import { buildLorryStablingPassFromSectionSignup, buildOfflineWalletPassHtml, downloadOfflineWalletPass } from '../../lib/stablingPass';
import { useSignupStablingAllocator } from '../../hooks/useSignupStabling';
import type { ArrivalWindow, CompetitionDetail, FeeDisposition, SectionSignup } from '../../types';
import {
  ARRIVAL_OPTIONS, FEE_DISPOSITION_OPTIONS, dispositionLabel, minorToPounds, offerWaitlistSpot, poundsToMinor, qrSvgMarkup,
  saveSignupArrival, saveSignupDisposition, signupBucket, waitlistOfferState,
} from './entryLogic';
import './entryTools.css';

type Comp = Pick<CompetitionDetail, 'id' | 'name' | 'startDate' | 'endDate' | 'location' | 'postcode' | 'what3Words'>;

/**
 * Everything an organiser can do with one entry: see the guest rider and (staff-only) contacts, allocate stables and
 * hook-ups, record arrival and vehicle, print the arrival pass, offer a waiting-list spot and record what happened
 * to the fee of a withdrawn entry. `onChanged` reloads the page's data after a save.
 */
export function SignupDetail({ competition, signup, onChanged }: { competition: Comp; signup: SectionSignup; onChanged: () => Promise<void> | void }) {
  const bucket = signupBucket(signup);
  const active = bucket === 'paid' || bucket === 'pending';
  const summary = guestRiderSummary(signup.guest);
  const contacts = guestContactLines(signup.guest);
  const booked = (signup.stablesCount ?? 0) > 0 || (signup.hookupsCount ?? 0) > 0 || Boolean(signup.stableAssignment || signup.hookupAssignment);
  const hasPass = active && ((signup.stablesCount ?? 0) > 0 || Boolean(signup.stableAssignment));

  return (
    <div className="et-detail">
      {(summary || contacts.length > 0) && (
        <section className="et-block" aria-label="Rider">
          {summary && <p className="rf-t1">Rider: {summary}</p>}
          {contacts.length > 0 && (
            <div className="et-private">
              <span className="et-private-tag">Staff only</span>
              {contacts.map((line) => <p key={line} className="rf-t2">{line}</p>)}
            </div>
          )}
        </section>
      )}
      {active && booked && <StablingBlock competitionId={competition.id} signup={signup} onChanged={onChanged} />}
      {active && <ArrivalBlock signup={signup} onChanged={onChanged} />}
      {hasPass && <PassBlock competition={competition} signup={signup} />}
      {bucket === 'waitlist' && <WaitlistBlock competitionId={competition.id} signup={signup} onChanged={onChanged} />}
      {bucket === 'withdrawn' && <DispositionBlock competitionId={competition.id} signup={signup} onChanged={onChanged} />}
    </div>
  );
}

function StablingBlock({ competitionId, signup, onChanged }: { competitionId: number; signup: SectionSignup; onChanged: () => Promise<void> | void }) {
  const { saveStabling, savingSignupId, error } = useSignupStablingAllocator(competitionId);
  const [stable, setStable] = useState(signup.stableAssignment ?? '');
  const [hookup, setHookup] = useState(signup.hookupAssignment ?? '');
  const [saved, setSaved] = useState(false);
  const saving = savingSignupId === signup.id;
  async function save() {
    setSaved(false);
    const result = await saveStabling(signup.id, { stableAssignment: stable.trim(), hookupAssignment: hookup.trim() });
    if (result) { setSaved(true); await onChanged(); }
  }
  return (
    <section className="et-block" aria-label="Stables and hook-ups">
      <h4 className="et-h">Stables and hook-ups</h4>
      <p className="rf-t2">{signup.stablesCount ?? 0} {(signup.stablesCount ?? 0) === 1 ? 'stable' : 'stables'} booked · {signup.hookupsCount ?? 0} {(signup.hookupsCount ?? 0) === 1 ? 'hook-up' : 'hook-ups'} booked</p>
      <div className="et-two">
        <label className="rf-fld">Stable boxes<input value={stable} maxLength={80} placeholder="Barn B, boxes 14 to 18" onChange={(e) => { setStable(e.target.value); setSaved(false); }} /></label>
        <label className="rf-fld">Hook-up<input value={hookup} maxLength={80} placeholder="Post 4" onChange={(e) => { setHookup(e.target.value); setSaved(false); }} /></label>
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="et-actions">
        <button type="button" className="rf-btn" disabled={saving} onClick={() => void save()}>Save allocation</button>
        {saved && <span className="rf-t2" role="status">Saved</span>}
      </div>
    </section>
  );
}

function ArrivalBlock({ signup, onChanged }: { signup: SectionSignup; onChanged: () => Promise<void> | void }) {
  const [window_, setWindow] = useState<ArrivalWindow | ''>(signup.arrivalWindow ?? '');
  const [reg, setReg] = useState(signup.vehicleRegistration ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await saveSignupArrival(signup.id, window_ || null, normaliseVehicleReg(reg));
      setSaved(true);
      await onChanged();
    } catch (caught) { setError(apiErrorMessage(caught, 'Couldn’t save the arrival details. Check your signal and try again.')); }
    finally { setBusy(false); }
  }
  return (
    <section className="et-block" aria-label="Arrival">
      <h4 className="et-h">Arrival</h4>
      <div className="et-two">
        <label className="rf-fld">Arrives
          <select value={window_} onChange={(e) => { setWindow(e.target.value as ArrivalWindow | ''); setSaved(false); }}>
            {ARRIVAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="rf-fld">Vehicle registration
          <input value={reg} maxLength={40} autoCapitalize="characters" onChange={(e) => { setReg(e.target.value.toUpperCase()); setSaved(false); }} />
        </label>
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="et-actions">
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void save()}>Save arrival</button>
        {saved && <span className="rf-t2" role="status">Saved</span>}
      </div>
    </section>
  );
}

function PassBlock({ competition, signup }: { competition: Comp; signup: SectionSignup }) {
  const build = () => {
    const pass = buildLorryStablingPassFromSectionSignup(signup, competition);
    return { pass, qr: qrSvgMarkup(pass.verificationUrl) };
  };
  const openToPrint = () => {
    const { pass, qr } = build();
    const url = URL.createObjectURL(new Blob([buildOfflineWalletPassHtml(pass, qr)], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <section className="et-block" aria-label="Arrival pass">
      <h4 className="et-h">Arrival pass</h4>
      <div className="et-actions">
        <button type="button" className="rf-btn" onClick={openToPrint}>Open pass to print</button>
        <button type="button" className="rf-btn" onClick={() => { const { pass, qr } = build(); downloadOfflineWalletPass(pass, qr); }}>Download pass</button>
      </div>
    </section>
  );
}

function WaitlistBlock({ competitionId, signup, onChanged }: { competitionId: number; signup: SectionSignup; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offer = waitlistOfferState(signup.waitlistOfferExpiresAt);
  const open = hasActiveWaitlistOffer(signup);
  const hasEmail = Boolean(signup.contactEmail?.trim());
  async function send() {
    const ok = await confirmDialog({
      title: open ? `Send ${signup.fullName} a new offer?` : `Offer ${signup.fullName} a place?`,
      message: hasEmail
        ? 'We email 1 person. They get 6 hours to accept if the event is within 72 hours, otherwise 24 hours. If the section has no space, the offer is refused.'
        : 'There is no email on this entry, so nothing is sent. The offer still starts, so tell them yourself.',
      confirmLabel: 'Send offer',
    });
    if (!ok) return;
    setBusy(true); setError(null);
    try { await offerWaitlistSpot(competitionId, signup.id); await onChanged(); }
    catch (caught) { setError(apiErrorMessage(caught, 'Couldn’t send the offer. Check your signal and try again.')); }
    finally { setBusy(false); }
  }
  return (
    <section className="et-block" aria-label="Waiting list offer">
      <h4 className="et-h">Waiting list</h4>
      <p className="rf-t2">{offer.state === 'none' ? 'No offer made yet.' : offer.text}</p>
      {error && <Notice>{error}</Notice>}
      <div className="et-actions">
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void send()}>{open ? 'Send a new offer' : offer.state === 'expired' ? 'Offer again' : 'Offer a place'}</button>
      </div>
    </section>
  );
}

function DispositionBlock({ competitionId, signup, onChanged }: { competitionId: number; signup: SectionSignup; onChanged: () => Promise<void> | void }) {
  const [value, setValue] = useState<FeeDisposition>(signup.feeDisposition ?? (signup.refundPending ? 'RefundPending' : 'None'));
  const [amount, setAmount] = useState(signup.refundedAmountMinor != null ? minorToPounds(signup.refundedAmountMinor) : '');
  const [note, setNote] = useState(signup.dispositionNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const hint = FEE_DISPOSITION_OPTIONS.find((o) => o.value === value)?.hint;

  async function save() {
    setError(null); setSaved(false);
    let minor: number | null = null;
    if (value === 'Refunded' && amount.trim()) {
      minor = poundsToMinor(amount);
      if (minor === null) { setError('Enter the refund as pounds, like 12.50.'); return; }
      if (minor > signup.amountMinor) { setError(`The refund can’t be more than the fee of ${feeText(signup.amountMinor)}.`); return; }
    }
    if (value === 'Refunded') {
      const ok = await confirmDialog({
        title: `Record a refund for ${signup.fullName}?`,
        message: `This records ${feeText(minor ?? signup.amountMinor)} as paid back and marks the entry refunded. It doesn’t send any money.`,
        confirmLabel: 'Record refund',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await saveSignupDisposition(competitionId, signup.id, value, value === 'Refunded' ? minor : null, note);
      setSaved(true);
      await onChanged();
    } catch (caught) { setError(apiErrorMessage(caught, 'Couldn’t save the fee decision. Check your signal and try again.')); }
    finally { setBusy(false); }
  }

  return (
    <section className="et-block" aria-label="Fee after withdrawal">
      <h4 className="et-h">Fee after withdrawal</h4>
      <p className="rf-t2">Fee {feeText(signup.amountMinor)} · now: {dispositionLabel(signup.feeDisposition)}</p>
      <label className="rf-fld">What happens to the fee
        <select value={value} onChange={(e) => { setValue(e.target.value as FeeDisposition); setSaved(false); }}>
          {FEE_DISPOSITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {hint && <p className="rf-note">{hint}</p>}
      {value === 'Refunded' && (
        <label className="rf-fld">Amount refunded in pounds (blank means the full fee)
          <input inputMode="decimal" value={amount} placeholder={minorToPounds(signup.amountMinor)} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}
      <label className="rf-fld">Note (optional)
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <Notice>{error}</Notice>}
      <div className="et-actions">
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void save()}>Save fee decision</button>
        {saved && <span className="rf-t2" role="status">Saved</span>}
      </div>
    </section>
  );
}
