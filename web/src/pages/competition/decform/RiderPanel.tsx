import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '../../../api';
import { Field } from '../../auth/Field';
import { NumberField } from '../../../components/NumberField';
import { riderIssues, type DecRider } from '../../../lib/decForm';
import {
  asked, breach, breachWarning, limitText, NUMBER_FIELD, OPTIONAL, STANDARD_CONFIG, type DecFormConfig, type ExtraAnswers, type Requirement,
} from '../../../lib/decFormConfig';
import type { CertifiedHorseLookup, SavedRider } from '../../../types';

interface Props {
  title: string;
  /** A reserve may have pony details, but they are optional. */
  reserve: boolean;
  editing: boolean;
  form: DecRider;
  choices: SavedRider[];
  addLabel: string;
  ready: boolean;
  onChange: (patch: Partial<DecRider>) => void;
  onPick: (saved: SavedRider) => void;
  onCommit: () => void;
  onClose: () => void;
  /** What this competition's dec form asks. The standard form when omitted. */
  config?: DecFormConfig;
  competitionId?: number;
}

const wide = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;

/** A label that says when an answer can be skipped. */
const labelOf = (text: string, requirement: Requirement) =>
  requirement === OPTIONAL ? <>{text} <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></> : text;

/**
 * The rider panel: a side panel on a laptop and a bottom sheet on a phone. It is the same markup both ways;
 * the classes decide where it sits. Pick a saved rider to fill every field, or type a new one.
 * It asks only what the competition's dec form setup asks for.
 */
