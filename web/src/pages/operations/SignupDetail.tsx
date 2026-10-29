import { useT } from '../../i18n/LanguageContext';
import { useState } from 'react';
import { tr } from '../../i18n/translate';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { feeText } from '../../lib/entryOptions';
import { hasActiveWaitlistOffer } from '../../lib/entryWorkflows';
import { guestContactLines, guestRiderSummary } from '../../lib/guestRider';
import { ArrivalBookings } from '../../components/wallet/ArrivalBookings';
import type { ArrivalWindow, CompetitionDetail, FeeDisposition, SectionSignup } from '../../types';
import {
  ARRIVAL_OPTIONS, FEE_DISPOSITION_OPTIONS, dispositionLabel, minorToPounds, offerWaitlistSpot, poundsToMinor,
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
  const t = useT();
  const bucket = signupBucket(signup);
  const active = bucket === 'paid' || bucket === 'pending';
  const summary = guestRiderSummary(signup.guest);
  const contacts = guestContactLines(signup.guest);
  const booked = (signup.stablesCount ?? 0) > 0 || (signup.hookupsCount ?? 0) > 0 || Boolean(signup.stableAssignment || signup.hookupAssignment);


  return (
    <div className="et-detail">
      {(summary || contacts.length > 0) && (
        <section className="et-block" aria-label={t('ops2.signup.rider')}>
          {summary && <p className="rf-t1">{t('ops2.signup.riderLine', { summary })}</p>}
          {contacts.length > 0 && (
            <div className="et-private">
              <span className="et-private-tag">{t('ops2.signup.staffOnly')}</span>
              {contacts.map((line) => <p key={line} className="rf-t2">{line}</p>)}
            </div>
          )}
        </section>
      )}
      {active && booked && <LegacyStabling signup={signup} />}
      {active && <ArrivalBlock signup={signup} onChanged={onChanged} />}
      <ArrivalBookings competitionId={competition.id} signupId={signup.id} staff />
      {bucket === 'waitlist' && <WaitlistBlock competitionId={competition.id} signup={signup} onChanged={onChanged} />}
      {bucket === 'withdrawn' && <DispositionBlock competitionId={competition.id} signup={signup} onChanged={onChanged} />}
    </div>
  );
}

function LegacyStabling({ signup }: { signup: SectionSignup }) {
  const t = useT();
  return <section className="et-block"><h4 className="et-h">{t('apple.arrival.legacy')}</h4><p className="rf-t2">{t('ops2.signup.booked', { stables: tr('ops2.money.n.stable', { count: signup.stablesCount ?? 0 }), hookups: tr('ops2.signup.n.hookup', { count: signup.hookupsCount ?? 0 }) })}</p><p>{signup.stableAssignment} {signup.hookupAssignment}</p></section>;
}

function ArrivalBlock({ signup, onChanged }: { signup: SectionSignup; onChanged: () => Promise<void> | void }) {
  const t = useT();
  const [window_, setWindow] = useState<ArrivalWindow | ''>(signup.arrivalWindow ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await saveSignupArrival(signup.id, window_ || null, signup.vehicleRegistration ?? null);
      setSaved(true);
      await onChanged();
    } catch (caught) { setError(apiErrorMessage(caught, t('ops2.signup.arrivalError'))); }
    finally { setBusy(false); }
  }
  return (
    <section className="et-block" aria-label={t('ops2.signup.arrival')}>
      <h4 className="et-h">{t('ops2.signup.arrival')}</h4>
      <div className="et-two">
        <label className="rf-fld">{t('ops2.signup.arrives')}
          <select value={window_} onChange={(e) => { setWindow(e.target.value as ArrivalWindow | ''); setSaved(false); }}>
            {ARRIVAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="et-actions">
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void save()}>{t('ops2.signup.saveArrival')}</button>
        {saved && <span className="rf-t2" role="status">{t('ops2.signup.saved')}</span>}
      </div>
    </section>
  );
}

