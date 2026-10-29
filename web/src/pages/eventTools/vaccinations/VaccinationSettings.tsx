import { useState } from 'react';
import { api } from '../../../api';
import { confirmDialog } from '../../../components/ConfirmDialog';
import { Notice } from '../../../components/Notice';
import { RefineChoiceRow, RefineNote, RefineSection, RefineSwitchRow } from '../../refine/Refine';
import { message, type Policy, type Settings, type VenueRule } from './types';
import { useVaccinationT } from './useVaccinationT';

export function VaccinationSettings({ settings, policies, base, onChange }: { settings: Settings; policies: Policy[]; base: string; onChange: (settings: Settings) => void }) {
  const t = useVaccinationT();
  const [venues, setVenues] = useState(settings.venueRules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policy = policies.find(p => p.id === settings.policyVersionId);
  async function save(patch: Partial<Settings>, confirm = false) {
    if (confirm && !await confirmDialog({ title: t('vaccinations.changeRules'), message: t('vaccinations.changeRulesBody'), confirmLabel: t('vaccinations.changeRulesAction') })) return;
    setBusy(true); setError(null);
    try {
      const { data } = await api.put<Settings>(`${base}/settings`, { ...settings, ...patch, expectedRevision: settings.revision });
      onChange(data); setVenues(data.venueRules);
    } catch (caught) { setError(message(caught, t('vaccinations.saveError'))); }
    finally { setBusy(false); }
  }
  function updateVenue(index: number, patch: Partial<VenueRule>) { setVenues(current => current.map((v, i) => i === index ? { ...v, ...patch } : v)); }
  function saveVenues(next = venues) {
    if (next.some(v => !v.name.trim() || !v.version.trim() || !v.sourceUrl.startsWith('https://') || !v.effectiveFrom || !v.effectiveUntil)) return;
    if (JSON.stringify(next) !== JSON.stringify(settings.venueRules)) void save({ venueRules: next });
  }
  return <div className="space-y-2">
    {error && <Notice>{error}</Notice>}
    <RefineChoiceRow label={t('vaccinations.policy')} value={settings.policyVersionId} options={policies.map(p => ({ value: p.id, label: `${p.organisation} · ${p.edition}` }))} disabled={busy} onChange={value => save({ policyVersionId: value }, true)} />
    <RefineChoiceRow label={t('vaccinations.basis')} value={settings.referenceDateBasis} options={[{ value: 'arrival', label: t('vaccinations.arrivalBasis') }, { value: 'event-start', label: t('vaccinations.startBasis') }]} disabled={busy} onChange={value => save({ referenceDateBasis: value }, true)} />
    {policy && <details><summary className="cursor-pointer py-2 font-medium">{policy.organisation} · {policy.edition}</summary>
      {!policy.automatic && <RefineNote>{t('vaccinations.manual')}</RefineNote>}
      <p className="font-medium">{t('vaccinations.mandatory')}</p><ul className="list-disc pl-5 text-sm">{policy.mandatory.map(x => <li key={x}>{x}</li>)}</ul>
      {policy.recommended.length > 0 && <><p className="mt-2 font-medium">{t('vaccinations.recommended')}</p><ul className="list-disc pl-5 text-sm">{policy.recommended.map(x => <li key={x}>{x}</li>)}</ul></>}
      {policy.sourceUrl?.startsWith('https://') && <a className="my-2 inline-block underline" href={policy.sourceUrl} target="_blank" rel="noreferrer">{t('vaccinations.source')} · {policy.verifiedOn}</a>}
    </details>}
    <details><summary className="cursor-pointer py-2 font-medium">{t('vaccinations.venue')}</summary>
      <RefineNote>{t('vaccinations.venueHelp')}</RefineNote>
      {venues.map((v, index) => <fieldset key={index} disabled={busy} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) saveVenues(); }} className="space-y-2 border-b border-[rgb(var(--mg-rule))] py-3">
        <RefineSection title={`${t('vaccinations.venue')} ${index + 1}`} />
        {(['name', 'version', 'sourceUrl', 'effectiveFrom', 'effectiveUntil'] as const).map(field => <label className="rf-fld" key={field}>{t(field === 'effectiveFrom' ? 'vaccinations.from' : field === 'effectiveUntil' ? 'vaccinations.until' : `vaccinations.${field}`)}
          <input className="!text-base" type={field.startsWith('effective') ? 'date' : field === 'sourceUrl' ? 'url' : 'text'} maxLength={field === 'sourceUrl' ? 500 : 100} value={v[field]} onChange={e => updateVenue(index, { [field]: e.target.value })} />
        </label>)}
        {(['maximumMonths', 'additionalDays', 'standDownDays'] as const).map(field => <label className="rf-fld" key={field}>{t(field === 'maximumMonths' ? 'vaccinations.months' : field === 'additionalDays' ? 'vaccinations.extraDays' : 'vaccinations.standDown')}
          <input className="!text-base" type="number" min={field === 'maximumMonths' ? 1 : 0} max={field === 'maximumMonths' ? 24 : field === 'additionalDays' ? 31 : 30} value={v[field] ?? ''} onChange={e => updateVenue(index, { [field]: e.target.value === '' && field === 'maximumMonths' ? null : Number(e.target.value) })} />
        </label>)}
        <RefineSwitchRow label={t('vaccinations.clearDays')} on={v.clearDays} disabled={busy} onChange={clearDays => updateVenue(index, { clearDays })} />
        <RefineSwitchRow label={t('vaccinations.venueManual')} on={v.manualReview} disabled={busy} onChange={manualReview => updateVenue(index, { manualReview })} />
        <button type="button" className="rf-btn rf-btn-text" onClick={() => { const next = venues.filter((_, i) => i !== index); setVenues(next); saveVenues(next); }}>{t('vaccinations.remove')}</button>
      </fieldset>)}
      <button type="button" className="rf-btn w-full" disabled={busy || venues.length >= 8} onClick={() => setVenues([...venues, { name: '', version: '', sourceUrl: '', effectiveFrom: settings.eventStartOn, effectiveUntil: settings.eventStartOn, maximumMonths: null, additionalDays: 0, standDownDays: 7, clearDays: false, manualReview: true }])}>+ {t('vaccinations.addVenue')}</button>
    </details>
  </div>;
}
