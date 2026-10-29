import { Upload } from 'lucide-react';
import { useT } from '../../i18n/LanguageContext';
import { useMemo, useState, type ChangeEvent } from 'react';
import { tr } from '../../i18n/translate';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { feeText } from '../../lib/entryOptions';
import { formatClubInvoiceSummary, groupClubInvoices, unpaidReminderCandidates } from '../../lib/entryWorkflows';
import {
  matchBankStatementLines, parseBankStatementCsv, type BankStatementMatchRow, type TreasurerOrderRow,
} from '../../lib/treasurerCsv';
import { whatsAppUrl } from '../../lib/whatsapp';
import type { MessageKey } from '../../i18n/en/index';
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

const plural = (n: number, key: MessageKey) => tr(key, { count: n });

/** Remind unpaid: every pending entry with the amount, a ticked box where we hold an email, and a one-day cooldown. */
export function RemindUnpaidSheet({ competition, signups, onChanged, onClose }: SheetProps) {
  const t = useT();
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
      title: t('ops2.money.emailQ', { what: plural(chosen.length, 'ops2.money.n.reminder') }),
      message: t('ops2.money.emailMsg', { who: plural(chosen.length, 'ops2.money.n.person'), fee: feeText(owed) }),
      confirmLabel: t('ops2.money.sendWhat', { what: plural(chosen.length, 'ops2.money.n.reminder') }),
    });
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      setResult(await sendUnpaidReminders(competition.id, chosen.map((r) => r.signup.id), note));
      await onChanged();
    } catch (caught) { setError(apiErrorMessage(caught, t('ops2.money.sendError'))); }
    finally { setBusy(false); }
  }

  return (
    <RefineSheet title={t('ops2.tools.remind')} onClose={onClose}>
      <div className="et-sheet">
        {error && <Notice>{error}</Notice>}
        {result && (
          <Notice role="status">
            {t('ops2.money.sent', { sent: result.sentCount })}{result.failedCount > 0 ? t('ops2.money.failed', { n: result.failedCount }) : ''}{result.skippedCount > 0 ? t('ops2.money.skipped', { n: result.skippedCount }) : ''}.
          </Notice>
        )}
        {rows.length === 0 ? <p className="rf-note">{t('ops2.money.nobodyOwes')}</p> : (
          <>
            <p className="rf-note">{t('ops2.money.onceADay')}</p>
            <RefineList as="div" label={t('ops2.money.unpaid')}>
              {rows.map((r) => (
                <label key={r.signup.id} className={`rf-row et-pick ${sendable(r) ? '' : 'et-off'}`}>
                  <input type="checkbox" checked={picked.has(r.signup.id) && sendable(r)} disabled={!sendable(r) || busy} onChange={() => toggle(r.signup.id)} aria-label={t('ops2.money.remind', { name: r.signup.fullName })} />
                  <span className="rf-grow">
                    <span className="rf-t1">{r.signup.fullName}</span>
                    <span className="rf-t2">{feeText(r.signup.amountMinor)} · {r.paymentReference}</span>
                    {!r.hasEmail && <span className="rf-t2">{t('ops2.money.noEmail')}</span>}
                    {r.hasEmail && r.wait > 0 && <span className="rf-t2">{t('ops2.money.recent', { h: r.wait })}</span>}
                  </span>
                </label>
              ))}
            </RefineList>
            <label className="rf-fld">{t('ops2.money.addMsg')}
              <textarea rows={2} maxLength={500} value={note} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)} />
            </label>
            {busy && <div className="et-progress" role="progressbar" aria-label={t('ops2.money.sending', { what: plural(chosen.length, 'ops2.money.n.reminder') })} />}
            <div className="et-actions">
              <button type="button" className="rf-btn rf-btn-primary" disabled={busy || chosen.length === 0} onClick={() => void send()}>
                {busy ? t('ops2.money.sending', { what: plural(chosen.length, 'ops2.money.n.reminder') })
                  : chosen.length === 0 ? t('ops2.money.pick') : t('ops2.money.sendWhat', { what: plural(chosen.length, 'ops2.money.n.reminder') })}
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
  const t = useT();
  const groups = useMemo(() => groupClubInvoices(competition.id, signups), [competition.id, signups]);
  const [receipt, setReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const textFor = (g: (typeof groups)[number]) => formatClubInvoiceSummary(competition.name, g, competition.paymentDestination);

  async function copy(g: (typeof groups)[number]) {
    try { await navigator.clipboard.writeText(textFor(g)); setNote(t('ops2.money.copiedInv', { club: g.clubName })); setError(null); }
    catch { setError(t('ops2.money.copyInvError')); }
  }

  async function pay(g: (typeof groups)[number]) {
    const pending = g.signups.filter((s) => s.status === 0);
    if (pending.length === 0) return;
    const emails = new Set(pending.map((s) => s.contactEmail?.trim().toLowerCase()).filter(Boolean));
    const ok = await confirmDialog({
      title: t('ops2.entries.markPaidQ', { name: g.clubName }),
      message: t('ops2.money.clubMsg', { what: plural(pending.length, 'ops2.money.n.entry'), fee: feeText(g.totalDueMinor) }) + (receipt ? ` ${t('ops2.money.receiptTo', { what: plural(emails.size, 'ops2.money.n.email') })}` : ` ${t('ops2.money.noReceipt')}`),
      confirmLabel: competition.isDemo ? t('ops3.plan.demo.markPaid') : t('ops2.entries.markPaid'),
    });
    if (!ok) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const done = await markClubPaid(competition.id, g.clubName, pending.map((s) => s.id), receipt);
      setNote(t('ops2.money.clubDone', { club: g.clubName, what: plural(done.markedPaidCount, 'ops2.money.n.entry'), fee: feeText(done.totalAmountMinor) }));
      await onChanged();
    } catch (caught) { setError(apiErrorMessage(caught, t('ops2.money.clubError'))); }
    finally { setBusy(false); }
  }

  return (
    <RefineSheet title={t('ops2.tools.clubs')} onClose={onClose}>
      <div className="et-sheet">
        {error && <Notice>{error}</Notice>}
        {note && <Notice role="status">{note}</Notice>}
        {groups.length === 0 ? <p className="rf-note">{t('ops2.money.noClub')}</p> : (
          <>
            <label className="et-check"><input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} /> {t('ops2.money.emailReceipt')}</label>
            {groups.map((g) => (
              <section key={g.clubSlug} className="et-card" aria-label={g.clubName}>
                <h4 className="et-h">{g.clubName}</h4>
                <p className="rf-t2">{plural(g.signupsCount, 'ops2.money.n.entry')} · {plural(g.teamsCount, 'ops2.money.n.team')} · {plural(g.stablesCount, 'ops2.money.n.stable')}</p>
                <p className="rf-t1">{t('ops2.money.totals', { total: feeText(g.totalAmountMinor), due: feeText(g.totalDueMinor), paid: feeText(g.totalPaidMinor) })}</p>
                {!competition.isDemo && <p className="rf-t2">{t('ops2.money.bankRef', { ref: g.clubBacsReference })}</p>}
                <div className="et-actions">
                  <button type="button" className="rf-btn" onClick={() => void copy(g)}>{t('ops2.money.copyInv')}</button>
                  <a className="rf-btn et-link" href={whatsAppUrl(textFor(g))} target="_blank" rel="noopener noreferrer">{t('ops2.money.whatsapp')}</a>
                  <button type="button" className="rf-btn rf-btn-primary" disabled={busy || g.totalDueMinor <= 0} onClick={() => void pay(g)}>
                    {g.totalDueMinor > 0 ? t(competition.isDemo ? 'ops3.plan.demo.markClubPaid' : 'ops2.entries.markPaidAria', { name: g.clubName }) : t('ops2.money.alreadyPaid')}
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
  const t = useT();
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
      if (lines.length === 0) { setRows(null); setError(t('ops2.money.noPayments')); return; }
      let shop: TreasurerOrderRow[] = [];
      try { shop = await fetchShopOrders(competition.id); } catch { setNote(t('ops2.money.ordersFail')); }
      setOrders(shop);
      setRows(matchBankStatementLines(lines, signups, shop, competition.teams));
      setTicked(new Set());
    } catch (caught) { setError(apiErrorMessage(caught, t('ops2.money.readError'))); }
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
    const parts = [entries.length > 0 ? plural(entries.length, 'ops2.money.n.entry') : '', shop.length > 0 ? plural(shop.length, 'ops2.money.n.order') : ''].filter(Boolean).join(t('ops2.money.and'));
    const ok = await confirmDialog({
      title: t('ops2.entries.markPaidQ', { name: parts }),
      message: t('ops2.money.recordedMsg', { fee: feeText(total) }),
      confirmLabel: t('ops2.entries.markPaid'),
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
    setNote(`${t('ops2.money.markedPaid', { what: plural(done, 'ops2.money.n.payment') })}${failed.length > 0 ? ` ${t('ops2.money.someFailed', { n: failed.length, lines: failed.join(', ') })}` : ''}`);
    setRows((prev) => (prev ?? []).filter((r) => !chosen.some((c) => c.lineNumber === r.lineNumber) || failed.includes(r.lineNumber)));
    setTicked(new Set(failed));
    await onChanged();
    if (orders.length > 0) setOrders(await fetchShopOrders(competition.id).catch(() => orders));
  }

  const label = (r: BankStatementMatchRow) => r.status === 'matched' ? t('ops2.money.matches') : r.status === 'amount_mismatch' ? t('ops2.money.differs') : t('ops2.money.noMatch');

  return (
    <RefineSheet title={t('ops2.tools.bacs')} onClose={onClose}>
      <div className="et-sheet">
        {error && <Notice>{error}</Notice>}
        {note && <Notice role="status">{note}</Notice>}
        <p className="rf-note">{t('ops2.money.chooseCsv')}</p>
        <label className="rf-btn et-file">
          <Upload className="h-4 w-4" aria-hidden="true" />{t('ops2.money.statement')}
          <input type="file" className="sr-only" accept=".csv,text/csv" disabled={busy} onChange={(e) => void pickFile(e)} />
        </label>
        {rows && rows.length === 0 && <p className="rf-note">{t('ops2.money.nothingLeft')}</p>}
        {rows && rows.length > 0 && (
          <>
            <div className="et-actions">
              <button type="button" className="rf-btn" onClick={tickExact}>{t('ops2.money.tickExact')}</button>
              <button type="button" className="rf-btn" onClick={() => setTicked(new Set())}>{t('ops2.money.clearTicks')}</button>
            </div>
            <RefineList as="div" label={t('ops2.money.lines')}>
              {rows.map((r) => (
                <label key={r.lineNumber} className={`rf-row et-pick ${selectable(r) ? '' : 'et-off'}`}>
                  <input type="checkbox" checked={ticked.has(r.lineNumber) && selectable(r)} disabled={!selectable(r) || busy} onChange={() => toggle(r.lineNumber)}
                    aria-label={t('ops2.money.lineAria', { n: r.lineNumber, ref: r.reference })} />
                  <span className="rf-grow">
                    <span className="rf-t1">{r.reference}</span>
                    <span className="rf-t2">{t('ops2.money.received', { date: r.date, fee: feeText(r.amountMinor) })}</span>
                    {r.matchedLabel && <span className="rf-t2">{r.matchedLabel}{r.expectedAmountMinor != null ? ` · ${t('ops2.money.owed', { fee: feeText(r.expectedAmountMinor) })}` : ''}</span>}
                    {r.status === 'amount_mismatch' && <span className="rf-t2">{t('ops2.money.checkOne')}</span>}
                  </span>
                  <span className={`rf-st ${r.status === 'matched' ? 'rf-ok' : r.status === 'amount_mismatch' ? 'rf-warn' : 'rf-mut'}`}>{label(r)}</span>
                </label>
              ))}
            </RefineList>
            <div className="et-actions">
              <button type="button" className="rf-btn rf-btn-primary" disabled={busy || chosen.length === 0} onClick={() => void confirmPaid()}>
                {chosen.length === 0 ? t('ops2.money.tickLines') : t('ops2.money.markLines', { what: plural(chosen.length, 'ops2.money.n.line'), fee: feeText(total) })}
              </button>
            </div>
          </>
        )}
      </div>
    </RefineSheet>
  );
}