function WaitlistBlock({ competitionId, signup, onChanged }: { competitionId: number; signup: SectionSignup; onChanged: () => Promise<void> | void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offer = waitlistOfferState(signup.waitlistOfferExpiresAt);
  const open = hasActiveWaitlistOffer(signup);
  const hasEmail = Boolean(signup.contactEmail?.trim());
  async function send() {
    const ok = await confirmDialog({
      title: open ? t('ops2.signup.newOfferQ', { name: signup.fullName }) : t('ops2.signup.offerQ', { name: signup.fullName }),
      message: hasEmail
        ? t('ops2.signup.offerEmail')
        : t('ops2.signup.offerNoEmail'),
      confirmLabel: t('ops2.signup.sendOffer'),
    });
    if (!ok) return;
    setBusy(true); setError(null);
    try { await offerWaitlistSpot(competitionId, signup.id); await onChanged(); }
    catch (caught) { setError(apiErrorMessage(caught, t('ops2.signup.offerError'))); }
    finally { setBusy(false); }
  }
  return (
    <section className="et-block" aria-label={t('ops2.signup.offerAria')}>
      <h4 className="et-h">{t('ops2.signup.waitingList')}</h4>
      <p className="rf-t2">{offer.state === 'none' ? t('ops2.signup.noOffer') : offer.text}</p>
      {error && <Notice>{error}</Notice>}
      <div className="et-actions">
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void send()}>{open ? t('ops2.signup.sendNew') : offer.state === 'expired' ? t('ops2.signup.offerAgain') : t('ops2.signup.offerPlace')}</button>
      </div>
    </section>
  );
}

function DispositionBlock({ competitionId, signup, onChanged }: { competitionId: number; signup: SectionSignup; onChanged: () => Promise<void> | void }) {
  const t = useT();
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
      if (minor === null) { setError(t('ops2.signup.poundsError')); return; }
      if (minor > signup.amountMinor) { setError(t('ops2.signup.tooMuch', { fee: feeText(signup.amountMinor) })); return; }
    }
    if (value === 'Refunded') {
      const ok = await confirmDialog({
        title: t('ops2.signup.refundQ', { name: signup.fullName }),
        message: t('ops2.signup.refundMsg', { fee: feeText(minor ?? signup.amountMinor) }),
        confirmLabel: t('ops2.signup.recordRefund'),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await saveSignupDisposition(competitionId, signup.id, value, value === 'Refunded' ? minor : null, note);
      setSaved(true);
      await onChanged();
    } catch (caught) { setError(apiErrorMessage(caught, t('ops2.signup.feeError'))); }
    finally { setBusy(false); }
  }

  return (
    <section className="et-block" aria-label={t('ops2.signup.feeAfter')}>
      <h4 className="et-h">{t('ops2.signup.feeAfter')}</h4>
      <p className="rf-t2">{t('ops2.signup.feeNow', { fee: feeText(signup.amountMinor), state: dispositionLabel(signup.feeDisposition) })}</p>
      <label className="rf-fld">{t('ops2.signup.whatHappens')}
        <select value={value} onChange={(e) => { setValue(e.target.value as FeeDisposition); setSaved(false); }}>
          {FEE_DISPOSITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {hint && <p className="rf-note">{hint}</p>}
      {value === 'Refunded' && (
        <label className="rf-fld">{t('ops2.signup.amountRefunded')}
          <input inputMode="decimal" value={amount} placeholder={minorToPounds(signup.amountMinor)} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}
      <label className="rf-fld">{t('ops2.pd.noteOptional')}
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <Notice>{error}</Notice>}
      <div className="et-actions">
        <button type="button" className="rf-btn" disabled={busy} onClick={() => void save()}>{t('ops2.signup.saveFee')}</button>
        {saved && <span className="rf-t2" role="status">{t('ops2.signup.saved')}</span>}
      </div>
    </section>
  );
}
