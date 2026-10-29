import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../../api';
import { isUnder18 } from '../../../lib/riderPrivacy';
import { Field } from '../../auth/Field';
import { useT } from '../../../i18n/LanguageContext';
import { NumberField } from '../../../components/NumberField';
import { Notice } from '../../../components/Notice';
import { parseDob, riderIssues, type DecRider } from '../../../lib/decForm';
import {
  asked, breach, limitText, NUMBER_FIELD, OPTIONAL, STANDARD_CONFIG, type DecFormConfig, type ExtraAnswers, type Requirement,
} from '../../../lib/decFormConfig';
import type { CertifiedHorseLookup, SavedRider } from '../../../types';
import { Sheet } from '../../../components/Sheet';
import { useIsDesktop } from '../../../hooks/useMediaQuery';
import '../../../components/sitePages.css';

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
  /** What this competition's dec form asks. The standard form when omitted. */
  config?: DecFormConfig;
  competitionId?: number;
}

const wide = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;

/**
 * The rider panel: a side panel on a laptop and the shared bottom sheet on a phone, around the same fields. Pick a saved rider to fill every field, or type a new one.
 * It asks only what the competition's dec form setup asks for.
 */
export function RiderPanel({ title, reserve, editing, form, choices, addLabel, ready, onChange, onPick, onCommit, onClose, onRemove, config = STANDARD_CONFIG, competitionId }: Props) {
  const t = useT();
  const desktop = useIsDesktop();
  const nameRef = useRef<HTMLInputElement>(null);
  /** A label that says when an answer can be skipped. */
  const labelOf = (text: string, requirement: Requirement) =>
    requirement === OPTIONAL ? <>{text} <span className="font-normal text-[rgb(var(--mg-muted))]">{t('entries.rider.optional')}</span></> : text;
  const [certLookup, setCertLookup] = useState<{ key: string; data: CertifiedHorseLookup } | null>(null);
  const slotKey = `${title}|${editing}`;
  // On a laptop the cursor goes straight to the name; on a phone that would only throw the keyboard up.
  useEffect(() => { (wide() ? nameRef.current : closeRef.current)?.focus(); }, [slotKey]);
  // Escape closes the panel wherever focus is, and focus goes back to what opened it.
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

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

  const issues = riderIssues(form, reserve, config);
  const dobBad = !!issues.invalid.dob;
  const heightBad = !!issues.invalid.height;
  const extra = form.extra;
  const setExtra = (patch: Partial<ExtraAnswers>) => onChange({ extra: { ...extra, ...patch } });
  const setCustom = (id: string, value: string) => setExtra({ custom: { ...extra.custom, [id]: value } });

  // The fields and buttons, shared by the phone sheet and the laptop side panel.
  const body = () => (
    <>
        {!editing && choices.length > 0 && (
          <div className="flex flex-col gap-2">
            <span id="dec-saved-riders" className="text-sm font-semibold text-[rgb(var(--mg-body))]">{t('entries.rider.pickSaved')}</span>
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
              <span className="h-px flex-1 bg-[rgb(var(--mg-rule))]" />{t('entries.rider.orNew')}<span className="h-px flex-1 bg-[rgb(var(--mg-rule))]" />
            </div>
          </div>
        )}

        <div className="sp-row">
          <span className="sp-grow"><span className="sp-t1">Show surname as initial only on public start lists and results</span><span className="sp-t2">For example, Oliver S.</span></span>
          <button type="button" role="switch" aria-label="Show surname as initial only on public start lists and results" aria-checked={form.useInitialOnly} className="rf-sw"
            onClick={() => onChange({ useInitialOnly: !form.useInitialOnly, privacyChoiceMade: true })}><span aria-hidden="true" /></button>
        </div>

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3">
          <Field label={t('entries.rider.rider')}>
            {({ id }) => (
              <div className="mg-field">
                <input id={id} ref={nameRef} value={form.fullName} placeholder={t('entries.rider.fullName')} autoComplete="off"
                  onChange={(e) => onChange({ fullName: e.target.value, savedRiderId: null })} />
              </div>
            )}
          </Field>
          {asked(config.dob) && config.dobFormat === 0 && (
            <Field label={labelOf(t('entries.rider.dob'), config.dob)} error={issues.invalid.dob}>
              {({ id }) => (
                <div className="mg-field" data-invalid={dobBad}>
                  <input id={id} value={form.dob} placeholder="dd/mm/yyyy" inputMode="numeric" autoComplete="off" aria-invalid={dobBad}
                    onChange={(e) => {
                      const dob = e.target.value.replace(/[^\d/]/g, '').slice(0, 10);
                      onChange({ dob, ...(!form.privacyChoiceMade && isUnder18(parseDob(dob)) ? { useInitialOnly: true } : {}) });
                    }} />
                </div>
              )}
            </Field>
          )}
          {asked(config.dob) && config.dobFormat === 1 && (
            <Field label={labelOf(t('entries.rider.yearOfBirth'), config.dob)} error={issues.invalid.birthYear}>
              {({ id }) => (
                <div className="mg-field" data-invalid={!!issues.invalid.birthYear}>
                  <NumberField id={id} value={extra.birthYear} placeholder="2014" autoComplete="off" onChange={(e) => {
                    const birthYear = e.target.value;
                    const year = Number(birthYear);
                    const age = new Date().getFullYear() - year;
                    onChange({ extra: { ...extra, birthYear }, ...(!form.privacyChoiceMade && /^\d{4}$/.test(birthYear) && age >= 0 && age <= 18 ? { useInitialOnly: true } : {}) });
                  }} />
                </div>
              )}
            </Field>
          )}
          {asked(config.dob) && config.dobFormat === 2 && (
            <Field label={labelOf(t('entries.rider.ageGroup'), config.dob)}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} value={extra.ageGroup} placeholder={t('entries.rider.ageGroupPlaceholder')} maxLength={30} autoComplete="off" onChange={(e) => setExtra({ ageGroup: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          <Field label={reserve ? t('entries.rider.ponyOptional') : t('entries.rider.pony')}>
            {({ id }) => (
              <div className="mg-field">
                <input id={id} value={form.pony} placeholder={t('entries.rider.ponyPlaceholder')} autoComplete="off" onChange={(e) => onChange({ pony: e.target.value })} />
              </div>
            )}
          </Field>
          {asked(config.ponyHeight) && (
            <Field label={reserve ? t('entries.rider.heightOptional') : labelOf(t('entries.rider.height'), config.ponyHeight)} error={issues.invalid.height}>
              {({ id }) => (
                <div className="mg-field" data-invalid={heightBad}>
                  <input id={id} value={form.height} placeholder="13.2" inputMode="decimal" autoComplete="off" aria-invalid={heightBad}
                    onChange={(e) => onChange({ height: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {!reserve && (
            <Field label={asked(config.ponyPassport) ? labelOf(t('entries.rider.passport'), config.ponyPassport) : t('entries.rider.equineId')}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} value={extra.ponyPassport} maxLength={80} placeholder={t('entries.rider.equineIdPlaceholder')} autoComplete="off" onChange={(e) => setExtra({ ponyPassport: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {!reserve && (
            <Field label={t('entries.rider.owner')}>
              {({ id }) => (
                <div className="mg-field">
                  <input id={id} value={form.ponyOwnerFullName ?? ''} maxLength={160} placeholder={t('entries.rider.ownerPlaceholder')} autoComplete="off" onChange={(e) => onChange({ ponyOwnerFullName: e.target.value })} />
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
                {activeCertLookup.status === 'Certified' ? t('entries.rider.certified')
                  : activeCertLookup.status === 'Expired' ? t('entries.rider.vaccineExpired')
                    : activeCertLookup.status === 'TooRecent' ? t('entries.rider.tooRecent') : t('entries.rider.found')}
              </strong>
              {activeCertLookup.lastFluVaccineDate && <>
                {' '}
                {activeCertLookup.status === 'Expired'
                  ? t('entries.rider.lastVaccineExpired', { date: activeCertLookup.lastFluVaccineDate ?? '—' })
                  : `${t('entries.rider.lastVaccine', { date: activeCertLookup.lastFluVaccineDate ?? '—' })}${activeCertLookup.lastTetanusDate ? t('entries.rider.lastTetanus', { date: activeCertLookup.lastTetanusDate }) : ''}`}
              </>}
              {activeCertLookup.officialNotes && (
                <span className="mt-1 block font-medium">
                  {activeCertLookup.inspectorRole ?? t('entries.rider.official')}{activeCertLookup.inspectedByName ? ` ${activeCertLookup.inspectedByName}` : ''}: “{activeCertLookup.officialNotes}”
                </span>
              )}
            </Notice>
          )}
          {!reserve && asked(config.ponyAge) && (
            <Field label={labelOf(t('entries.rider.ponyAge'), config.ponyAge)} error={issues.invalid.ponyAge}>
              {({ id }) => (
                <div className="mg-field" data-invalid={!!issues.invalid.ponyAge}>
                  <NumberField id={id} value={extra.ponyAge} max={60} min={0} autoComplete="off" onChange={(e) => setExtra({ ponyAge: e.target.value })} />
                </div>
              )}
            </Field>
          )}
          {asked(config.weight) && (
            <Field label={labelOf(t('entries.rider.weight'), config.weight)} error={issues.invalid.weight}>
              {({ id }) => config.weightUnit === 0 ? (
                <div className="mg-field" data-invalid={!!issues.invalid.weight}>
                  <NumberField id={id} decimal value={extra.weight} placeholder="32" autoComplete="off" onChange={(e) => setExtra({ weight: e.target.value })} />
                  <span className="mg-field-suffix">kg</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="mg-field min-w-0 flex-1" data-invalid={!!issues.invalid.weight}>
                    <NumberField id={id} aria-label={t('entries.rider.weightStone')} value={extra.weightStone} placeholder="5" autoComplete="off" onChange={(e) => setExtra({ weightStone: e.target.value })} />
                    <span className="mg-field-suffix">st</span>
                  </div>
                  <div className="mg-field min-w-0 flex-1" data-invalid={!!issues.invalid.weight}>
                    <NumberField aria-label={t('entries.rider.weightPounds')} decimal value={extra.weight} placeholder="4" autoComplete="off" onChange={(e) => setExtra({ weight: e.target.value })} />
                    <span className="mg-field-suffix">lb</span>
                  </div>
                </div>
              )}
            </Field>
          )}
          {asked(config.membershipNumber) && (
            <Field label={labelOf(t('entries.rider.membership'), config.membershipNumber)}>
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
                    {kind && <Notice role="status">{[t(kind === 'over' ? 'entries.rider.over' : 'entries.rider.under', { label: field.label }), hint ? `${hint}.` : '', t('entries.rider.flagNote')].filter(Boolean).join(' ')}</Notice>}
                  </>
                )}
              </Field>
            );
          })}
        </div>

        {asked(config.emergencyContact) && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              <Field label={labelOf(t('entries.rider.emergency'), config.emergencyContact)}>
                {({ id }) => (
                  <div className="mg-field" data-invalid={!!issues.invalid.emergency}>
                    <input id={id} value={extra.emergencyName} placeholder={t('entries.rider.emergencyName')} maxLength={120} autoComplete="off" onChange={(e) => setExtra({ emergencyName: e.target.value })} />
                  </div>
                )}
              </Field>
              <Field label={labelOf(t('entries.rider.theirPhone'), config.emergencyContact)}>
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

        {asked(config.medicalNotes) && <p id="medical-privacy-note" className="sp-note">Shared with the people authorised to manage this team’s declaration and the event organisers, who can pass it to first-aiders when needed. Deleted automatically after the event: after 7 days, or 14 days from the start if no end date is set.</p>}
        {asked(config.medicalNotes) && (
          <Field label={labelOf(t('entries.rider.medical'), config.medicalNotes)}>
            {({ id }) => (
              <div className="mg-field !items-start">
                <textarea aria-describedby="medical-privacy-note" id={id} value={extra.medicalNotes} maxLength={1000} placeholder={t('entries.rider.medicalPlaceholder')} onChange={(e) => setExtra({ medicalNotes: e.target.value })} />
              </div>
            )}
          </Field>
        )}

        {!ready && issues.missing.length > 0 && form.fullName.trim() !== '' && (
          <p className="text-sm text-[rgb(var(--mg-muted))]">{t('entries.rider.stillNeeded', { list: issues.missing.join(', ') })}</p>
        )}

        <div className="flex items-center gap-3">
          {editing && onRemove && <button type="button" className="sp-red shrink-0" onClick={onRemove}>{reserve ? t('entries.rider.removeReserve') : t('entries.rider.removeRider')}</button>}
          <button type="button" className="mg-btn mg-btn-primary min-w-0 flex-1" disabled={!ready} onClick={onCommit}>{addLabel}</button>
        </div>
    </>
  );

  if (!desktop) {
    return (
      <Sheet title={title} onClose={onClose}>
        {() => <div role="region" aria-label={title} className="flex flex-col gap-4">{body()}</div>}
      </Sheet>
    );
  }

  return (
    <section aria-label={title}
      className="z-50 flex flex-col gap-4 bg-[rgb(var(--mg-surface))] p-4 lg:sticky lg:top-6 lg:gap-[18px] lg:rounded-xl lg:border-[1.5px] lg:border-[rgb(var(--mg-heading))] lg:p-6">
      <div className="flex items-center gap-3">
        <h2 className="mg-display flex-1 text-[26px] font-bold leading-tight text-[rgb(var(--mg-heading))] lg:text-[28px]">{title}</h2>
        <button ref={closeRef} type="button" className="mg-icon-btn" aria-label={t('common.close')} onClick={onClose}><X aria-hidden="true" className="h-[18px] w-[18px]" /></button>
      </div>
      {body()}
    </section>
  );
}
