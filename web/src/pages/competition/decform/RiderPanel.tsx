import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import { api } from '../../../api';
import { Field } from '../../auth/Field';
import { NumberField } from '../../../components/NumberField';
import { Notice } from '../../../components/Notice';
import { riderIssues, type DecRider } from '../../../lib/decForm';
import {
  asked, breach, limitText, NUMBER_FIELD, OPTIONAL, STANDARD_CONFIG, type DecFormConfig, type ExtraAnswers, type Requirement,
} from '../../../lib/decFormConfig';
import type { CertifiedHorseLookup, SavedRider } from '../../../types';
import '../../../components/sitePages.css';

export interface SavedRiderComboPatch {
  fullName: string;
  horseName: string | null;
}

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
  /** Takes this rider out of the slot. Shown as red text while a filled slot is open. */
  onRemove?: () => void;
  /** Updates a saved (Rider + Horse) combination on the club roster. */
  onEditSaved?: (id: number, patch: SavedRiderComboPatch) => Promise<void> | void;
  /** Deletes a saved (Rider + Horse) combination from the club roster. */
  onDeleteSaved?: (id: number) => Promise<void> | void;
  /** What this competition's dec form asks. The standard form when omitted. */
  config?: DecFormConfig;
  competitionId?: number;
}

const wide = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;

/** A label that says when an answer can be skipped. */
const labelOf = (text: string, requirement: Requirement) =>
  requirement === OPTIONAL ? <>{text} <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></> : text;

function splitSavedLabel(saved: SavedRider): { riderName: string; horseName: string } {
  const horse = (saved.horseName ?? '').trim();
  const suffix = horse ? ` — ${horse}` : '';
  const rawName = saved.fullName ?? '';
  if (suffix && rawName.endsWith(suffix)) {
    return { riderName: rawName.slice(0, -suffix.length).trim(), horseName: horse };
  }
  const dashIdx = rawName.indexOf(' — ');
  if (dashIdx >= 0 && !horse) {
    return { riderName: rawName.slice(0, dashIdx).trim(), horseName: rawName.slice(dashIdx + 3).trim() };
  }
  return { riderName: rawName.trim(), horseName: horse };
}

/**
 * The rider panel: a side panel on a laptop and a bottom sheet on a phone. It is the same markup both ways;
 * the classes decide where it sits. Pick a saved rider to fill every field, or type a new one.
 * It asks only what the competition's dec form setup asks for.
 */
