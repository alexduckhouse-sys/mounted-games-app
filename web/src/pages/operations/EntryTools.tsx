import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { downloadCsv, safeFilename } from '../../lib/csv';
import { feeText } from '../../lib/entryOptions';
import { arrivalManifestCsv, arrivalWindowLabel, computeFeeDispositionLedger, groupArrivalManifest } from '../../lib/entryWorkflows';
import { displaySectionName } from '../../lib/section';
import { treasurerCsv } from '../../lib/treasurerCsv';
import { whatsAppUrl } from '../../lib/whatsapp';
import type { CompetitionDetail, CompetitionEntrySettings, SectionSignup } from '../../types';
import { RefineList, RefineSheet } from '../refine/Refine';
import { BacsMatchSheet, ClubInvoicesSheet, RemindUnpaidSheet } from './EntryMoneySheets';
import { dispositionLabel, entriesSummaryText, fetchShopOrders } from './entryLogic';
import './entryTools.css';

type Tool = 'bacs' | 'remind' | 'clubs' | 'arrivals' | 'refunds' | 'treasurer' | 'share';

const TOOLS: Array<{ tool: Tool; title: string; hint: string }> = [
  { tool: 'bacs', title: 'Match a bank statement', hint: 'Upload a CSV and tick the payments that match' },
  { tool: 'remind', title: 'Remind unpaid', hint: 'Email people who still owe an entry fee' },
  { tool: 'clubs', title: 'Club invoices', hint: 'One total per club, and mark a whole club paid' },
  { tool: 'arrivals', title: 'Arrival list', hint: 'Who arrives when, with vehicles' },
  { tool: 'refunds', title: 'Refunds and credits', hint: 'What has been kept, refunded or carried over' },
  { tool: 'treasurer', title: 'Treasurer export', hint: 'Entries and shop orders in one CSV' },
  { tool: 'share', title: 'Share entries summary', hint: 'Counts for a group chat, no names' },
];

interface Props {
  competition: CompetitionDetail;
  signups: SectionSignup[];
  capacity: CompetitionEntrySettings | null;
  onChanged: () => Promise<void> | void;
}

