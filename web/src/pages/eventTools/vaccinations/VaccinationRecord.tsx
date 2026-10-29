import { useState } from 'react';
import { api } from '../../../api';
import { confirmDialog } from '../../../components/ConfirmDialog';
import { Notice } from '../../../components/Notice';
import { RefineChoiceRow, RefineNote, RefineSection, RefineSwitchRow } from '../../refine/Refine';
import { latestEvidence, message, type Evidence, type Pony, type Settings } from './types';
import { useVaccinationT } from './useVaccinationT';

function EvidenceResult({ evidence }: { evidence: Evidence }) {
  const t = useVaccinationT();
  const result = evidence.evaluation;
  return <div className="space-y-2" aria-live="polite">
    <p className="font-semibold">{t(`vaccinations.${result.status}`)}</p>
    {([['mandatory', result.mandatory], ['recommended', result.recommendations], ['review', result.review]] as const).map(([group, findings]) => findings.length > 0 && <div key={group}>
      <p className="font-medium">{t(`vaccinations.${group}`)}</p>
      <ul className="list-disc space-y-1 pl-5">{findings.map((finding, i) => <li key={`${finding.code}-${i}`}>
        {finding.message}{finding.relevantOn && ` (${finding.relevantOn})`}
        {finding.sourceUrl?.startsWith('https://') && <> · <a className="underline" href={finding.sourceUrl} target="_blank" rel="noreferrer">{t('vaccinations.source')}</a></>}
      </li>)}</ul>
    </div>)}
  </div>;
}

