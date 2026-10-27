import { useMemo, useState, type ChangeEvent } from 'react';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { feeText } from '../../lib/entryOptions';
import { formatClubInvoiceSummary, groupClubInvoices, unpaidReminderCandidates } from '../../lib/entryWorkflows';
import {
  matchBankStatementLines, parseBankStatementCsv, type BankStatementMatchRow, type TreasurerOrderRow,
} from '../../lib/treasurerCsv';
import { whatsAppUrl } from '../../lib/whatsapp';
import type { CompetitionDetail, SectionSignup, SendUnpaidRemindersResult } from '../../types';
import { RefineList, RefineSheet } from '../refine/Refine';
import {
  fetchShopOrders, markClubPaid, markOrderPaid, markSignupPaid, reminderHoursLeft, sendUnpaidReminders,
} from './entryLogic';
import './entryTools.css';

interface SheetProps {
  competition: CompetitionDetail;
  signups: SectionSignup[];
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Remind unpaid: every pending entry with the amount, a ticked box where we hold an email, and a one-day cooldown. */
export function RemindUnpaidSheet({ competition, signups, onChanged, onClose }: SheetProps) {
  const candidates = useMemo(() => unpaidReminderCandidates(competition.id, signups), [competition.id, signups]);
  const now = useMemo(() => new Date(), []);
  const rows = candidates.map((c) => ({ ...c, wait: reminderHoursLeft(c.signup.lastReminderSentAt, now) }));
  const sendable = (r: (typeof rows)[number]) => r.hasEmail && r.wait === 0;
  const [picked, setPicked] = useState<Set<number>>(() => new Set(rows.filter(sendable).map((r) => r.signup.id)));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendUnpaidRemindersResult | null>(null);
  const chosen = rows.filter((r) => picked.has(r.signup.id) && sendable(r));
  const owed = chosen.reduce((sum, r) => sum + r.signup.amountMinor, 0);

  const toggle = (id: number) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function send() {
    if (chosen.length === 0) return;
    const ok = await confirmDialog({
      title: `Email ${plural(chosen.length, 'reminder')}?`,
      message: `${plural(chosen.length, 'person', 'people')} will get an email with the amount still owed (${feeText(owed)} in all) and their payment reference. Emails can’t be taken back.`,
      confirmLabel: `Send ${plural(chosen.length, 'reminder')}`,
    });
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      setResult(await sendUnpaidReminders(competition.id, chosen.map((r) => r.signup.id), note));
      await onChanged();
    } catch (caught) { setError(apiErrorMessage(caught, 'Couldn’t send the reminders. Check your signal and try again.')); }
    finally { setBusy(false); }
  }

  return (
    <RefineSheet title="Remind unpaid" onClose={onClose}>
      <div className="et-sheet">
        {error && <Notice>{error}</Notice>}
        {result && (
          <Notice role="status">
            Sent {result.sentCount}{result.failedCount > 0 ? `, ${result.failedCount} failed` : ''}{result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : ''}.
          </Notice>
        )}
        {rows.length === 0 ? <p className="rf-note">Nobody owes anything.</p> : (
          <>
            <p className="rf-note">Each person can be reminded once a day. Entries with no email on file can’t be emailed.</p>
            <RefineList as="div" label="Unpaid entries">
              {rows.map((r) => (
                <label key={r.signup.id} className={`rf-row et-pick ${sendable(r) ? '' : 'et-off'}`}>
                  <input type="checkbox" checked={picked.has(r.signup.id) && sendable(r)} disabled={!sendable(r) || busy} onChange={() => toggle(r.signup.id)} aria-label={`Remind ${r.signup.fullName}`} />
                  <span className="rf-grow">
                    <span className="rf-t1">{r.signup.fullName}</span>
                    <span className="rf-t2">{feeText(r.signup.amountMinor)} · {r.paymentReference}</span>
                    {!r.hasEmail && <span className="rf-t2">No email on file</span>}
                    {r.hasEmail && r.wait > 0 && <span className="rf-t2">Reminded recently. Next in about {r.wait}h</span>}
                  </span>
                </label>
              ))}
            </RefineList>
            <label className="rf-fld">Message to add (optional)
              <textarea rows={2} maxLength={500} value={note} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)} />
            </label>
            <div className="et-actions">
              <button type="button" className="rf-btn rf-btn-primary" disabled={busy || chosen.length === 0} onClick={() => void send()}>
                {chosen.length === 0 ? 'Pick who to remind' : `Send ${plural(chosen.length, 'reminder')}`}
              </button>
            </div>
          </>
        )}
      </div>
    </RefineSheet>
  );
}

