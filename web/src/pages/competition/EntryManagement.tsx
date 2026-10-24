import { useState } from 'react';
import { api } from '../../api';
import { priceLabel } from '../../lib/money';
import type { CompetitionDetail, SectionSignup } from '../../types';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function saveDate() {
    setBusy(true); setError(null); setNotice(null);
    const value = draft ?? localDateInput(entriesCloseAt);
    try {
      await api.put(`/competitions/${competition.id}/entry-settings`, { entriesCloseAt: value ? new Date(value).toISOString() : null });
      window.dispatchEvent(new Event('mg:entry-settings'));
      setNotice('Entry closing date saved.'); onChanged?.();
    } catch { setError('Could not save the closing date. Check it and try again.'); }
    finally { setBusy(false); }
  }
  const bookings = signups.filter((s) => (s.stablesCount ?? 0) > 0 && s.status < 2 && !s.isWithdrawn && !s.isWaitlist);
  return <section aria-label="Manage entries" className="mg-card flex flex-col gap-3 p-3">
    <h3 className="mg-h2">Manage entries</h3>
    <label className="rf-fld">Entry closing date and time<input type="datetime-local" value={draft ?? localDateInput(entriesCloseAt)} onChange={(e) => setDraft(e.target.value)} /></label>
    <p className="rf-note !p-0">Leave blank to keep entries open until you close them. Times use your device’s time zone.</p>
    <button type="button" disabled={busy} onClick={() => void saveDate()} className="mg-btn mg-btn-secondary">Save closing date</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <details><summary className="min-h-11 cursor-pointer font-semibold">Stabling list · {bookings.reduce((sum, s) => sum + (s.stablesCount ?? 0), 0)} stables</summary>
      {bookings.length === 0 ? <p>No stables booked yet.</p> : <ul>{bookings.map((s) => <li key={s.id}>{s.fullName} · {s.stablingClubOrTeam || s.ponyClubName || s.teamName || 'Unaffiliated'} · {s.stablesCount} {s.stablesCount === 1 ? 'stable' : 'stables'}</li>)}</ul>}
    </details>
    <details><summary className="min-h-11 cursor-pointer font-semibold">Entries · {signups.length}</summary>
      <ul className="divide-y divide-[rgb(var(--mg-rule-soft))]">{signups.map((s) => <ManagedSignup key={s.id} signup={s} competition={competition} onChanged={onChanged} />)}</ul>
    </details>
  </section>;
}

function ManagedSignup({ signup: s, competition, onChanged }: { signup: ExtendedSectionSignup; competition: CompetitionDetail; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function update(paid: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (paid) await api.post(`/competitions/${competition.id}/signups/${s.id}/mark-paid`, {});
      else await api.put(`/signups/${s.id}/status`, { status: 2 });
      onChanged?.();
    } catch (e) {
      const message = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(message || 'Could not update this entry. Try again.');
    } finally { setBusy(false); }
  }
  const label = s.status === 2 ? 'Refunded' : s.refundPending ? 'Withdrawn — refund pending' : s.isWithdrawn ? 'Withdrawn' : s.isWaitlist ? 'Waiting list' : ['Awaiting payment', 'Paid', 'Refunded', 'Cancelled'][s.status];
  return <li className="flex flex-col gap-2 py-2">
    <span className="font-semibold">{s.fullName}{(s.teamsCount ?? 1) > 1 && ` (${s.teamsCount} teams)`}</span>
    <span>{s.sectionName} · {label} · {priceLabel(s.amountMinor)}</span>
    {!competition.isDemo && s.status === 0 && !s.isWithdrawn && <button type="button" disabled={busy} onClick={() => void update(true)} className="mg-btn mg-btn-secondary">Mark {s.fullName} as Paid</button>}
    {!competition.isDemo && s.status !== 2 && (s.status === 1 || s.refundPending) && <button type="button" disabled={busy} onClick={() => void update(false)} className="mg-btn mg-btn-secondary">Mark {s.fullName} refunded</button>}
    {error && <p role="alert">{error}</p>}
  </li>;
}