export function VaccinationRecord({ pony, settings, base, staff, onChange, onReload }: {
  pony: Pony; settings: Settings; base: string; staff: boolean; onChange: (pony: Pony) => void; onReload: () => void;
}) {
  const t = useVaccinationT();
  const evidence = latestEvidence(pony);
  const initial = staff ? pony.verified ?? pony.provisional : pony.provisional;
  const [dates, setDates] = useState(initial?.dates.length ? initial.dates : ['']);
  const [arrivalOn, setArrival] = useState(initial?.arrivalOn ?? '');
  const [otherDate, setOtherDate] = useState(initial?.lastOtherVaccinationOn ?? '');
  const [complete, setComplete] = useState(initial?.completeHistory ?? false);
  const [exception, setException] = useState(initial?.exceptionReview ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [decision, setDecision] = useState('review');
  const [reason, setReason] = useState('');
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const edit = (action: () => void) => { action(); setDirty(true); setSaved(false); };
  async function saveDates() {
    setBusy(true); setError(null);
    try {
      const { data } = await api.put<Pony>(`${base}/riders/${pony.riderEntryId}/${staff ? 'evidence' : 'mine'}`, {
        expectedRevision: pony.revision, dates: dates.filter(Boolean), completeHistory: complete,
        arrivalOn: arrivalOn || null, lastOtherVaccinationOn: otherDate || null, exceptionReview: exception, notes: notes.trim() || null,
      });
      onChange(data); setDirty(false); setSaved(true); setSeen(false);
    } catch (caught) { setError(message(caught, t('vaccinations.saveError'))); }
    finally { setBusy(false); }
  }
  async function inspect() {
    if (!evidence || !await confirmDialog({ title: t('vaccinations.confirmDecision'), message: `${t(decision === 'admitted' ? 'vaccinations.admitted' : decision === 'declined' ? 'vaccinations.declined' : 'vaccinations.reviewDecision')}: ${reason}`, confirmLabel: t('vaccinations.recordDecision') })) return;
    setBusy(true); setError(null);
    try {
      const { data } = await api.post<Pony>(`${base}/riders/${pony.riderEntryId}/inspection`, {
        expectedRevision: pony.revision, expectedSettingsRevision: settings.revision, expectedEventStartOn: settings.eventStartOn,
        evidenceId: evidence.id, decision, reason, passportInspected: seen,
      }); onChange(data); setSeen(false);
    } catch (caught) { setError(message(caught, t('vaccinations.saveError'))); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 py-3 text-sm">
    {pony.legacyInspection && <RefineNote>{t('vaccinations.legacy')}</RefineNote>}
    {pony.identityChanged && <Notice>{t('vaccinations.identityChanged')}</Notice>}
    {error && <Notice actionLabel={t('vaccinations.reload')} onAction={onReload}>{error}</Notice>}
    <RefineNote>{t(staff ? 'vaccinations.verified' : 'vaccinations.provisionalHelp')}</RefineNote>
    <fieldset disabled={busy || pony.identityChanged} className="min-w-0 space-y-3">
      <legend className="font-medium">{t('vaccinations.history')}</legend>
      {dates.map((date, index) => <div key={index} className="flex items-center gap-2">
        <label className="rf-fld min-w-0 flex-1">{t('vaccinations.date')} {index + 1}<input className="!text-base" type="date" value={date} onChange={e => edit(() => setDates(dates.map((d, i) => i === index ? e.target.value : d)))} /></label>
        <button className="rf-btn rf-btn-text" type="button" aria-label={`${t('vaccinations.remove')} ${t('vaccinations.date')} ${index + 1}`} onClick={() => edit(() => setDates(dates.filter((_, i) => i !== index)))}>{t('vaccinations.remove')}</button>
      </div>)}
      <button type="button" className="rf-btn w-full" disabled={dates.length >= 160} onClick={() => edit(() => setDates([...dates, '']))}>+ {t('vaccinations.addDate')}</button>
      <label className="rf-fld">{t('vaccinations.arrival')}<input className="!text-base" type="date" value={arrivalOn} onChange={e => edit(() => setArrival(e.target.value))} /></label>
      <label className="rf-fld">{t('vaccinations.otherDate')}<input className="!text-base" type="date" value={otherDate} onChange={e => edit(() => setOtherDate(e.target.value))} /></label>
      <RefineSwitchRow label={t('vaccinations.complete')} on={complete} disabled={busy || pony.identityChanged} onChange={v => edit(() => setComplete(v))} />
      <RefineSwitchRow label={t('vaccinations.exception')} on={exception} disabled={busy || pony.identityChanged} onChange={v => edit(() => setException(v))} />
      <label className="rf-fld">{t('vaccinations.notes')}<textarea className="!text-base" maxLength={1000} value={notes} onChange={e => edit(() => setNotes(e.target.value))} /></label>
      <button type="button" className="rf-btn rf-btn-primary" onClick={saveDates}>{t(staff ? 'vaccinations.recordDates' : 'vaccinations.checkDates')}</button>
      {saved && <span role="status" className="ml-2">{t('vaccinations.saved')}</span>}
    </fieldset>
    {pony.provisional && <details open={!pony.verified}><summary className="cursor-pointer py-2 font-medium">{t('vaccinations.provisional')}</summary><EvidenceResult evidence={pony.provisional} /></details>}
    {pony.verified && <details open><summary className="cursor-pointer py-2 font-medium">{t('vaccinations.verified')}</summary><EvidenceResult evidence={pony.verified} /></details>}
    {pony.inspection && <Notice tone={pony.inspection.current ? 'info' : 'problem'}>
      {t(pony.inspection.decision === 'admitted' ? 'vaccinations.admitted' : pony.inspection.decision === 'declined' ? 'vaccinations.declined' : 'vaccinations.reviewDecision')}: {pony.inspection.reason}
      {!pony.inspection.current && <p>{t('vaccinations.stale')}</p>}
    </Notice>}
    {staff && evidence && <fieldset disabled={busy || dirty || pony.identityChanged} className="space-y-3">
      <RefineSection title={t('vaccinations.inspection')} />
      <RefineSwitchRow label={t('vaccinations.passportSeen')} on={seen} disabled={busy || dirty || pony.identityChanged} onChange={setSeen} />
      <RefineChoiceRow label={t('vaccinations.decision')} value={decision} disabled={busy || dirty || pony.identityChanged}
        options={[{ value: 'review', label: t('vaccinations.reviewDecision') }, { value: 'admitted', label: t('vaccinations.admitted') }, { value: 'declined', label: t('vaccinations.declined') }]} onChange={setDecision} />
      <label className="rf-fld">{t('vaccinations.reason')}<textarea className="!text-base" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button type="button" className="rf-btn rf-btn-primary" disabled={!seen || !reason.trim() || dirty || busy} onClick={inspect}>{t('vaccinations.recordDecision')}</button>
    </fieldset>}
    {staff && pony.inspectionHistory.length > 1 && <details><summary>{t('vaccinations.inspectionHistory')}</summary><ul className="space-y-2">{pony.inspectionHistory.slice(1).map(i => <li key={i.id}>{i.inspectedAt} · {i.reason}</li>)}</ul></details>}
  </div>;
}
