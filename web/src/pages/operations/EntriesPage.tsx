import { SubstitutionRequests } from '../competition/reliability/SubstitutionRequests';
import { useT } from '../../i18n/LanguageContext';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ChangePop } from '../../components/ChangePop';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { LeavingRow } from '../../components/LeavingRow';
import { feeText } from '../../lib/entryOptions';
import { paidWord } from '../../lib/paidWord';
import { api } from '../../api';
import { activeLocale, tr } from '../../i18n/translate';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useDockAction } from '../../components/TickerContext';
import { useToast } from '../../components/Toast';
import { apiErrorMessage } from '../../lib/apiError';
import { downloadCsv, safeFilename } from '../../lib/csv';
import { decFormsCsv } from '../../lib/decFormCsv';
import {
  asked, configProblem, newFieldId, NUMBER_FIELD, OFF, OPTIONAL, parseConfigResponse, STANDARD_CONFIG, TEXT_FIELD,
  type CustomField, type DecFormConfig,
} from '../../lib/decFormConfig';
import { heightText } from '../../lib/decForm';
import { displaySectionName } from '../../lib/section';
import { parsePassSignupIdFromSearch } from '../../lib/stablingPass';
import type { CompetitionEntrySettings, DeclarationForm, RiderEntry, SectionSignup } from '../../types';
import { useCompetition } from '../competition/context';
import { RefineChoiceRow, RefineDateTimeRow, RefineHeader, RefineList, RefinePage, RefineSection } from '../refine/Refine';
import type { TeamEntry } from './types';
import { EntryTools } from './EntryTools';
import { StatusSheetView } from './EntriesPanel';
import { statusMessage, type StatusSheet } from './entryStatus';
import { RiderSwapSheet } from './RiderSwapSheet';
import { SignupDetail } from './SignupDetail';
import { FILTERS, bucketCounts, capacityLines, fetchEntrySettings, signupBucket, type EntryFilter } from './entryLogic';
import './operations.css';
import './entryTools.css';

type PartKey = 'trainerPhone' | 'bib' | 'dob' | 'weight' | 'ponyHeight' | 'ponyPassport' | 'ponyAge' | 'membershipNumber' | 'emergencyContact' | 'medicalNotes';
const PARTS: Array<{ key: PartKey; label: string }> = [
  { key: 'trainerPhone', get label() { return tr('ops2.entries.part.trainerPhone'); } },
  { key: 'bib', get label() { return tr('ops2.entries.part.bib'); } },
  { key: 'dob', get label() { return tr('ops2.entries.part.dob'); } },
  { key: 'weight', get label() { return tr('ops2.entries.part.weight'); } },
  { key: 'ponyHeight', get label() { return tr('ops2.entries.part.ponyHeight'); } },
  { key: 'ponyPassport', get label() { return tr('ops2.entries.part.ponyPassport'); } },
  { key: 'ponyAge', get label() { return tr('ops2.entries.part.ponyAge'); } },
  { key: 'membershipNumber', get label() { return tr('ops2.entries.part.membershipNumber'); } },
  { key: 'emergencyContact', get label() { return tr('ops2.entries.part.emergencyContact'); } },
  { key: 'medicalNotes', get label() { return tr('ops2.entries.part.medicalNotes'); } },
];

