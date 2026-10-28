import { useT } from '../../i18n/LanguageContext';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { tr } from '../../i18n/translate';
import { Notice } from '../../components/Notice';
import { apiErrorMessage } from '../../lib/apiError';
import { downloadCsv, safeFilename } from '../../lib/csv';
import { feeText } from '../../lib/entryOptions';
import { paidWord } from '../../lib/paidWord';
import { arrivalManifestCsv, arrivalWindowLabel, computeFeeDispositionLedger, groupArrivalManifest } from '../../lib/entryWorkflows';
import { displaySectionName } from '../../lib/section';
import { treasurerCsv } from '../../lib/treasurerCsv';
import { whatsAppUrl } from '../../lib/whatsapp';
import type { CompetitionDetail, CompetitionEntrySettings, SectionSignup } from '../../types';
import { RefineList, RefineSheet } from '../refine/Refine';
import { BacsMatchSheet, ClubInvoicesSheet, RemindUnpaidSheet } from './EntryMoneySheets';
import { dispositionLabel, entriesSummaryText, fetchShopOrders } from './entryLogic';
import './entryTools.css';
import { clubLabel } from '../../lib/clubName';

type Tool = 'bacs' | 'remind' | 'clubs' | 'arrivals' | 'refunds' | 'treasurer' | 'share';

const TOOLS: Array<{ tool: Tool; title: string; hint: string }> = [
  { tool: 'bacs', get title() { return tr('ops2.tools.bacs'); }, get hint() { return tr('ops2.hint.bacs'); } },
  { tool: 'remind', get title() { return tr('ops2.tools.remind'); }, get hint() { return tr('ops2.hint.remind'); } },
  { tool: 'clubs', get title() { return tr('ops2.tools.clubs'); }, get hint() { return tr('ops2.hint.clubs'); } },
  { tool: 'arrivals', get title() { return tr('ops2.tools.arrivals'); }, get hint() { return tr('ops2.hint.arrivals'); } },
  { tool: 'refunds', get title() { return tr('ops2.tools.refunds'); }, get hint() { return tr('ops2.hint.refunds'); } },
  { tool: 'treasurer', get title() { return tr('ops2.tools.treasurer'); }, get hint() { return tr('ops2.hint.treasurer'); } },
  { tool: 'share', get title() { return tr('ops2.tools.share'); }, get hint() { return tr('ops2.hint.share'); } },
];

interface Props {
  competition: CompetitionDetail;
  signups: SectionSignup[];
  capacity: CompetitionEntrySettings | null;
  onChanged: () => Promise<void> | void;
}