/** The organiser's entry tools: one row that opens a menu, then a focused sheet for each job. */
export function EntryTools({ competition, signups, capacity, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const close = () => setTool(null);
  const shared = { competition, signups, onChanged, onClose: close };
  return (
    <>
      <button type="button" className="rf-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>Entry tools</button>
      {open && tool === null && (
        <RefineSheet title="Entry tools" onClose={() => setOpen(false)}>
          <div className="et-sheet">
            <RefineList as="div" label="Entry tools">
              {TOOLS.map((t) => (
                <button key={t.tool} type="button" className="rf-row et-tool" onClick={() => setTool(t.tool)}>
                  <span className="rf-grow"><span className="rf-t1">{t.title}</span><span className="rf-t2">{t.hint}</span></span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ))}
            </RefineList>
          </div>
        </RefineSheet>
      )}
      {open && tool === 'bacs' && <BacsMatchSheet {...shared} />}
      {open && tool === 'remind' && <RemindUnpaidSheet {...shared} />}
      {open && tool === 'clubs' && <ClubInvoicesSheet {...shared} />}
      {open && tool === 'arrivals' && <ArrivalListSheet competition={competition} signups={signups} onClose={close} />}
      {open && tool === 'refunds' && <RefundsSheet signups={signups} onClose={close} />}
      {open && tool === 'treasurer' && <TreasurerSheet competition={competition} signups={signups} onClose={close} />}
      {open && tool === 'share' && <ShareSheet competition={competition} signups={signups} capacity={capacity} onClose={close} />}
    </>
  );
}

type WindowFilter = 'all' | 'fridayEvening' | 'saturdayMorning' | 'other';

function ArrivalListSheet({ competition, signups, onClose }: { competition: CompetitionDetail; signups: SectionSignup[]; onClose: () => void }) {
  const groups = groupArrivalManifest(signups);
  const [filter, setFilter] = useState<WindowFilter>('all');
  const shown = filter === 'all' ? [...groups.fridayEvening, ...groups.saturdayMorning, ...groups.other] : groups[filter];
  const chips: Array<{ value: WindowFilter; label: string; n: number }> = [
    { value: 'all', label: 'All', n: groups.fridayEvening.length + groups.saturdayMorning.length + groups.other.length },
    { value: 'fridayEvening', label: 'Friday evening', n: groups.fridayEvening.length },
    { value: 'saturdayMorning', label: 'Saturday morning', n: groups.saturdayMorning.length },
    { value: 'other', label: 'Other', n: groups.other.length },
  ];
  return (
    <RefineSheet title="Arrival list" onClose={onClose}>
      <div className="et-sheet">
        <div className="ops-chips" role="group" aria-label="Arrival time">
          {chips.map((c) => (
            <button key={c.value} type="button" className="rf-btn et-chip" aria-pressed={filter === c.value} onClick={() => setFilter(c.value)}>{c.label} · {c.n}</button>
          ))}
        </div>
        {shown.length === 0 ? <p className="rf-note">Nobody has booked stables or given an arrival time or vehicle yet.</p> : (
          <RefineList as="div" label="Arrivals">
            {shown.map((s) => (
              <div key={s.id} className="rf-row">
                <span className="rf-grow">
                  <span className="rf-t1">{s.fullName}</span>
                  <span className="rf-t2">{(s.stablingClubOrTeam || s.ponyClubName || s.teamName || 'Unaffiliated').trim()} · {displaySectionName(s.sectionName)}</span>
                  <span className="rf-t2">{arrivalWindowLabel(s.arrivalWindow)} · {s.vehicleRegistration?.trim() || 'No vehicle given'} · {s.stablesCount ?? 0} {(s.stablesCount ?? 0) === 1 ? 'stable' : 'stables'}</span>
                </span>
                <span className={`rf-st ${s.status === 1 ? 'rf-ok' : 'rf-warn'}`}>{s.status === 1 ? 'Paid' : 'Pending payment'}</span>
              </div>
            ))}
          </RefineList>
        )}
        <div className="et-actions">
          <button type="button" className="rf-btn" disabled={shown.length === 0}
            onClick={() => downloadCsv(`${safeFilename(competition.name)}-arrivals.csv`, arrivalManifestCsv(shown))}>Download CSV</button>
        </div>
        <p className="rf-note">The CSV has vehicle registrations. Keep it with the gate team.</p>
      </div>
    </RefineSheet>
  );
}

function RefundsSheet({ signups, onClose }: { signups: SectionSignup[]; onClose: () => void }) {
  const ledger = computeFeeDispositionLedger(signups);
  const totals: Array<[string, number]> = [
    ['Refunded', ledger.totalRefundedMinor],
    ['Refunds still to pay', ledger.refundsPendingMinor],
    ['Fees kept', ledger.totalRetainedMinor],
    ['Credit for next event', ledger.creditsRolledOverMinor],
  ];
  return (
    <RefineSheet title="Refunds and credits" onClose={onClose}>
      <div className="et-sheet">
        <RefineList as="div" label="Totals">
          {totals.map(([label, minor]) => (
            <div key={label} className="rf-row"><span className="rf-grow rf-t1">{label}</span><span className="rf-t1">{feeText(minor)}</span></div>
          ))}
        </RefineList>
        {ledger.rows.length === 0 ? <p className="rf-note">No withdrawn or refunded entries yet.</p> : (
          <RefineList as="div" label="Withdrawn and refunded entries">
            {ledger.rows.map((s) => (
              <div key={s.id} className="rf-row">
                <span className="rf-grow">
                  <span className="rf-t1">{s.fullName}</span>
                  <span className="rf-t2">{displaySectionName(s.sectionName)} · fee {feeText(s.amountMinor)}{s.dispositionNote ? ` · ${s.dispositionNote}` : ''}</span>
                </span>
                <span className="rf-st rf-mut">{dispositionLabel(s.feeDisposition)}</span>
              </div>
            ))}
          </RefineList>
        )}
        <p className="rf-note">Record what happens to a fee from the withdrawn entry itself, under Withdrawn.</p>
      </div>
    </RefineSheet>
  );
}

function TreasurerSheet({ competition, signups, onClose }: { competition: CompetitionDetail; signups: SectionSignup[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true); setError(null);
    try {
      const orders = await fetchShopOrders(competition.id);
      const csv = treasurerCsv({ competitionId: competition.id, competitionName: competition.name, signups, orders, teams: competition.teams });
      downloadCsv(`${safeFilename(competition.name)}-treasurer.csv`, csv);
    } catch (caught) { setError(apiErrorMessage(caught, 'Couldn’t load the shop orders, so the export would be incomplete. Check your signal and try again.')); }
    finally { setBusy(false); }
  }
  return (
    <RefineSheet title="Treasurer export" onClose={onClose}>
      <div className="et-sheet">
        {error && <Notice>{error}</Notice>}
        <p className="rf-note">One CSV with every entry and shop order: reference, amount, stables, hook-ups, payment status and refunds. It has names, so share it only with whoever keeps the accounts.</p>
        <div className="et-actions">
          <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void download()}>Download CSV</button>
        </div>
      </div>
    </RefineSheet>
  );
}

function ShareSheet({ competition, signups, capacity, onClose }: { competition: CompetitionDetail; signups: SectionSignup[]; capacity: CompetitionEntrySettings | null; onClose: () => void }) {
  const text = entriesSummaryText(competition.name, signups, capacity);
  const [note, setNote] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNote('Copied.'); } catch { setNote('Couldn’t copy. Select the text and copy it.'); }
  }
  async function share() {
    try { await navigator.share({ text }); } catch { /* the sheet was dismissed */ }
  }
  return (
    <RefineSheet title="Share entries summary" onClose={onClose}>
      <div className="et-sheet">
        <pre className="et-preview" aria-label="Summary text">{text}</pre>
        {note && <p className="rf-note" role="status">{note}</p>}
        <div className="et-actions">
          {canShare && <button type="button" className="rf-btn" onClick={() => void share()}>Share</button>}
          <button type="button" className="rf-btn" onClick={() => void copy()}>Copy text</button>
          <a className="rf-btn et-link" href={whatsAppUrl(text)} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
        </div>
      </div>
    </RefineSheet>
  );
}