export function RiderPanel({ title, reserve, editing, form, choices, addLabel, ready, onChange, onPick, onCommit, onClose, config = STANDARD_CONFIG, competitionId }: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [certLookup, setCertLookup] = useState<CertifiedHorseLookup | null>(null);
  const slotKey = `${title}|${editing}`;
  // On a laptop the cursor goes straight to the name; on a phone that would only throw the keyboard up.
  useEffect(() => { if (wide()) nameRef.current?.focus(); }, [slotKey]);

  const passportQuery = form.extra.ponyPassport.trim();
  const ponyQuery = form.pony.trim();
  const ownerQuery = (form.ponyOwnerFullName ?? '').trim();
  const canLookup = !reserve && (passportQuery !== '' || (ponyQuery !== '' && ownerQuery !== ''));

  useEffect(() => {
    if (!canLookup) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!api?.get) return;
      Promise.resolve(
        api.get<CertifiedHorseLookup>('/event-tools/certified-horses/lookup', {
          params: {
            passportCode: passportQuery || undefined,
            ponyName: ponyQuery || undefined,
            ownerFullName: ownerQuery || undefined,
            competitionId,
          },
        }),
      )
        .then((res) => {
          if (!cancelled && res?.data) setCertLookup(res.data);
        })
        .catch(() => {
          if (!cancelled) setCertLookup(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canLookup, passportQuery, ponyQuery, ownerQuery, competitionId]);

  const activeCertLookup = canLookup ? certLookup : null;

  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }

  const issues = riderIssues(form, reserve, config);
  const dobBad = !!issues.invalid.dob;
  const heightBad = !!issues.invalid.height;
  const extra = form.extra;
  const setExtra = (patch: Partial<ExtraAnswers>) => onChange({ extra: { ...extra, ...patch } });
  const setCustom = (id: string, value: string) => setExtra({ custom: { ...extra.custom, [id]: value } });

  return (
    <>
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="fixed inset-0 z-40 bg-[rgb(var(--mg-overlay)/0.55)] lg:hidden" />
      <section aria-label={title} onKeyDown={keys}
        className="z-50 flex flex-col gap-4 bg-[rgb(var(--mg-surface))] p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[88vh] max-lg:overflow-y-auto max-lg:rounded-t-2xl max-lg:pb-[calc(20px+env(safe-area-inset-bottom))] max-lg:shadow-[0_-12px_32px_rgb(var(--mg-overlay)/0.25)] lg:sticky lg:top-6 lg:gap-[18px] lg:rounded-xl lg:border-[1.5px] lg:border-[rgb(var(--mg-heading))] lg:p-6">
        <div className="flex items-center gap-3">
          <h2 className="mg-display flex-1 text-[26px] font-bold leading-tight text-[rgb(var(--mg-heading))] lg:text-[28px]">{title}</h2>
          <button type="button" className="mg-icon-btn" aria-label="Close" onClick={onClose}><X aria-hidden="true" className="h-[18px] w-[18px]" /></button>
        </div>

        {!editing && choices.length > 0 && (
          <div className="flex flex-col gap-2">
            <span id="dec-saved-riders" className="text-sm font-semibold text-[rgb(var(--mg-body))]">Pick a saved rider</span>
            <div role="group" aria-labelledby="dec-saved-riders" className="flex flex-wrap gap-2">
              {choices.map((saved) => {
                const on = form.savedRiderId === saved.id;
                return (
                  <button key={saved.id} type="button" aria-pressed={on} onClick={() => onPick(saved)}
                    className={`min-h-11 rounded-full border-[1.5px] px-4 text-[15px] font-semibold ${on ? 'border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-button))] text-white' : 'border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-heading))]'}`}>
                    {saved.fullName}
                  </button>
                );
              })}
            </div>
            <div aria-hidden="true" className="mt-1 flex items-center gap-2.5 text-[13px] font-medium text-[rgb(var(--mg-muted))]">
              <span className="h-px flex-1 bg-[rgb(var(--mg-rule))]" />or type a new one<span className="h-px flex-1 bg-[rgb(var(--mg-rule))]" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3">
          <Field label="Rider">
            {({ id }) => (
              <div className="mg-field">
                <input id={id} ref={nameRef} value={form.fullName} placeholder="Full name" autoComplete="off"
                  onChange={(e) => onChange({ fullName: e.target.value, savedRiderId: null })} />
              </div>
            )}
          </Field>
          {asked(config.dob) && config.dobFormat === 0 && (
            <Field label={labelOf('Date of birth', config.dob)} error={issues.invalid.dob}>
              {({ id }) => (
                <div className="mg-field" data-invalid={dobBad}>
                  <input id={id} value={form.dob} placeholder="dd/mm/yyyy" inputMode="numeric" autoComplete="off" aria-invalid={dobBad}
                    onChange={(e) => onChange({ dob: e.target.value.replace(/[^\d/]/g, '').slice(0, 10) })} />
                </div>
              )}
            </Field>
          )}
          {asked(config.dob) && config.dobFormat === 1 && (
            <Field label={labelOf('Year of birth', config.dob)} error={issues.invalid.birthYear}>
              {({ id }) => (
                <div className="mg-field" data-invalid={!!issues.invalid.birthYear}>
                  <NumberField id={id} value={extra.birthYear} placeholder="2014" autoComplete="off" onChange={(e) => setExtra({ birthYear: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {asked(config.dob) && config.dobFormat === 2 && (
            <Field label={labelOf('Age group', config.dob)}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} value={extra.ageGroup} placeholder="e.g. U12" maxLength={30} autoComplete="off" onChange={(e) => setExtra({ ageGroup: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          <Field label={reserve ? "Pony (optional)" : "Pony"}>
            {({ id }) => (
              <div className="mg-field">
                <input id={id} value={form.pony} placeholder="Pony's name" autoComplete="off" onChange={(e) => onChange({ pony: e.target.value })} />
              </div>
            )}
          </Field>
          {asked(config.ponyHeight) && (
            <Field label={reserve ? 'Height (hh) (optional)' : labelOf('Height (hh)', config.ponyHeight)} error={issues.invalid.height}>
              {({ id }) => (
                <div className="mg-field" data-invalid={heightBad}>
                  <input id={id} value={form.height} placeholder="13.2" inputMode="decimal" autoComplete="off" aria-invalid={heightBad}
                    onChange={(e) => onChange({ height: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {!reserve && (
            <Field label={asked(config.ponyPassport) ? labelOf('Pony passport or ID number', config.ponyPassport) : 'Equine ID / UELN code'}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} value={extra.ponyPassport} maxLength={80} placeholder="e.g. GBR-826001234 (optional)" autoComplete="off" onChange={(e) => setExtra({ ponyPassport: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {!reserve && (
            <Field label="Pony owner’s full name">
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} value={form.ponyOwnerFullName ?? ''} maxLength={160} placeholder="Owner's full name (optional)" autoComplete="off" onChange={(e) => onChange({ ponyOwnerFullName: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {!reserve && activeCertLookup?.found && (
            <div role="status" className="col-span-2 rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface-muted))]/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {activeCertLookup.status === 'Certified' && (
                  <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                    Certified ✓
                  </span>
                )}
                {activeCertLookup.status === 'Expired' && (
                  <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                    Vaccine expired
                  </span>
                )}
                {activeCertLookup.status === 'TooRecent' && (
                  <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-700 dark:text-rose-300">
                    &lt;7d rule
                  </span>
                )}
                <span className="text-[rgb(var(--mg-body))]">
                  {activeCertLookup.status === 'Expired'
                    ? `Last vaccine: ${activeCertLookup.lastFluVaccineDate ?? '—'} (expired) · Needs re-check`
                    : `Last vaccine: ${activeCertLookup.lastFluVaccineDate ?? '—'}${activeCertLookup.lastTetanusDate ? ` · Last tetanus: ${activeCertLookup.lastTetanusDate}` : ''}`}
                </span>
              </div>
              {activeCertLookup.officialNotes && (
                <p className="mt-1 text-[rgb(var(--mg-muted))]">
                  {activeCertLookup.inspectorRole ?? 'Official'}{activeCertLookup.inspectedByName ? ` ${activeCertLookup.inspectedByName}` : ''}: “{activeCertLookup.officialNotes}”
                </p>
              )}
            </div>
          )}
          {!reserve && asked(config.ponyAge) && (
            <Field label={labelOf('Pony’s age (years)', config.ponyAge)} error={issues.invalid.ponyAge}>
              {({ id }) => (
                <div className="mg-field" data-invalid={!!issues.invalid.ponyAge}>
                  <NumberField id={id} value={extra.ponyAge} max={60} min={0} autoComplete="off" onChange={(e) => setExtra({ ponyAge: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {asked(config.weight) && (
            <Field label={labelOf('Rider’s weight', config.weight)} error={issues.invalid.weight}>
              {({ id }) => config.weightUnit === 0 ? (
                <div className="mg-field" data-invalid={!!issues.invalid.weight}>
                  <NumberField id={id} decimal value={extra.weight} placeholder="32" autoComplete="off" onChange={(e) => setExtra({ weight: e.target.value })} />
                  <span className="mg-field-suffix">kg</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="mg-field min-w-0 flex-1" data-invalid={!!issues.invalid.weight}>
                    <NumberField id={id} aria-label="Weight, stone" value={extra.weightStone} placeholder="5" autoComplete="off" onChange={(e) => setExtra({ weightStone: e.target.value })} />
                    <span className="mg-field-suffix">st</span>
                  </div>
                  <div className="mg-field min-w-0 flex-1" data-invalid={!!issues.invalid.weight}>
                    <NumberField aria-label="Weight, pounds" decimal value={extra.weight} placeholder="4" autoComplete="off" onChange={(e) => setExtra({ weight: e.target.value })} />
                    <span className="mg-field-suffix">lb</span>
                  </div>
                </div>
              )}
            </Field>
          )}
          {asked(config.membershipNumber) && (
            <Field label={labelOf('Membership number', config.membershipNumber)}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} value={extra.membershipNumber} maxLength={60} autoComplete="off" onChange={(e) => setExtra({ membershipNumber: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {config.customFields.map((field) => {
            const value = extra.custom[field.id] ?? '';
            const kind = breach(field, value);
            const invalid = issues.invalid[`custom:${field.id}`];
            const hint = field.type === NUMBER_FIELD ? limitText(field) : '';
            return (
              <Field key={field.id} label={field.required ? field.label : labelOf(field.label, OPTIONAL)} error={invalid} className="col-span-2">
                {({ id }) => (
                  <>
                    <div className="mg-field" data-invalid={!!invalid}>
                      {field.type === NUMBER_FIELD
                        ? <NumberField id={id} decimal allowNegative value={value} autoComplete="off" onChange={(e) => setCustom(field.id, e.target.value)} />
                        : <input id={id} value={value} maxLength={300} autoComplete="off" onChange={(e) => setCustom(field.id, e.target.value)} />}
                      {field.type === NUMBER_FIELD && field.unit && <span className="mg-field-suffix">{field.unit}</span>}
                    </div>
                    {hint && !kind && <span className="text-[13px] text-[rgb(var(--mg-muted))]">{hint}</span>}
                    {kind && <p role="status" className="mg-flag">{breachWarning(kind)}{hint ? `. ${hint}.` : ''}</p>}
                  </>
                )}
              </Field>
            );
          })}
        </div>

        {asked(config.emergencyContact) && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              <Field label={labelOf('Emergency contact', config.emergencyContact)}>
                {({ id }) => (
                  <div className="mg-field" data-invalid={!!issues.invalid.emergency}>
                    <input id={id} value={extra.emergencyName} placeholder="Name" maxLength={120} autoComplete="off" onChange={(e) => setExtra({ emergencyName: e.target.value })} />
                  </div>
                )}
              </Field>
              <Field label={labelOf('Their phone number', config.emergencyContact)}>
                {({ id }) => (
                  <div className="mg-field" data-invalid={!!issues.invalid.emergency}>
                    <input id={id} type="tel" value={extra.emergencyPhone} maxLength={40} autoComplete="off" onChange={(e) => setExtra({ emergencyPhone: e.target.value })} />
                  </div>
                )}
              </Field>
            </div>
            {issues.invalid.emergency && <span role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{issues.invalid.emergency}</span>}
          </div>
        )}

        {asked(config.medicalNotes) && (
          <Field label={labelOf('Medical notes', config.medicalNotes)}>
            {({ id }) => (
              <div className="mg-field !items-start">
                <textarea id={id} value={extra.medicalNotes} maxLength={1000} placeholder="Anything the first aider should know" onChange={(e) => setExtra({ medicalNotes: e.target.value })} />
              </div>
            )}
          </Field>
        )}

        {!ready && issues.missing.length > 0 && form.fullName.trim() !== '' && (
          <p className="text-sm text-[rgb(var(--mg-muted))]">Still needed: {issues.missing.join(', ')}.</p>
        )}

        <button type="button" className="mg-btn mg-btn-primary w-full" disabled={!ready} onClick={onCommit}>{addLabel}</button>
      </section>
    </>
  );
}