/** Club invoices: clubs with two or more entries, one total and bank reference each; marking a club paid emails a receipt. */
export function ClubInvoicesSheet({ competition, signups, onChanged, onClose }: SheetProps) {
  const groups = useMemo(() => groupClubInvoices(competition.id, signups), [competition.id, signups]);
  const [receipt, setReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const textFor = (g: (typeof groups)[number]) => formatClubInvoiceSummary(competition.name, g, competition.paymentDestination);

  async function copy(g: (typeof groups)[number]) {
    try { await navigator.clipboard.writeText(textFor(g)); setNote(`Copied the invoice for ${g.clubName}.`); setError(null); }
    catch { setError('Couldn’t copy the invoice.'); }
  }

  async function pay(g: (typeof groups)[number]) {
    const pending = g.signups.filter((s) => s.status === 0);
    if (pending.length === 0) return;
    const emails = new Set(pending.map((s) => s.contactEmail?.trim().toLowerCase()).filter(Boolean));
    const ok = await confirmDialog({
      title: `Mark ${g.clubName} paid?`,
      message: `${plural(pending.length, 'entry', 'entries')} totalling ${feeText(g.totalDueMinor)} will be marked paid and their teams formed.${receipt ? ` ${plural(emails.size, 'email address', 'email addresses')} will get a receipt.` : ' No receipt is emailed.'}`,
      confirmLabel: 'Mark paid',
    });
    if (!ok) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const done = await markClubPaid(competition.id, g.clubName, pending.map((s) => s.id), receipt);
      setNote(`${g.clubName}: ${plural(done.markedPaidCount, 'entry', 'entries')} marked paid, ${feeText(done.totalAmountMinor)}.`);
      await onChanged();
    } catch (caught) { setError(apiErrorMessage(caught, 'Couldn’t mark the club paid. Check your signal and try again.')); }
    finally { setBusy(false); }
  }

  return (
    <RefineSheet title="Club invoices" onClose={onClose}>
      <div className="et-sheet">
        {error && <Notice>{error}</Notice>}
        {note && <Notice role="status">{note}</Notice>}
        {groups.length === 0 ? <p className="rf-note">No club has two or more live entries yet.</p> : (
          <>
            <label className="et-check"><input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} /> Email a receipt when a club is marked paid</label>
            {groups.map((g) => (
              <section key={g.clubSlug} className="et-card" aria-label={g.clubName}>
                <h4 className="et-h">{g.clubName}</h4>
                <p className="rf-t2">{plural(g.signupsCount, 'entry', 'entries')} · {plural(g.teamsCount, 'team')} · {plural(g.stablesCount, 'stable')}</p>
                <p className="rf-t1">Total {feeText(g.totalAmountMinor)} · Due {feeText(g.totalDueMinor)} · Paid {feeText(g.totalPaidMinor)}</p>
                <p className="rf-t2">Bank reference {g.clubBacsReference}</p>
                <div className="et-actions">
                  <button type="button" className="rf-btn" onClick={() => void copy(g)}>Copy invoice</button>
                  <a className="rf-btn et-link" href={whatsAppUrl(textFor(g))} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
                  <button type="button" className="rf-btn rf-btn-primary" disabled={busy || g.totalDueMinor <= 0} onClick={() => void pay(g)}>
                    {g.totalDueMinor > 0 ? `Mark ${g.clubName} paid` : 'Already paid'}
                  </button>
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </RefineSheet>
  );
}

/** Match a bank statement: upload a CSV, review each line against pending entries and orders, tick the ones to mark paid. */
export function BacsMatchSheet({ competition, signups, onChanged, onClose }: SheetProps) {
  const [rows, setRows] = useState<BankStatementMatchRow[] | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [orders, setOrders] = useState<TreasurerOrderRow[]>([]);

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const lines = parseBankStatementCsv(await file.text());
      if (lines.length === 0) { setRows(null); setError('We couldn’t find any payments in that file. It needs a reference column and an amount paid in.'); return; }
      let shop: TreasurerOrderRow[] = [];
      try { shop = await fetchShopOrders(competition.id); } catch { setNote('Shop orders couldn’t be loaded, so only entries are matched.'); }
      setOrders(shop);
      setRows(matchBankStatementLines(lines, signups, shop, competition.teams));
      setTicked(new Set());
    } catch (caught) { setError(apiErrorMessage(caught, 'Couldn’t read that file.')); }
    finally { setBusy(false); }
  }

  // Only a payment of exactly what is owed can be marked paid from here. A different amount (part payment, a
  // family paying two entries at once) needs a person to look at the entry, so those lines are listed but not tickable.
  const selectable = (r: BankStatementMatchRow) => r.status === 'matched' && r.targetId != null;
  const chosen = (rows ?? []).filter((r) => ticked.has(r.lineNumber) && selectable(r));
  const total = chosen.reduce((sum, r) => sum + (r.expectedAmountMinor ?? 0), 0);
  const toggle = (n: number) => setTicked((prev) => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  const tickExact = () => setTicked(new Set((rows ?? []).filter((r) => r.status === 'matched').map((r) => r.lineNumber)));

  async function confirmPaid() {
    const entries = chosen.filter((r) => r.targetKind === 'signup');
    const shop = chosen.filter((r) => r.targetKind === 'order');
    const parts = [entries.length > 0 ? plural(entries.length, 'entry', 'entries') : '', shop.length > 0 ? plural(shop.length, 'shop order') : ''].filter(Boolean).join(' and ');
    const ok = await confirmDialog({
      title: `Mark ${parts} paid?`,
      message: `${feeText(total)} will be recorded as received. Paid entries may form teams and send confirmations.`,
      confirmLabel: 'Mark paid',
    });
    if (!ok) return;
    setBusy(true); setError(null); setNote(null);
    const failed: number[] = [];
    let done = 0;
    for (const r of chosen) {
      try {
        if (r.targetKind === 'order') await markOrderPaid(r.targetId as number);
        else await markSignupPaid(competition.id, r.targetId as number);
        done += 1;
      } catch { failed.push(r.lineNumber); }
    }
    setBusy(false);
    setNote(`${plural(done, 'payment')} marked paid.${failed.length > 0 ? ` ${failed.length} failed (statement line ${failed.join(', ')}). Check them and try again.` : ''}`);
    setRows((prev) => (prev ?? []).filter((r) => !chosen.some((c) => c.lineNumber === r.lineNumber) || failed.includes(r.lineNumber)));
    setTicked(new Set(failed));
    await onChanged();
    if (orders.length > 0) setOrders(await fetchShopOrders(competition.id).catch(() => orders));
  }

  const label = (r: BankStatementMatchRow) => r.status === 'matched' ? 'Matches' : r.status === 'amount_mismatch' ? 'Amount differs' : 'No match';

  return (
    <RefineSheet title="Match a bank statement" onClose={onClose}>
      <div className="et-sheet">
        {error && <Notice>{error}</Notice>}
        {note && <Notice role="status">{note}</Notice>}
        <p className="rf-note">Choose a CSV from your bank. Nothing is marked paid until you tick lines and confirm. The file is read on this device and not uploaded.</p>
        <label className="rf-fld">Bank statement (CSV)
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void pickFile(e)} />
        </label>
        {rows && rows.length === 0 && <p className="rf-note">Nothing left to review.</p>}
        {rows && rows.length > 0 && (
          <>
            <div className="et-actions">
              <button type="button" className="rf-btn" onClick={tickExact}>Tick exact matches</button>
              <button type="button" className="rf-btn" onClick={() => setTicked(new Set())}>Clear ticks</button>
            </div>
            <RefineList as="div" label="Statement lines">
              {rows.map((r) => (
                <label key={r.lineNumber} className={`rf-row et-pick ${selectable(r) ? '' : 'et-off'}`}>
                  <input type="checkbox" checked={ticked.has(r.lineNumber) && selectable(r)} disabled={!selectable(r) || busy} onChange={() => toggle(r.lineNumber)}
                    aria-label={`Mark paid for line ${r.lineNumber}: ${r.reference}`} />
                  <span className="rf-grow">
                    <span className="rf-t1">{r.reference}</span>
                    <span className="rf-t2">{r.date} · received {feeText(r.amountMinor)}</span>
                    {r.matchedLabel && <span className="rf-t2">{r.matchedLabel}{r.expectedAmountMinor != null ? ` · owed ${feeText(r.expectedAmountMinor)}` : ''}</span>}
                    {r.status === 'amount_mismatch' && <span className="rf-t2">Check this one on the entry and mark it paid there if it’s right.</span>}
                  </span>
                  <span className={`rf-st ${r.status === 'matched' ? 'rf-ok' : r.status === 'amount_mismatch' ? 'rf-warn' : 'rf-mut'}`}>{label(r)}</span>
                </label>
              ))}
            </RefineList>
            <div className="et-actions">
              <button type="button" className="rf-btn rf-btn-primary" disabled={busy || chosen.length === 0} onClick={() => void confirmPaid()}>
                {chosen.length === 0 ? 'Tick lines to mark paid' : `Mark ${plural(chosen.length, 'line')} paid · ${feeText(total)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </RefineSheet>
  );
}