/** The organiser's entry tools: one row that opens a menu, then a focused sheet for each job. */
export function EntryTools({ competition, signups, capacity, onChanged }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const close = () => setTool(null);
  const shared = { competition, signups, onChanged, onClose: close };
  return (
    <>
      <button type="button" className="rf-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>{t('ops2.tools.entryTools')}</button>
      {open && tool === null && (
        <RefineSheet title={t('ops2.tools.entryTools')} onClose={() => setOpen(false)}>
          <div className="et-sheet">
            <RefineList as="div" label={t('ops2.tools.entryTools')}>
              {TOOLS.filter((item) => !(competition.isDemo && item.tool === 'bacs')).map((item) => (
                <button key={item.tool} type="button" className="rf-row et-tool" onClick={() => setTool(item.tool)}>
                  <span className="rf-grow"><span className="rf-t1">{item.title}</span><span className="rf-t2">{item.hint}</span></span>
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
  const t = useT();
  const groups = groupArrivalManifest(signups);
  const [filter, setFilter] = useState<WindowFilter>('all');
  const shown = filter === 'all' ? [...groups.fridayEvening, ...groups.saturdayMorning, ...groups.other] : groups[filter];
  const chips: Array<{ value: WindowFilter; label: string; n: number }> = [
    { value: 'all', label: t('ops2.entries.f.all'), n: groups.fridayEvening.length + groups.saturdayMorning.length + groups.other.length },
    { value: 'fridayEvening', label: t('ops2.entries.arr.fri'), n: groups.fridayEvening.length },
    { value: 'saturdayMorning', label: t('ops2.entries.arr.sat'), n: groups.saturdayMorning.length },
    { value: 'other', label: t('ops2.entries.arr.other'), n: groups.other.length },
  ];
  return (
    <RefineSheet title={t('ops2.tools.arrivals')} onClose={onClose}>
      <div className="et-sheet">
        <div className="ops-chips" role="group" aria-label={t('ops2.tools.arrivalTime')}>
          {chips.map((c) => (
            <button key={c.value} type="button" className="rf-btn et-chip" aria-pressed={filter === c.value} onClick={() => setFilter(c.value)}>{c.label} · {c.n}</button>
          ))}
        </div>
        {shown.length === 0 ? <p className="rf-note">{t('ops2.tools.nobodyBooked')}</p> : (
          <RefineList as="div" label={t('ops2.tools.arrivals2')}>
            {shown.map((s) => (
              <div key={s.id} className="rf-row">
                <span className="rf-grow">
                  <span className="rf-t1">{s.fullName}</span>
                  <span className="rf-t2">{[clubLabel(s.stablingClubOrTeam) || clubLabel(s.ponyClubName) || clubLabel(s.teamName), displaySectionName(s.sectionName)].filter(Boolean).join(' · ')}</span>
                  <span className="rf-t2">{arrivalWindowLabel(s.arrivalWindow)} · {s.vehicleRegistration?.trim() || t('ops2.tools.noVehicle')} · {tr('ops2.money.n.stable', { count: s.stablesCount ?? 0 })}</span>
                </span>
                <span className={`rf-st ${s.status === 1 ? 'rf-ok' : 'rf-warn'}`}>{s.status === 1 ? paidWord(competition.isDemo) : t('ops2.entries.pendingPayment')}</span>
              </div>
            ))}
          </RefineList>
        )}
        <div className="et-actions">
          <button type="button" className="rf-btn" disabled={shown.length === 0}
            onClick={() => downloadCsv(`${safeFilename(competition.name)}-arrivals.csv`, arrivalManifestCsv(shown))}>{t('ops2.tools.downloadCsv')}</button>
        </div>
        <p className="rf-note">{t('ops2.tools.csvNote')}</p>
      </div>
    </RefineSheet>
  );
}

function RefundsSheet({ signups, onClose }: { signups: SectionSignup[]; onClose: () => void }) {
  const t = useT();
  const ledger = computeFeeDispositionLedger(signups);
  const totals: Array<[string, number]> = [
    [t('ops2.entries.fee.refunded'), ledger.totalRefundedMinor],
    [t('ops2.tools.stillToPay'), ledger.refundsPendingMinor],
    [t('ops2.tools.feesKept'), ledger.totalRetainedMinor],
    [t('ops2.entries.fee.credit'), ledger.creditsRolledOverMinor],
  ];
  return (
    <RefineSheet title={t('ops2.tools.refunds')} onClose={onClose}>
      <div className="et-sheet">
        <RefineList as="div" label={t('ops2.tools.totals')}>
          {totals.map(([label, minor]) => (
            <div key={label} className="rf-row"><span className="rf-grow rf-t1">{label}</span><span className="rf-t1">{feeText(minor)}</span></div>
          ))}
        </RefineList>
        {ledger.rows.length === 0 ? <p className="rf-note">{t('ops2.tools.noRefunds')}</p> : (
          <RefineList as="div" label={t('ops2.tools.withdrawnRefunded')}>
            {ledger.rows.map((s) => (
              <div key={s.id} className="rf-row">
                <span className="rf-grow">
                  <span className="rf-t1">{s.fullName}</span>
                  <span className="rf-t2">{displaySectionName(s.sectionName)} · {t('ops2.tools.fee', { fee: feeText(s.amountMinor) })}{s.dispositionNote ? ` · ${s.dispositionNote}` : ''}</span>
                </span>
                <span className="rf-st rf-mut">{dispositionLabel(s.feeDisposition)}</span>
              </div>
            ))}
          </RefineList>
        )}
        <p className="rf-note">{t('ops2.tools.recordNote')}</p>
      </div>
    </RefineSheet>
  );
}

function TreasurerSheet({ competition, signups, onClose }: { competition: CompetitionDetail; signups: SectionSignup[]; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true); setError(null);
    try {
      const orders = await fetchShopOrders(competition.id);
      const csv = treasurerCsv({ competitionId: competition.id, competitionName: competition.name, signups, orders, teams: competition.teams });
      downloadCsv(`${safeFilename(competition.name)}-treasurer.csv`, csv);
    } catch (caught) { setError(apiErrorMessage(caught, t('ops2.tools.treasurerError'))); }
    finally { setBusy(false); }
  }
  return (
    <RefineSheet title={t('ops2.tools.treasurer')} onClose={onClose}>
      <div className="et-sheet">
        {error && <Notice>{error}</Notice>}
        <p className="rf-note">{t('ops2.tools.treasurerNote')}</p>
        <div className="et-actions">
          <button type="button" className="rf-btn rf-btn-primary" disabled={busy} onClick={() => void download()}>{t('ops2.tools.downloadCsv')}</button>
        </div>
      </div>
    </RefineSheet>
  );
}

function ShareSheet({ competition, signups, capacity, onClose }: { competition: CompetitionDetail; signups: SectionSignup[]; capacity: CompetitionEntrySettings | null; onClose: () => void }) {
  const t = useT();
  const text = entriesSummaryText(competition.name, signups, capacity);
  const [note, setNote] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNote(t('ops2.tools.copied')); } catch { setNote(t('ops2.tools.copyFailed')); }
  }
  async function share() {
    try { await navigator.share({ text }); } catch { /* the sheet was dismissed */ }
  }
  return (
    <RefineSheet title={t('ops2.tools.share')} onClose={onClose}>
      <div className="et-sheet">
        <pre className="et-preview" aria-label={t('ops2.tools.summaryText')}>{text}</pre>
        {note && <p className="rf-note" role="status">{note}</p>}
        <div className="et-actions">
          {canShare && <button type="button" className="rf-btn" onClick={() => void share()}>{t('ops2.sponsors.share')}</button>}
          <button type="button" className="rf-btn" onClick={() => void copy()}>{t('ops2.tools.copyText')}</button>
          <a className="rf-btn et-link" href={whatsAppUrl(text)} target="_blank" rel="noopener noreferrer">{t('ops2.money.whatsapp')}</a>
        </div>
      </div>
    </RefineSheet>
  );
}