const whenText = (iso: string) => new Date(iso).toLocaleString(activeLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const eventDays = (start: string, end: string | null | undefined): Date[] => {
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return [];
  const last = end ? new Date(end) : from;
  const days: Date[] = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= last && days.length < 14; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
  return days;
};
const ageOf = (rider: RiderEntry): string => {
  const born = rider.birthYear ?? (rider.dateOfBirth ? Number(rider.dateOfBirth.slice(0, 4)) : null);
  return born && Number.isFinite(born) ? tr('ops2.entries.age', { n: new Date().getFullYear() - born }) : (rider.ageGroup ?? '');
};

interface LockTime { declarationsCloseAt: string | null }

/** Entries and dec forms: who has entered and paid, which forms are in, and what the form asks. Every change saves as it is made. */
export function EntriesPage() {
  const t = useT();
  const { competition, reload } = useCompetition();
  const { search, hash } = useLocation();
  const passSignupId = parsePassSignupIdFromSearch(search);
  const [passNotice, setPassNotice] = useState<string | null>(null);
  const [entries, setEntries] = useState<TeamEntry[] | null>(null);
  const [signups, setSignups] = useState<SectionSignup[]>([]);
  const [forms, setForms] = useState<DeclarationForm[]>([]);
  const [lock, setLock] = useState<string | null>(null);
  const [config, setConfig] = useState<DecFormConfig | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [setup, setSetup] = useState(hash === '#dec-form' || hash === '#fm-dec');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [capacity, setCapacity] = useState<CompetitionEntrySettings | null>(null);
  const [selection, setSelection] = useState<{ filter: EntryFilter; openSignup: number | null; openedPass: string | null }>({ filter: 'all', openSignup: null, openedPass: null });
  const { openSignup } = selection;
  // The chosen filter lives in the address (?show=pending), so Back returns to the same filtered list.
  const [params, setParams] = useSearchParams();
  const fromAddress = FILTERS.find((f) => f.value === params.get('show'))?.value;
  const filter = fromAddress ?? selection.filter;
  const setFilter = (next: EntryFilter) => {
    setSelection((previous) => ({ ...previous, filter: next }));
    setParams((previous) => {
      const kept = new URLSearchParams(previous);
      if (next === 'all') kept.delete('show'); else kept.set('show', next);
      return kept;
    }, { replace: true });
  };
  const setOpenSignup = (next: number | null) => setSelection((previous) => ({ ...previous, openSignup: next }));

  const load = useCallback(async () => {
    const base = `/competitions/${competition.id}`;
    const [e, s, f, l, c, cap] = await Promise.allSettled([
      api.get<TeamEntry[]>(`${base}/entries`),
      api.get<SectionSignup[]>(`${base}/signups`),
      api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } }),
      api.get<LockTime>(`/declaration-forms/competition/${competition.id}/lock-time`),
      api.get(`${base}/dec-form-config`),
      fetchEntrySettings(competition.id),
    ]);
    if (e.status === 'fulfilled') setEntries(Array.isArray(e.value.data) ? e.value.data : []);
    if (s.status === 'fulfilled' && Array.isArray(s.value.data)) {
      setSignups(s.value.data);
      const pass = s.value.data.find((signup) => signup.id === passSignupId);
      setPassNotice(passSignupId !== null && !pass ? t('ops2.entries.passMismatch') : null);
      const passKey = `${competition.id}:${passSignupId}`;
      if (pass) setSelection((previous) => previous.openedPass === passKey ? previous : {
        filter: signupBucket(pass), openSignup: pass.id, openedPass: passKey,
      });
    } else if (passSignupId !== null) {
      setPassNotice(t('ops2.entries.passCheck'));
    }
    if (f.status === 'fulfilled' && Array.isArray(f.value.data)) setForms(f.value.data);
    if (l.status === 'fulfilled') setLock(l.value.data?.declarationsCloseAt ?? null);
    if (c.status === 'fulfilled') setConfig(parseConfigResponse(c.value.data)?.config ?? STANDARD_CONFIG);
    if (cap.status === 'fulfilled') setCapacity(cap.value);
    setError(e.status === 'rejected' ? t('ops2.entries.loadError') : null);
  }, [competition.id, passSignupId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Runs one change, then loads everything again. Failures show on the page. */
  async function run(failure: string, work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try { await work(); await load(); return true; }
    catch (caught) { setError(apiErrorMessage(caught, `${failure} ${t('ops2.print.checkSignal')}`)); return false; }
    finally { setBusy(false); }
  }

  const live = signups.filter((s) => s.status === 0 || s.status === 1);
  const counts = useMemo(() => bucketCounts(signups), [signups]);
  const paidCount = counts.paid;
  const unpaidCount = counts.pending;
  const capacityText = capacityLines(capacity);
  const reloadAll = useCallback(async () => { await load(); }, [load]);
  const shown = useMemo(() => (filter === 'all' ? [] : signups.filter((s) => signupBucket(s) === filter)), [signups, filter]);
  // Unpaid bank-transfer sign-ups have no team yet, so the team list below would hide them.
  const awaitingPayment = useMemo(() => {
    const teamIds = new Set((entries ?? []).map((team) => team.teamId));
    return signups.filter((s) => signupBucket(s) === 'pending' && !(s.teamId != null && teamIds.has(s.teamId)));
  }, [signups, entries]);
  const closed = Boolean(competition.signupsLocked);

  // Each section lists its teams, with any unpaid entry that has no team yet at the top as Not paid.
  const groups = useMemo(() => {
    const map = new Map<number, { name: string; teams: TeamEntry[]; unpaid: SectionSignup[] }>();
    const groupFor = (id: number, name: string) => {
      const group = map.get(id) ?? { name: displaySectionName(name), teams: [], unpaid: [] };
      map.set(id, group);
      return group;
    };
    for (const entry of entries ?? []) groupFor(entry.sectionId, entry.sectionName).teams.push(entry);
    for (const signup of awaitingPayment) groupFor(signup.competitionSectionId, signup.sectionName).unpaid.push(signup);
    return [...map.entries()];
  }, [entries, awaitingPayment]);

  const toggleEntries = () => run(t('ops2.entries.changeEntries'), async () => {
    await api.post(`/competitions/${competition.id}/signups-locked`, { locked: !closed });
    reload();
  });

  const setPaid = async (team: TeamEntry, paid: boolean) => {
    const targets = live.filter((s) => s.teamId === team.teamId && s.status === (paid ? 0 : 1));
    if (targets.length === 0) return;
    const total = targets.reduce((sum, s) => sum + s.amountMinor, 0);
    const what = t('ops2.entries.what', { count: targets.length });
    const ok = await confirmDialog(paid
      ? { title: t('ops2.entries.markPaidQ', { name: team.teamName }), message: t('ops2.entries.receivedMsg', { what, fee: feeText(total) }), confirmLabel: t('ops2.entries.markPaid') }
      : { title: t('ops2.entries.markNotPaidQ', { name: team.teamName }), message: t('ops2.entries.backPendingMsg', { what, fee: feeText(total) }), confirmLabel: t('ops2.entries.markNotPaid') });
    if (!ok) return;
    await run(t('ops2.entries.payError'), async () => {
      for (const signup of targets) {
        if (paid) await api.post(`/competitions/${competition.id}/signups/${signup.id}/mark-paid`);
        else await api.put(`/signups/${signup.id}/status`, { status: 0 });
      }
    });
  };
  const markSignupPaid = async (signup: SectionSignup) => {
    const ok = await confirmDialog({ title: t('ops2.entries.markPaidQ', { name: signup.fullName }), message: t('ops2.entries.receivedMsg', { what: t('ops2.entries.what', { count: 1 }), fee: feeText(signup.amountMinor) }), confirmLabel: t('ops2.entries.markPaid') });
    if (!ok) return;
    await run(t('ops2.entries.payError'), () => api.post(`/competitions/${competition.id}/signups/${signup.id}/mark-paid`));
  };

  // Withdraw, no-show and reinstate share the hub's reason sheet; a rider swap has its own.
  const [statusSheet, setStatusSheet] = useState<StatusSheet | null>(null);
  const [swapTeam, setSwapTeam] = useState<TeamEntry | null>(null);
  const [outOpen, setOutOpen] = useState<number[]>([]);
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/competitions/${competition.id}/declarations`); toast.show(t('ops2.sponsors.linkCopied')); }
    catch { setError(t('ops2.entries.copyError')); }
  }

  const saveLock = (iso: string | null) => run(t('ops2.entries.deadlineError'), () => api.put(`/declaration-forms/competition/${competition.id}/lock-time`, { declarationsCloseAt: iso }));
  const saveConfig = (next: DecFormConfig) => {
    const problem = configProblem(next);
    if (problem) { setError(problem); return Promise.resolve(false); }
    setConfig(next);
    return run(t('ops2.entries.decError'), async () => { await api.put(`/competitions/${competition.id}/dec-form-config`, next); });
  };

  const days = eventDays(competition.startDate, competition.endDate);

  // The tools live in one sheet opened from the dock; with no dock (page on its own) they stay on the page.
  const [toolsOpen, setToolsOpen] = useState(hash === '#dec-form' || hash === '#fm-dec');
  const docked = useDockAction({ label: t('ops2.entries.toolsSheet'), icon: 'settings', onClick: () => setToolsOpen(true) });

  const controls = (
    <>
        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow">
              <span className="rf-t1">{closed ? t('ops2.entries.closed') : t('ops2.entries.open')}</span>
              <span className="rf-t2">{t('ops2.entries.paidNot', { paid: paidCount, unpaid: unpaidCount })}</span>
              {capacityText.length > 0 && <span className="rf-t2 et-cap">{capacityText.join(' · ')}</span>}
            </span>
            <button type="button" className="rf-btn" disabled={busy} onClick={() => void toggleEntries()}>{closed ? t('ops2.entries.reopen') : t('ops2.entries.close')}</button>
          </div>
          <div className="rf-row">
            <span className="rf-grow"><span className="rf-t1">{t('ops2.entries.tools')}</span><span className="rf-t2">{t('ops2.entries.toolsSub')}</span></span>
            <EntryTools competition={competition} signups={signups} capacity={capacity} onChanged={reloadAll} />
          </div>
          {/* One dropdown, not a row of pills. "All" lists teams by section, so it carries no sign-up count. */}
          <RefineChoiceRow label={t('ops2.entries.show')} value={filter} onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f.value, label: f.value === 'all' ? t('ops2.entries.allTeams') : `${f.label} (${counts[f.value]})` }))} />
        </RefineList>
    </>
  );
  const decForm = (
    <section id="dec-form">
        <RefineSection title={t('ops2.entries.decForm')} />
        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow"><span className="rf-t1">{t('ops2.entries.qAndFlags')}</span>{config && <span className="rf-t2">{t('ops2.entries.qCount', { questions: questionCount(config), rules: rulesOf(config).length })}</span>}</span>
            <button type="button" className="rf-btn" aria-expanded={setup} onClick={() => setSetup((v) => !v)}>{setup ? t('common.done') : t('common.edit')}</button>
          </div>
          {setup && config && (
            <>
              <RefineDateTimeRow label={t('ops2.entries.deadline')} value={lock} eventDays={days} disabled={busy} onChange={(iso) => void saveLock(iso)} />
              <div className="rf-row">
                <span className="rf-grow"><span className="rf-t1">{t('ops2.entries.download')}</span><span className="rf-t2">{t('ops2.entries.downloadSub')}</span></span>
                <button type="button" className="rf-btn" disabled={forms.length === 0}
                  onClick={() => downloadCsv(`${safeFilename(competition.name)}-dec-forms.csv`, decFormsCsv(forms, config.customFields))}>CSV</button>
              </div>
            </>
          )}
        </RefineList>
        {setup && config && <SetupEditor config={config} busy={busy} onSave={saveConfig} />}
    </section>
  );

  const renderTeam = (team: TeamEntry) => {
      const mine = live.filter((s) => s.teamId === team.teamId);
      const paid = mine.length > 0 && mine.every((s) => s.status === 1);
      const form = forms.find((f) => f.teamId === team.teamId);
      const flags = (form?.riders ?? []).flatMap((r) => r.flags ?? []);
      const out = team.status !== 0;
      const tag = out ? { text: t('ops2.protest.withdrawn'), tone: 'mut' } : !form ? { text: t('ops2.entries.missing'), tone: 'mut' } : flags.length > 0 ? { text: t('ops2.entries.flagged'), tone: 'warn' } : { text: t('ops2.entries.received'), tone: 'ok' };
      const isOpen = open === team.teamId;
      const pending = !out && mine.length > 0 && !paid;
      const owed = mine.filter((s) => s.status === 0).reduce((sum, s) => sum + s.amountMinor, 0);
      return (
        <LeavingRow as="div" key={team.teamId}>
          <button type="button" className="rf-row ops-entry-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : team.teamId)}>
            <span className="rf-grow">
              <span className="rf-t1">{team.teamName}</span>
              <span className="rf-t2">
                {mine.length > 0 && !pending && <span className={paid ? 'ops-paid' : 'ops-unpaid'}><ChangePop value={paid ? paidWord(competition.isDemo) : t('ops2.entries.notPaid')} tick={paid}>{paid ? paidWord(competition.isDemo) : t('ops2.entries.notPaid')}</ChangePop></span>}
                {mine.length > 0 && !pending && form ? ' · ' : ''}{form ? t('ops2.entries.formIn', { when: whenText(form.submittedAt) }) : ''}
              </span>
            </span>
            <span className={`rf-st rf-${tag.tone}`}>{tag.text}</span>
            <ChevronDown className={`rf-chev rf-chev-down h-4 w-4 ${isOpen ? 'ops-flip' : ''}`} aria-hidden="true" />
          </button>
          {pending && (
            <div className="ops-pending">
              <span className="ops-badge-pending">{t('ops2.entries.notPaid')}</span>
              {owed > 0 && <span className="rf-t2">{t('ops2.entries.byBank', { fee: feeText(owed) })}</span>}
              <button type="button" className="rf-btn rf-btn-primary ops-markpaid" disabled={busy} aria-label={t('ops2.entries.markPaidAria', { name: team.teamName })} onClick={() => void setPaid(team, true)}>{t('ops2.entries.markPaid')}</button>
            </div>
          )}
          {isOpen && (
            <div className="ops-entry-body">
              {mine.length > 0 && (
                <div className="ops-line">
                  <span className="rf-grow"><span className="rf-t1"><ChangePop value={paid ? paidWord(competition.isDemo) : t('ops2.entries.notPaidYet')} tick={paid}>{paid ? paidWord(competition.isDemo) : t('ops2.entries.notPaidYet')}</ChangePop></span></span>
                  <button type="button" className="rf-btn" disabled={busy} onClick={() => void setPaid(team, !paid)}>{paid ? t('ops2.entries.markNotPaid') : t('ops2.entries.markPaid')}</button>
                </div>
              )}
              {form ? <FormView form={form} flags={flags} /> : (
                <div className="ops-line">
                  <span className="rf-grow"><span className="rf-t1">{t('ops2.entries.notReceived')}</span></span>
                  <button type="button" className="rf-btn" onClick={() => void copyLink()}>{t('ops2.entries.copyForm')}</button>
                </div>
              )}
              {signups.filter((s) => s.teamId === team.teamId).map((s, _i, all) => (
                <div key={s.id} className="et-sub">
                  {all.length > 1 && <p className="et-sub-name">{s.fullName}</p>}
                  <SignupDetail competition={competition} signup={s} onChanged={reloadAll} />
                </div>
              ))}
              <div className="ops-line ops-line-end">
                {out
                  ? (team.canReinstate ? <button type="button" className="rf-btn" disabled={busy} onClick={() => setStatusSheet({ team, next: 0 })}>{t('ops2.panel.reinstate')}</button> : <span className="rf-t2">{t('ops2.entries.outOfDraw')}</span>)
                  : <>
                    <button type="button" className="rf-btn" disabled={busy} onClick={() => setSwapTeam(team)}>{t('ops2.panel.swap')}</button>
                    <button type="button" className="rf-btn" disabled={busy} onClick={() => setStatusSheet({ team, next: 2 })}>{t('ops2.redraw.noShow')}</button>
                    <button type="button" className="ops-danger-link" disabled={busy} onClick={() => setStatusSheet({ team, next: 1 })}>{t('ops2.entries.withdrawThis')}</button>
                  </>}
              </div>
            </div>
          )}
        </LeavingRow>
      );
  };

  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel={t('ops.hub.back')} context={competition.name} title={t('ops2.entries.title')} />
      <div className="ops-cards ops-entries" aria-busy={busy}>
        <SubstitutionRequests competitionId={competition.id} canDecide onChanged={reloadAll} />
        {error && <Notice>{error}</Notice>}
        {passNotice && <Notice>{passNotice}</Notice>}
        {toast.node}

        {!docked && decForm}
        {!docked && controls}

        {filter !== 'all' && (
          <SignupList
            signups={shown} filter={filter} busy={busy} openId={openSignup} competition={competition}
            onOpen={(id) => setOpenSignup(openSignup === id ? null : id)} onMarkPaid={(s) => void markSignupPaid(s)} onChanged={reloadAll}
          />
        )}

        {filter === 'all' && entries !== null && entries.length === 0 && awaitingPayment.length === 0 && <p className="rf-note">{t('ops2.entries.noEntries')}</p>}
        {filter === 'all' && groups.map(([sectionId, group]) => {
          const inDraw = group.teams.filter((team) => team.status === 0);
          const outTeams = group.teams.filter((team) => team.status !== 0);
          const showOut = outOpen.includes(sectionId);
          return (
            <Fragment key={sectionId}>
              <RefineSection title={group.name} />
              <RefineList as="div" label={group.name}>
                {group.unpaid.map((s) => (
                  <SignupRow key={s.id} signup={s} badge={t('ops2.entries.notPaid')} busy={busy} open={openSignup === s.id} competition={competition}
                    onOpen={() => setOpenSignup(openSignup === s.id ? null : s.id)} onMarkPaid={() => void markSignupPaid(s)} onChanged={reloadAll} />
                ))}
                <AnimatePresence initial={false}>{inDraw.map(renderTeam)}</AnimatePresence>
                {outTeams.length > 0 && (
                  <button type="button" className="rf-row ops-out-fold" aria-expanded={showOut}
                    onClick={() => setOutOpen((list) => (showOut ? list.filter((id) => id !== sectionId) : [...list, sectionId]))}>
                    <span className="rf-grow rf-t2">{t('ops2.entries.outFold', { count: outTeams.length })}</span>
                    <ChevronDown className={`rf-chev rf-chev-down h-4 w-4 ${showOut ? 'ops-flip' : ''}`} aria-hidden="true" />
                  </button>
                )}
                <AnimatePresence initial={false}>{showOut && outTeams.map(renderTeam)}</AnimatePresence>
              </RefineList>
            </Fragment>
          );
        })}

      </div>
      {statusSheet && (
        <StatusSheetView
          key={`${statusSheet.team.teamId}:${statusSheet.next}`}
          competitionId={competition.id}
          sheet={statusSheet}
          onClose={() => setStatusSheet(null)}
          onDone={(result) => { setStatusSheet(null); toast.show(statusMessage(statusSheet, result)); reload(); void load(); }}
        />
      )}
      {swapTeam && (
        <RiderSwapSheet competitionId={competition.id} team={swapTeam} canWrite onClose={() => setSwapTeam(null)}
          onSwapped={(text) => { toast.show(text); void load(); }} />
      )}
      {docked && toolsOpen && (
        <Sheet title={t('ops2.entries.toolsSheet')} onClose={() => setToolsOpen(false)}>
          {decForm}
          {controls}
        </Sheet>
      )}
    </RefinePage>
  );
}

/** Entries picked by the filter, one row each: people not in a team yet (pending, waiting list) or out of the event (withdrawn). */
function SignupList({ signups, filter, busy, openId, competition, onOpen, onMarkPaid, onChanged }: {
  signups: SectionSignup[]; filter: EntryFilter; busy: boolean; openId: number | null; competition: ReturnType<typeof useCompetition>['competition'];
  onOpen: (id: number) => void; onMarkPaid: (s: SectionSignup) => void; onChanged: () => Promise<void>;
}) {
  const t = useT();
  const empty: Record<EntryFilter, string> = { all: '', paid: t('ops2.entries.e.paid'), pending: t('ops2.entries.e.pending'), waitlist: t('ops2.entries.e.waitlist'), withdrawn: t('ops2.entries.e.withdrawn') };
  if (signups.length === 0) return <p className="rf-note">{empty[filter]}</p>;
  return (
    <RefineList as="div" label={t('ops2.panel.entries')}>
      {signups.map((s) => (
        <SignupRow key={s.id} signup={s} badge={t('ops2.entries.pendingPayment')} busy={busy} open={openId === s.id} competition={competition}
          onOpen={() => onOpen(s.id)} onMarkPaid={() => onMarkPaid(s)} onChanged={onChanged} />
      ))}
    </RefineList>
  );
}

/** One entry with no team yet, opening in place; an unpaid one carries its badge and a quick Mark paid. */
function SignupRow({ signup: s, badge, busy, open: isOpen, competition, onOpen, onMarkPaid, onChanged }: {
  signup: SectionSignup; badge: string; busy: boolean; open: boolean; competition: ReturnType<typeof useCompetition>['competition'];
  onOpen: () => void; onMarkPaid: () => void; onChanged: () => Promise<void>;
}) {
  const t = useT();
  const bucket = signupBucket(s);
  const tag = bucket === 'paid' ? { text: paidWord(competition.isDemo), tone: 'ok' } : bucket === 'pending' ? { text: badge, tone: 'warn' } : bucket === 'waitlist' ? { text: t('ops2.entries.f.waitlist'), tone: 'mut' } : { text: t('ops2.protest.withdrawn'), tone: 'mut' };
  return (
    <div>
      <button type="button" className="rf-row ops-entry-row" aria-expanded={isOpen} onClick={onOpen}>
        <span className="rf-grow">
          <span className="rf-t1">{s.fullName}</span>
          <span className="rf-t2">{displaySectionName(s.sectionName)} · {feeText(s.amountMinor)}{s.teamName ? ` · ${s.teamName}` : ''}</span>
        </span>
        <span className={`rf-st rf-${tag.tone}`}>{tag.text}</span>
        <ChevronDown className={`rf-chev rf-chev-down h-4 w-4 ${isOpen ? 'ops-flip' : ''}`} aria-hidden="true" />
      </button>
      {bucket === 'pending' && (
        <div className="ops-pending">
          <span className="ops-badge-pending">{badge}</span>
          <span className="rf-t2">{t('ops2.entries.byBank', { fee: feeText(s.amountMinor) })}</span>
          <button type="button" className="rf-btn rf-btn-primary ops-markpaid" disabled={busy} aria-label={t('ops2.entries.markPaidAria', { name: s.fullName })} onClick={onMarkPaid}>{t('ops2.entries.markPaid')}</button>
        </div>
      )}
      {isOpen && (
        <div className="ops-entry-body">
          <SignupDetail competition={competition} signup={s} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function FormView({ form, flags }: { form: DeclarationForm; flags: string[] }) {
  const t = useT();
  const riders = form.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  return (
    <div className="ops-form">
      {flags.map((text) => <Notice key={text} role="status">{text}</Notice>)}
      <p className="rf-t1">{t('ops2.entries.trainer', { name: form.trainerName ?? form.submittedByName ?? t('ops2.entries.notGiven') })}</p>
      <ol className="ops-riders">
        <AnimatePresence initial={false}>
          {riders.map((rider, i) => (
            <LeavingRow key={rider.id}>
              <span className="ops-race-n">{i + 1}</span>
              <span className="rf-grow"><span className="rf-t1">{rider.fullName}</span><span className="rf-t2">{rider.horseName ?? ''}</span></span>
              <span className="rf-t2 ops-facts">{[rider.ponyHeightHands != null ? `${heightText(rider.ponyHeightHands)} hh` : '', ageOf(rider)].filter(Boolean).join(' · ')}</span>
            </LeavingRow>
          ))}
        </AnimatePresence>
      </ol>
      {form.notes && <p className="rf-t2">{form.notes}</p>}
    </div>
  );
}

const questionCount = (config: DecFormConfig) => PARTS.filter((p) => asked(config[p.key])).length + config.customFields.length;

interface Rule { field: string; op: 'over' | 'under'; value: number }
/** The flag rules the API stores: a number question's upper and lower limit. */
function rulesOf(config: DecFormConfig): Rule[] {
  return config.customFields.flatMap((f) => [
    ...(f.type === NUMBER_FIELD && f.max != null ? [{ field: f.id, op: 'over' as const, value: f.max }] : []),
    ...(f.type === NUMBER_FIELD && f.min != null ? [{ field: f.id, op: 'under' as const, value: f.min }] : []),
  ]);
}
function withoutRule(config: DecFormConfig, rule: Pick<Rule, 'field' | 'op'>): DecFormConfig {
  return { ...config, customFields: config.customFields.map((f) => (f.id === rule.field ? { ...f, ...(rule.op === 'over' ? { max: null } : { min: null }) } : f)) };
}
function withRule(config: DecFormConfig, rule: Rule): DecFormConfig {
  return { ...config, customFields: config.customFields.map((f) => (f.id === rule.field ? { ...f, ...(rule.op === 'over' ? { max: rule.value } : { min: rule.value }) } : f)) };
}

/** The questions the form asks (Remove each, add from the usual ones or write your own) and the flag rules. */
function SetupEditor({ config, busy, onSave }: { config: DecFormConfig; busy: boolean; onSave: (next: DecFormConfig) => Promise<boolean> }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [own, setOwn] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'text' | 'number'>('text');
  const [unit, setUnit] = useState('');
  const [pending, setPending] = useState<Array<{ key: number; field: string; op: 'over' | 'under' }>>([]);
  const used = PARTS.filter((p) => asked(config[p.key]));
  const unused = PARTS.filter((p) => !asked(config[p.key]));
  const numbers = config.customFields.filter((f) => f.type === NUMBER_FIELD);
  const rules = rulesOf(config);
  const label = (id: string) => config.customFields.find((f) => f.id === id)?.label.trim() || t('ops2.entries.question');
  const unitOf = (id: string) => config.customFields.find((f) => f.id === id)?.unit?.trim() ?? '';

  function addOwn() {
    const text = name.trim();
    if (!text) return;
    const field: CustomField = { id: newFieldId(config.customFields), label: text, type: kind === 'number' ? NUMBER_FIELD : TEXT_FIELD, required: false, min: null, max: null, unit: kind === 'number' ? unit.trim() || null : null };
    void onSave({ ...config, customFields: [...config.customFields, field] });
    setOwn(false); setAdding(false); setName(''); setUnit(''); setKind('text');
  }

  return (
    <>
      <RefineSection title={t('ops2.entries.questions')} />
      <RefineList as="div" label={t('ops2.entries.questions')}>
        {used.map((part) => (
          <div key={part.key} className="rf-row"><span className="rf-grow rf-t1">{part.label}</span>
            <button type="button" className="ops-danger-link" disabled={busy} aria-label={t('ops2.entries.removeAria', { name: part.label })} onClick={() => void onSave({ ...config, [part.key]: OFF })}>{t('ops2.entries.remove')}</button></div>
        ))}
        {config.customFields.map((field) => (
          <div key={field.id} className="rf-row"><span className="rf-grow"><span className="rf-t1">{field.label}</span>{field.type === NUMBER_FIELD && <span className="rf-t2">{field.unit ? t('ops2.entries.numberIn', { unit: field.unit }) : t('ops2.entries.aNumber')}</span>}</span>
            <button type="button" className="ops-danger-link" disabled={busy} aria-label={t('ops2.entries.removeAria', { name: field.label })}
              onClick={() => void onSave({ ...config, customFields: config.customFields.filter((f) => f.id !== field.id) })}>{t('ops2.entries.remove')}</button></div>
        ))}
        <div className="rf-row ops-end">
          <button type="button" className="rf-btn" aria-expanded={adding} disabled={busy} onClick={() => { setAdding((v) => !v); setOwn(false); }}>{t('ops2.entries.addQ')}</button>
        </div>
        {adding && !own && (
          <div className="rf-choices ops-add-list" role="listbox" aria-label={t('ops2.entries.addQLabel')}>
            {unused.map((part) => (
              <button key={part.key} type="button" role="option" aria-selected={false} className="rf-choice" onClick={() => { void onSave({ ...config, [part.key]: OPTIONAL }); setAdding(false); }}>{part.label}</button>
            ))}
            <button type="button" role="option" aria-selected={false} className="rf-choice" onClick={() => setOwn(true)}>{t('ops2.entries.writeOwn')}</button>
          </div>
        )}
        {adding && own && (
          <form className="ops-dup" onSubmit={(event) => { event.preventDefault(); addOwn(); }}>
            <label className="rf-fld">{t('ops2.entries.question')}<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
            <RefineChoiceRow label={t('ops2.entries.answer')} value={kind} options={[{ value: 'text', label: t('ops2.entries.text') }, { value: 'number', label: t('ops2.entries.aNumber') }]} onChange={setKind} />
            {kind === 'number' && <label className="rf-fld">{t('ops2.entries.unit')}<input value={unit} maxLength={20} onChange={(event) => setUnit(event.target.value)} /></label>}
            <div className="rf-actions"><button type="submit" className="rf-btn rf-btn-primary" disabled={!name.trim()}>{t('ops2.entries.addQuestion')}</button><button type="button" className="rf-btn" onClick={() => setOwn(false)}>{t('common.cancel')}</button></div>
          </form>
        )}
      </RefineList>

      <RefineSection title={t('ops2.entries.flagRules')} />
      {numbers.length === 0 && <p className="rf-note">{t('ops2.entries.addNumberQ')}</p>}
      {numbers.length > 0 && (
        <>
          {rules.map((rule) => (
            <RuleBlock key={`${rule.field}-${rule.op}`} uid={`${rule.field}-${rule.op}`} numbers={numbers} field={rule.field} op={rule.op} value={String(rule.value)} unit={unitOf(rule.field)} busy={busy} label={label(rule.field)}
              onChange={(next) => { if (next.value !== null) void onSave(withRule(withoutRule(config, rule), { field: next.field, op: next.op, value: next.value })); }}
              onRemove={() => void onSave(withoutRule(config, rule))} />
          ))}
          {pending.map((rule) => (
            <RuleBlock key={`p${rule.key}`} uid={`new-${rule.key}`} numbers={numbers} field={rule.field} op={rule.op} value="" unit={unitOf(rule.field)} busy={busy} label={label(rule.field)}
              onChange={(next) => {
                if (next.value === null) { setPending((list) => list.map((p) => (p.key === rule.key ? { ...p, field: next.field, op: next.op } : p))); return; }
                setPending((list) => list.filter((p) => p.key !== rule.key));
                void onSave(withRule(config, { field: next.field, op: next.op, value: next.value }));
              }}
              onRemove={() => setPending((list) => list.filter((p) => p.key !== rule.key))} />
          ))}
          <button type="button" className="ops-addbar" disabled={busy} onClick={() => setPending((list) => [...list, { key: list.length ? list[list.length - 1].key + 1 : 1, field: numbers[0].id, op: 'over' }])}>{t('ops2.entries.addRule')}</button>
        </>
      )}
    </>
  );
}

/** One flag rule: "Flag if", then the answer, over or under, and the limit. */
function RuleBlock({ uid, numbers, field, op, value, unit, label, busy, onChange, onRemove }: {
  uid: string; numbers: CustomField[]; field: string; op: 'over' | 'under'; value: string; unit: string; label: string; busy: boolean;
  onChange: (next: { field: string; op: 'over' | 'under'; value: number | null }) => void; onRemove: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(value);
  const commit = () => { const n = Number(text); if (text.trim() !== '' && Number.isFinite(n) && String(n) !== value) onChange({ field, op, value: n }); };
  return (
    <RefineList as="div" label={t('ops2.entries.ruleFor', { name: label })}>
      <div className="rf-row ops-rule-head"><span className="rf-grow rf-t1">{t('ops2.entries.flagIf')}</span></div>
      <RefineChoiceRow label={t('ops2.entries.answer')} value={field} options={numbers.map((f) => ({ value: f.id, label: f.label.trim() || t('ops2.entries.question') }))} disabled={busy}
        onChange={(next) => onChange({ field: next, op, value: text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : null })} />
      <RefineChoiceRow label={t('ops2.entries.is')} value={op} options={[{ value: 'over', label: t('ops2.entries.isOver') }, { value: 'under', label: t('ops2.entries.isUnder') }]} disabled={busy}
        onChange={(next) => onChange({ field, op: next, value: text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : null })} />
      <div className="rf-row">
        <label className="rf-grow rf-t1" htmlFor={`rule-${uid}`}>{t('ops2.entries.value')}</label>
        <input id={`rule-${uid}`} className="ops-value" inputMode="decimal" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} onBlur={commit} />
        {unit && <span className="rf-t2">{unit}</span>}
      </div>
      <div className="rf-row ops-end"><button type="button" className="ops-danger-link" disabled={busy} onClick={onRemove}>{t('ops2.entries.removeRule')}</button></div>
    </RefineList>
  );
}
