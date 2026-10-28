import { useId, useRef, useState, type ReactNode } from 'react';
import { ChangePop } from '../../components/ChangePop';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { priceLabel } from '../../lib/money';
import { paidWord } from '../../lib/paidWord';
import type { CompetitionDetail, SectionSignup } from '../../types';
import { clubLabel } from '../../lib/clubName';
import { Chevron } from '../refine/Refine';
import '../../components/sitePages.css';

export interface ExtendedSectionSignup extends SectionSignup {
  waitingForGuestSpot?: boolean;
  stablesCount?: number;
  stablingClubOrTeam?: string | null;
  paymentMethod?: string | null;
  isWaitlist?: boolean;
  isWithdrawn?: boolean;
  refundPending?: boolean;
  teamsCount?: number;
}

function localDateInput(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function EntryManagement({ competition, signups, entriesCloseAt, onChanged }: {
  competition: CompetitionDetail; signups: ExtendedSectionSignup[]; entriesCloseAt: string | null; onChanged?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  async function saveDate() {
    setBusy(true); setError(null);
    const value = draft ?? localDateInput(entriesCloseAt);
    try {
      await api.put(`/competitions/${competition.id}/entry-settings`, { entriesCloseAt: value ? new Date(value).toISOString() : null });
      window.dispatchEvent(new Event('mg:entry-settings'));
      toast.show('Entry closing date saved'); onChanged?.();
    } catch { setError('Couldn’t save the closing date. Check it and your signal, then try again.'); }
    finally { setBusy(false); }
  }
  const bookings = signups.filter((s) => (s.stablesCount ?? 0) > 0 && s.status < 2 && !s.isWithdrawn && !s.isWaitlist);
  return <section aria-label="Manage entries" className="mg-card flex flex-col gap-3 p-3">
    <h3 className="mg-h2">Manage entries</h3>
    <label className="rf-fld">Entry closing date and time<input type="datetime-local" value={draft ?? localDateInput(entriesCloseAt)} onChange={(e) => setDraft(e.target.value)} /></label>
    <p className="rf-note !p-0">Leave blank to keep entries open until you close them. Times use your device’s time zone.</p>
    <button type="button" disabled={busy} onClick={() => void saveDate()} className="mg-btn mg-btn-secondary">Save closing date</button>
    {error && <Notice actionLabel="Try again" onAction={() => void saveDate()} actionDisabled={busy}>{error}</Notice>}{toast.node}
    <div className="sp-card">
      <Disclosure title={`Stabling list · ${bookings.reduce((sum, s) => sum + (s.stablesCount ?? 0), 0)} stables`}>
        {bookings.length === 0 ? <p className="sp-note">No stables booked yet.</p> : <ul className="m-0 list-none px-4 pb-3">{bookings.map((s) => <li key={s.id}>{[s.fullName, clubLabel(s.stablingClubOrTeam) || clubLabel(s.ponyClubName) || clubLabel(s.teamName), `${s.stablesCount} ${s.stablesCount === 1 ? 'stable' : 'stables'}`].filter(Boolean).join(' · ')}</li>)}</ul>}
      </Disclosure>
      <Disclosure title={`Entries · ${signups.length}`}>
        {signups.length === 0 ? <p className="sp-note">No entries yet.</p> : <ul className="m-0 list-none divide-y divide-[rgb(var(--mg-rule-soft))] px-4">{signups.map((s) => <ManagedSignup key={s.id} signup={s} competition={competition} onChanged={onChanged} />)}</ul>}
      </Disclosure>
    </div>
  </section>;
}

/** A house card row that opens and closes the content under it. The row is a button, so it works by keyboard and says whether it is open. */
function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return <div className="sp-disc">
    <button type="button" className="rf-row sp-disc-row" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((value) => !value)}>
      <span className="rf-grow"><span className="rf-t1">{title}</span></span>
      <span className="sp-disc-chev" data-open={open || undefined}><Chevron /></span>
    </button>
    {open && <div id={panel} className="mg-settle">{children}</div>}
  </div>;
}

function ManagedSignup({ signup: s, competition, onChanged }: { signup: ExtendedSectionSignup; competition: CompetitionDetail; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryPaid = useRef(true);
  async function update(paid: boolean) {
    if (busy) return;
    retryPaid.current = paid;
    setBusy(true); setError(null);
    try {
      if (paid) await api.post(`/competitions/${competition.id}/signups/${s.id}/mark-paid`, {});
      else await api.put(`/signups/${s.id}/status`, { status: 2 });
      onChanged?.();
    } catch (e) {
      const message = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(message || 'Couldn’t update this entry. Check your signal and try again.');
    } finally { setBusy(false); }
  }
  const label = s.status === 2 ? 'Refunded' : s.refundPending ? 'Withdrawn (refund due)' : s.isWithdrawn ? 'Withdrawn' : s.isWaitlist ? 'Waiting list' : ['Awaiting payment', paidWord(competition.isDemo), 'Refunded', 'Cancelled'][s.status];
  return <li className="flex flex-col gap-2 py-2">
    <span className="font-semibold">{s.fullName}{(s.teamsCount ?? 1) > 1 && ` (${s.teamsCount} teams)`}</span>
    <span>{s.sectionName} · <ChangePop value={label} tick={s.status === 1}>{label}</ChangePop> · {priceLabel(s.amountMinor)}</span>
    {!competition.isDemo && s.status === 0 && !s.isWithdrawn && <button type="button" disabled={busy} onClick={() => void update(true)} className="mg-btn mg-btn-secondary">Mark {s.fullName} as paid</button>}
    {!competition.isDemo && s.status !== 2 && (s.status === 1 || s.refundPending) && <button type="button" disabled={busy} onClick={() => void update(false)} className="mg-btn mg-btn-secondary">Mark {s.fullName} refunded</button>}
    {error && <Notice actionLabel="Try again" onAction={() => void update(retryPaid.current)} actionDisabled={busy}>{error}</Notice>}
  </li>;
}