export function RiderPanel({
  title, reserve, editing, form, choices, addLabel, ready, onChange, onPick, onCommit, onClose, onRemove,
  onEditSaved, onDeleteSaved, config = STANDARD_CONFIG, competitionId,
}: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [certLookup, setCertLookup] = useState<{ key: string; data: CertifiedHorseLookup } | null>(null);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [attemptedCommit, setAttemptedCommit] = useState(false);
  const [editingSavedId, setEditingSavedId] = useState<number | null>(null);
  const [savedEditDraft, setSavedEditDraft] = useState<{ riderName: string; horseName: string }>({ riderName: '', horseName: '' });
  const [deletedSavedIds, setDeletedSavedIds] = useState<number[]>([]);
  const [editedSavedMap, setEditedSavedMap] = useState<Record<number, SavedRiderComboPatch>>({});
  const slotKey = `${title}|${editing}`;
  // On a laptop the cursor goes straight to the name; on a phone that would only throw the keyboard up.
  useEffect(() => {
    setTouchedFields({});
    setAttemptedCommit(false);
    if (wide()) nameRef.current?.focus();
  }, [slotKey]);

  const passportQuery = form.extra.ponyPassport.trim();
  const ponyQuery = form.pony.trim();
  const ownerQuery = (form.ponyOwnerFullName ?? '').trim();
  const lookupKey = JSON.stringify([passportQuery, ponyQuery, ownerQuery, competitionId]);
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
          if (!cancelled && res?.data) setCertLookup({ key: lookupKey, data: res.data });
        })
        .catch(() => {
          if (!cancelled) setCertLookup(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canLookup, passportQuery, ponyQuery, ownerQuery, competitionId, lookupKey]);

  const activeCertLookup = canLookup && certLookup?.key === lookupKey ? certLookup.data : null;

  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }

  const touch = (key: string) => setTouchedFields((cur) => (cur[key] ? cur : { ...cur, [key]: true }));
  const showFieldError = (key: string, msg: string | undefined, currentValue: string): string | undefined => {
    if (!msg) return undefined;
    if (attemptedCommit || touchedFields[key] || currentValue.trim().length > 1) return msg;
    return undefined;
  };

  const issues = riderIssues(form, reserve, config);
  const extra = form.extra;
  const dobError = showFieldError('dob', issues.invalid.dob, form.dob);
  const birthYearError = showFieldError('birthYear', issues.invalid.birthYear, extra.birthYear);
  const heightError = showFieldError('height', issues.invalid.height, form.height);
  const ponyAgeError = showFieldError('ponyAge', issues.invalid.ponyAge, extra.ponyAge);
  const weightError = showFieldError('weight', issues.invalid.weight, `${extra.weightStone}${extra.weight}`);
  const emergencyError = showFieldError('emergency', issues.invalid.emergency, `${extra.emergencyName.trim()}${extra.emergencyPhone.trim()}`);
  const dobBad = !!dobError;
  const heightBad = !!heightError;
  const setExtra = (patch: Partial<ExtraAnswers>) => onChange({ extra: { ...extra, ...patch } });
  const setCustom = (id: string, value: string) => setExtra({ custom: { ...extra.custom, [id]: value } });

  const visibleChoices = choices
    .filter((c) => !deletedSavedIds.includes(c.id))
    .map((c) => {
      const localPatch = editedSavedMap[c.id];
      if (!localPatch) return c;
      const horse = localPatch.horseName?.trim() || null;
      return {
        ...c,
        horseName: horse,
        fullName: horse ? `${localPatch.fullName} — ${horse}` : localPatch.fullName,
      };
    });

  return (
    <>
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="fixed inset-0 z-40 bg-[rgb(var(--mg-overlay)/0.55)] lg:hidden" />
      <section aria-label={title} onKeyDown={keys}
        className="z-50 flex flex-col gap-4 bg-[rgb(var(--mg-surface))] p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[88vh] max-lg:overflow-y-auto max-lg:rounded-t-2xl max-lg:pb-[calc(20px+env(safe-area-inset-bottom))] max-lg:shadow-[0_-12px_32px_rgb(var(--mg-overlay)/0.25)] lg:sticky lg:top-6 lg:gap-[18px] lg:rounded-xl lg:border-[1.5px] lg:border-[rgb(var(--mg-heading))] lg:p-6">
        <div className="flex items-center gap-3">
          <h2 className="mg-display flex-1 text-[26px] font-bold leading-tight text-[rgb(var(--mg-heading))] lg:text-[28px]">{title}</h2>
          <button type="button" className="mg-icon-btn" aria-label="Close" onClick={onClose}><X aria-hidden="true" className="h-[18px] w-[18px]" /></button>
        </div>

        {!editing && visibleChoices.length > 0 && (
          <div className="flex flex-col gap-2">
            <span id="dec-saved-riders" className="text-sm font-semibold text-[rgb(var(--mg-body))]">Pick a saved rider</span>
            <div role="group" aria-labelledby="dec-saved-riders" className="flex flex-wrap gap-2">
              {visibleChoices.map((saved) => {
                const on = form.savedRiderId === saved.id;
                return (
                  <div key={saved.id} className="inline-flex items-center gap-1">
                    <button type="button" aria-pressed={on} onClick={() => onPick(saved)}
                      className={`min-h-11 rounded-full border-[1.5px] px-4 text-[15px] font-semibold ${on ? 'border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-button))] text-white' : 'border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-heading))]'}`}>
                      {saved.fullName}
                    </button>
                    <button
                      type="button"
                      className="mg-icon-btn !h-9 !w-9"
                      aria-label={`Edit saved rider ${saved.fullName}`}
                      title="Edit saved rider and pony"
                      onClick={() => {
                        const split = splitSavedLabel(saved);
                        setEditingSavedId(saved.id);
                        setSavedEditDraft(split);
                      }}
                    >
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="mg-icon-btn !h-9 !w-9 text-[rgb(var(--mg-elim))]"
                      aria-label={`Delete saved rider ${saved.fullName}`}
                      title="Delete saved rider and pony"
                      onClick={() => {
                        setDeletedSavedIds((cur) => [...cur, saved.id]);
                        if (editingSavedId === saved.id) setEditingSavedId(null);
                        if (form.savedRiderId === saved.id) onChange({ savedRiderId: null });
                        void onDeleteSaved?.(saved.id);
                      }}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            {editingSavedId !== null && (
              <div className="mt-1 flex flex-col gap-2 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Saved rider name">
                    {({ id }) => (
                      <div className="mg-field">
                        <input id={id} value={savedEditDraft.riderName} placeholder="Rider name" autoComplete="off"
                          onChange={(e) => setSavedEditDraft((cur) => ({ ...cur, riderName: e.target.value }))} />
                      </div>
                    )}
                  </Field>
                  <Field label="Saved pony name">
                    {({ id }) => (
                      <div className="mg-field">
                        <input id={id} value={savedEditDraft.horseName} placeholder="Pony name (optional)" autoComplete="off"
                          onChange={(e) => setSavedEditDraft((cur) => ({ ...cur, horseName: e.target.value }))} />
                      </div>
                    )}
                  </Field>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" className="mg-btn mg-btn-secondary !min-h-9 px-3 text-sm" onClick={() => setEditingSavedId(null)}>Cancel</button>
                  <button
                    type="button"
                    className="mg-btn mg-btn-primary !min-h-9 px-3 text-sm"
                    disabled={!savedEditDraft.riderName.trim()}
                    onClick={() => {
                      const patch: SavedRiderComboPatch = {
                        fullName: savedEditDraft.riderName.trim(),
                        horseName: savedEditDraft.horseName.trim() || null,
                      };
                      const idToUpdate = editingSavedId;
                      setEditedSavedMap((cur) => ({ ...cur, [idToUpdate]: patch }));
                      if (form.savedRiderId === idToUpdate) {
                        onChange({
                          fullName: patch.fullName,
                          ...(reserve ? {} : { pony: patch.horseName ?? '' }),
                        });
                      }
                      setEditingSavedId(null);
                      void onEditSaved?.(idToUpdate, patch);
                    }}
                  >
                    Save combo
                  </button>
                </div>
              </div>
            )}
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
                  onBlur={() => touch('fullName')}
                  onChange={(e) => onChange({ fullName: e.target.value, savedRiderId: null })} />
              </div>
            )}
          </Field>
          {asked(config.dob) && config.dobFormat === 0 && (
            <Field label={labelOf('Date of birth', config.dob)} error={dobError}>
              {({ id }) => (
                <div className="mg-field" data-invalid={dobBad}>
                  <input id={id} value={form.dob} placeholder="dd/mm/yyyy" inputMode="numeric" autoComplete="off" aria-invalid={dobBad}
                    onBlur={() => touch('dob')}
                    onChange={(e) => onChange({ dob: e.target.value.replace(/[^\d/]/g, '').slice(0, 10) })} />
                </div>
              )}
            </Field>
          )}
          {asked(config.dob) && config.dobFormat === 1 && (
            <Field label={labelOf('Year of birth', config.dob)} error={birthYearError}>
              {({ id }) => (
                <div className="mg-field" data-invalid={!!birthYearError}>
                  <NumberField id={id} value={extra.birthYear} placeholder="2014" autoComplete="off"
                    onBlur={() => touch('birthYear')}
                    onChange={(e) => setExtra({ birthYear: e.target.value })} />
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
                <input id={id} value={form.pony} placeholder="Pony's name" autoComplete="off"
                  onBlur={() => touch('pony')}
                  onChange={(e) => onChange({ pony: e.target.value })} />
              </div>
            )}
          </Field>
          {asked(config.ponyHeight) && (
            <Field label={reserve ? 'Height (hh) (optional)' : labelOf('Height (hh)', config.ponyHeight)} error={heightError}>
              {({ id }) => (
                <div className="mg-field" data-invalid={heightBad}>
                  <input id={id} value={form.height} placeholder="13.2" inputMode="decimal" autoComplete="off" aria-invalid={heightBad}
                    onBlur={() => touch('height')}
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
            <Notice
              tone={activeCertLookup.status === 'Expired' || activeCertLookup.status === 'TooRecent' ? 'problem' : 'info'}
              role="status"
              className="col-span-2"
            >
              <strong>
                {activeCertLookup.status === 'Certified' ? 'Certified ✓'
                  : activeCertLookup.status === 'Expired' ? 'Vaccine expired'
                    : activeCertLookup.status === 'TooRecent' ? '<7d rule' : 'Found'}
              </strong>
              {activeCertLookup.lastFluVaccineDate && <>
                {' '}
                {activeCertLookup.status === 'Expired'
                  ? `Last vaccine: ${activeCertLookup.lastFluVaccineDate ?? '—'} (expired) · Needs re-check`
                  : `Last vaccine: ${activeCertLookup.lastFluVaccineDate ?? '—'}${activeCertLookup.lastTetanusDate ? ` · Last tetanus: ${activeCertLookup.lastTetanusDate}` : ''}`}
              </>}
              {activeCertLookup.officialNotes && (
                <span className="mt-1 block font-medium">
                  {activeCertLookup.inspectorRole ?? 'Official'}{activeCertLookup.inspectedByName ? ` ${activeCertLookup.inspectedByName}` : ''}: “{activeCertLookup.officialNotes}”
                </span>
              )}
            </Notice>
          )}
          {!reserve && asked(config.ponyAge) && (
            <Field label={labelOf('Pony’s age (years)', config.ponyAge)} error={ponyAgeError}>
              {({ id }) => (
                <div className="mg-field" data-invalid={!!ponyAgeError}>
                  <NumberField id={id} value={extra.ponyAge} max={60} min={0} autoComplete="off"
                    onBlur={() => touch('ponyAge')}
                    onChange={(e) => setExtra({ ponyAge: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {asked(config.weight) && (
            <Field label={labelOf('Rider’s weight', config.weight)} error={weightError}>
              {({ id }) => config.weightUnit === 0 ? (
                <div className="mg-field" data-invalid={!!weightError}>
                  <NumberField id={id} decimal value={extra.weight} placeholder="32" autoComplete="off"
                    onBlur={() => touch('weight')}
                    onChange={(e) => setExtra({ weight: e.target.value })} />
                  <span className="mg-field-suffix">kg</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="mg-field min-w-0 flex-1" data-invalid={!!weightError}>
                    <NumberField id={id} aria-label="Weight, stone" value={extra.weightStone} placeholder="5" autoComplete="off"
                      onBlur={() => touch('weight')}
                      onChange={(e) => setExtra({ weightStone: e.target.value })} />
                    <span className="mg-field-suffix">st</span>
                  </div>
                  <div className="mg-field min-w-0 flex-1" data-invalid={!!weightError}>
                    <NumberField aria-label="Weight, pounds" decimal value={extra.weight} placeholder="4" autoComplete="off"
                      onBlur={() => touch('weight')}
                      onChange={(e) => setExtra({ weight: e.target.value })} />
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
            const invalid = showFieldError(`custom:${field.id}`, issues.invalid[`custom:${field.id}`], value);
            const hint = field.type === NUMBER_FIELD ? limitText(field) : '';
            return (
              <Field key={field.id} label={field.required ? field.label : labelOf(field.label, OPTIONAL)} error={invalid} className="col-span-2">
                {({ id }) => (
                  <>
                    <div className="mg-field" data-invalid={!!invalid}>
                      {field.type === NUMBER_FIELD
                        ? <NumberField id={id} decimal allowNegative value={value} autoComplete="off" onBlur={() => touch(`custom:${field.id}`)} onChange={(e) => setCustom(field.id, e.target.value)} />
                        : <input id={id} value={value} maxLength={300} autoComplete="off" onBlur={() => touch(`custom:${field.id}`)} onChange={(e) => setCustom(field.id, e.target.value)} />}
                      {field.type === NUMBER_FIELD && field.unit && <span className="mg-field-suffix">{field.unit}</span>}
                    </div>
                    {hint && !kind && <span className="text-[13px] text-[rgb(var(--mg-muted))]">{hint}</span>}
                    {kind && <Notice role="status">{field.label} is {kind === 'over' ? 'above the limit' : 'below the minimum'}.{hint ? ` ${hint}.` : ''} The organisers will see a flag; you can still send the form.</Notice>}
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
                  <div className="mg-field" data-invalid={!!emergencyError}>
                    <input id={id} value={extra.emergencyName} placeholder="Name" maxLength={120} autoComplete="off"
                      onBlur={() => touch('emergency')}
                      onChange={(e) => setExtra({ emergencyName: e.target.value })} />
                  </div>
                )}
              </Field>
              <Field label={labelOf('Their phone number', config.emergencyContact)}>
                {({ id }) => (
                  <div className="mg-field" data-invalid={!!emergencyError}>
                    <input id={id} type="tel" value={extra.emergencyPhone} maxLength={40} autoComplete="off"
                      onBlur={() => touch('emergency')}
                      onChange={(e) => setExtra({ emergencyPhone: e.target.value })} />
                  </div>
                )}
              </Field>
            </div>
            {emergencyError && <span role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{emergencyError}</span>}
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

        <div className="flex items-center gap-3">
          {editing && onRemove && <button type="button" className="sp-red shrink-0" onClick={onRemove}>{reserve ? 'Remove reserve' : 'Remove rider'}</button>}
          <button type="button" className="mg-btn mg-btn-primary min-w-0 flex-1" disabled={!ready} onClick={() => { setAttemptedCommit(true); onCommit(); }}>{addLabel}</button>
        </div>
      </section>
    </>
  );
}
