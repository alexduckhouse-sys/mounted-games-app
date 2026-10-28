import { useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import type { MessageKey } from '../../i18n/en';
import type { Translate } from '../../i18n/translate';
import { Plus, X } from 'lucide-react';
import { api } from '../../api';
import { apiErrorMessage } from '../../lib/apiError';
import { NumberField } from '../../components/NumberField';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { SelectField } from '../../components/SelectField';
import {
  asked, BASIC_CONFIG, MAX_CUSTOM_FIELDS, newFieldId, NUMBER_FIELD, parseConfigResponse, STANDARD_CONFIG, TEXT_FIELD,
  type CustomField, type DecFormConfig, type DecFormConfigResponse, type Requirement,
} from '../../lib/decFormConfig';
import { Field } from '../auth/Field';

const REQUIREMENT_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: '0', label: 'admin.format.off' },
  { value: '1', label: 'admin.format.dec.optional' },
  { value: '2', label: 'admin.format.dec.required' },
];

type PartKey = 'trainerPhone' | 'bib' | 'dob' | 'weight' | 'ponyHeight' | 'ponyPassport' | 'ponyAge' | 'membershipNumber' | 'emergencyContact' | 'medicalNotes';

interface Part { key: PartKey; label: MessageKey; hint?: MessageKey }

const GROUPS: { title: MessageKey; parts: Part[] }[] = [
  {
    title: 'admin.format.dec.group.team',
    parts: [
      { key: 'trainerPhone', label: 'admin.format.dec.part.trainerPhone', hint: 'admin.format.dec.part.trainerPhoneHint' },
      { key: 'bib', label: 'admin.format.dec.part.bib', hint: 'admin.format.dec.part.bibHint' },
    ],
  },
  {
    title: 'admin.format.dec.group.rider',
    parts: [
      { key: 'dob', label: 'admin.format.dec.part.dob', hint: 'admin.format.dec.part.dobHint' },
      { key: 'weight', label: 'admin.format.dec.part.weight', hint: 'admin.format.dec.part.weightHint' },
    ],
  },
  {
    title: 'admin.format.dec.group.pony',
    parts: [
      { key: 'ponyHeight', label: 'admin.format.dec.part.ponyHeight', hint: 'admin.format.dec.part.ponyHeightHint' },
      { key: 'ponyPassport', label: 'admin.format.dec.part.ponyPassport' },
      { key: 'ponyAge', label: 'admin.format.dec.part.ponyAge', hint: 'admin.format.dec.part.ponyAgeHint' },
    ],
  },
  {
    title: 'admin.format.dec.group.safety',
    parts: [
      { key: 'membershipNumber', label: 'admin.format.dec.part.membershipNumber' },
      { key: 'emergencyContact', label: 'admin.format.dec.part.emergencyContact', hint: 'admin.format.dec.part.emergencyContactHint' },
      { key: 'medicalNotes', label: 'admin.format.dec.part.medicalNotes', hint: 'admin.format.dec.part.medicalNotesHint' },
    ],
  },
];

/** The same checks as `configProblem` in lib/decFormConfig, worded in the chosen language. */
function problemText(t: Translate, config: DecFormConfig): string | null {
  if (config.customFields.length > MAX_CUSTOM_FIELDS) return t('admin.format.dec.problem.tooMany', { max: MAX_CUSTOM_FIELDS });
  for (const f of config.customFields) {
    if (!f.label.trim()) return t('admin.format.dec.problem.noName');
    if (f.type === NUMBER_FIELD && f.min != null && f.max != null && f.min > f.max) return t('admin.format.dec.problem.minMax', { name: f.label.trim() });
  }
  return null;
}

interface Props {
  competitionId: number;
  /** Turn off the controls (for people who can't change the setup). */
  readOnly?: boolean;
}

/**
 * The organiser's setup for a competition's dec form: which parts to add to the basic form, and their own extra
 * questions. It loads and saves on its own (`/competitions/:id/dec-form-config`), so it can sit in the competition
 * editor, the Format page or a wizard step without any wiring.
 */
export function DecFormConfigEditor({ competitionId, readOnly = false }: Props) {
  const { t } = useLanguage();
  const [saved, setSaved] = useState<DecFormConfigResponse | null>(null);
  const [draft, setDraft] = useState<DecFormConfig>(STANDARD_CONFIG);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/competitions/${competitionId}/dec-form-config`);
        const parsed = parseConfigResponse(data);
        if (cancelled) return;
        if (!parsed) { setLoadFailed(true); return; }
        setSaved(parsed);
        setDraft(parsed.config);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [competitionId, attempt]);

  if (loadFailed) return <Notice role={null} actionLabel={t('common.tryAgain')} onAction={() => { setLoadFailed(false); setAttempt((n) => n + 1); }}>{t('admin.format.dec.loadFailed')}</Notice>;
  if (!saved) return <p className="text-sm text-[rgb(var(--mg-muted))]">{t('admin.format.dec.loading')}</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.config);
  const problem = problemText(t, draft);
  const change = (patch: Partial<DecFormConfig>) => { setDraft((cur) => ({ ...cur, ...patch })); setSaveError(null); };
  const setPart = (key: PartKey, value: Requirement) => change({ [key]: value } as Partial<DecFormConfig>);

  function setField(id: string, patch: Partial<CustomField>) {
    change({ customFields: draft.customFields.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  }

  function addField() {
    change({ customFields: [...draft.customFields, { id: newFieldId(draft.customFields), label: '', type: TEXT_FIELD, required: false, min: null, max: null, unit: null }] });
  }

  async function save() {
    if (readOnly || busy || problem) return;
    setBusy(true);
    setSaveError(null);
    try {
      const { data } = await api.put(`/competitions/${competitionId}/dec-form-config`, draft);
      const parsed = parseConfigResponse(data);
      if (parsed) { setSaved(parsed); setDraft(parsed.config); }
      toast.show(t('admin.format.dec.saved'));
    } catch (err) {
      setSaveError(apiErrorMessage(err, t('admin.format.dec.saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5 text-[15px] text-[rgb(var(--mg-body))]">
        <p>
          {t('admin.format.dec.alwaysIncluded')}
          {saved.isStandard && ` ${t('admin.format.dec.untilSaved')}`}
        </p>
        <p className="text-sm text-[rgb(var(--mg-muted))]">
          {t('admin.format.dec.privacy')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="mg-btn mg-btn-secondary !min-h-11" disabled={readOnly} onClick={() => change({ ...BASIC_CONFIG, customFields: draft.customFields })}>
          {t('admin.format.dec.basics')}
        </button>
        <button type="button" className="mg-btn mg-btn-secondary !min-h-11" disabled={readOnly} onClick={() => change({ ...STANDARD_CONFIG, customFields: draft.customFields })}>
          {t('admin.format.dec.standard')}
        </button>
      </div>

      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-3 border-0 p-0">
          <legend className="mg-display mb-1 text-[17px] font-bold uppercase tracking-[0.03em] text-[rgb(var(--mg-heading))]">{t(group.title)}</legend>
          {group.parts.map((part) => (
            <div key={part.key} className="flex flex-col gap-2 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-[rgb(var(--mg-ink))]">{t(part.label)}</div>
                  {part.hint && <div className="text-[13px] text-[rgb(var(--mg-muted))]">{t(part.hint)}</div>}
                </div>
                <SelectField aria-label={t('admin.format.dec.partAria', { group: t(group.title), part: t(part.label) })} disabled={readOnly} value={String(draft[part.key])} options={REQUIREMENT_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
                  onChange={(e) => setPart(part.key, Number(e.target.value) as Requirement)} />
              </div>
              {part.key === 'dob' && asked(draft.dob) && (
                <Field label={t('admin.format.dec.whatToAsk')}>
                  {({ id }) => (
                    <SelectField id={id} disabled={readOnly} value={String(draft.dobFormat)}
                      options={[{ value: '0', label: t('admin.format.dec.dobFull') }, { value: '1', label: t('admin.format.dec.dobYear') }, { value: '2', label: t('admin.format.dec.dobGroup') }]}
                      onChange={(e) => change({ dobFormat: Number(e.target.value) as 0 | 1 | 2 })} />
                  )}
                </Field>
              )}
              {part.key === 'weight' && asked(draft.weight) && (
                <Field label={t('admin.format.dec.showWeightIn')}>
                  {({ id }) => (
                    <SelectField id={id} disabled={readOnly} value={String(draft.weightUnit)}
                      options={[{ value: '0', label: t('admin.format.dec.kg') }, { value: '1', label: t('admin.format.dec.stone') }]}
                      onChange={(e) => change({ weightUnit: Number(e.target.value) as 0 | 1 })} />
                  )}
                </Field>
              )}
            </div>
          ))}
        </fieldset>
      ))}

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="mg-display mb-1 text-[17px] font-bold uppercase tracking-[0.03em] text-[rgb(var(--mg-heading))]">{t('admin.format.dec.ownQuestions')}</legend>
        <p className="text-sm text-[rgb(var(--mg-muted))]">
          {t('admin.format.dec.ownQuestionsNote')}
        </p>
        {draft.customFields.map((field, index) => (
          <CustomFieldCard key={field.id} field={field} index={index} readOnly={readOnly}
            onChange={(patch) => setField(field.id, patch)}
            onRemove={() => change({ customFields: draft.customFields.filter((f) => f.id !== field.id) })} />
        ))}
        <button type="button" className="mg-btn mg-btn-secondary !min-h-11 self-start" disabled={readOnly || draft.customFields.length >= MAX_CUSTOM_FIELDS} onClick={addField}>
          <Plus aria-hidden="true" className="h-4 w-4" /> {t('admin.format.dec.addQuestion')}
        </button>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Notice tone="info" role={null}>
          {t('admin.format.dec.appliesFromNow')}
          {saved.formsSubmitted > 0 && ` ${t('admin.format.dec.alreadyIn', { count: saved.formsSubmitted })}`}
        </Notice>
        {problem && <Notice>{problem}</Notice>}
        {saveError && <Notice actionLabel={t('common.tryAgain')} onAction={() => { void save(); }} actionDisabled={busy}>{saveError}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="mg-btn mg-btn-primary !min-h-12" disabled={readOnly || busy || !!problem || (!dirty && !saved.isStandard)} onClick={() => { void save(); }}>
            {busy ? t('admin.format.dec.saving') : saved.isStandard && !dirty ? t('admin.format.dec.saveSetup') : t('admin.format.dec.saveForm')}
          </button>
          {toast.node}
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  field: CustomField;
  index: number;
  readOnly: boolean;
  onChange: (patch: Partial<CustomField>) => void;
  onRemove: () => void;
}

function CustomFieldCard({ field, index, readOnly, onChange, onRemove }: CardProps) {
  const { t } = useLanguage();
  const name = field.label.trim() || t('admin.format.dec.questionN', { n: index + 1 });
  const number = field.type === NUMBER_FIELD;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] p-3">
      <div className="flex items-end gap-2">
        <Field label={t('admin.format.dec.question')} className="min-w-0 flex-1">
          {({ id }) => (
            <div className="mg-field">
              <input id={id} value={field.label} maxLength={80} placeholder={t('admin.format.dec.questionPlaceholder')} disabled={readOnly} onChange={(e) => onChange({ label: e.target.value })} />
            </div>
          )}
        </Field>
        <button type="button" className="mg-icon-btn" aria-label={t('admin.format.dec.removeQuestion', { name })} disabled={readOnly} onClick={onRemove}><X aria-hidden="true" className="h-[18px] w-[18px]" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('admin.format.dec.answerIs')}>
          {({ id }) => (
            <SelectField id={id} disabled={readOnly} value={String(field.type)} options={[{ value: '0', label: t('admin.format.dec.text') }, { value: '1', label: t('admin.format.dec.number') }]}
              onChange={(e) => onChange(e.target.value === '1' ? { type: NUMBER_FIELD } : { type: TEXT_FIELD, min: null, max: null, unit: null })} />
          )}
        </Field>
        <Field label={t('admin.format.dec.mustAnswer')}>
          {({ id }) => (
            <SelectField id={id} disabled={readOnly} value={field.required ? 'yes' : 'no'} options={[{ value: 'no', label: t('admin.format.dec.noOptional') }, { value: 'yes', label: t('admin.format.dec.yesRequired') }]}
              onChange={(e) => onChange({ required: e.target.value === 'yes' })} />
          )}
        </Field>
      </div>
      {number && (
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('admin.format.dec.unit')}>
            {({ id }) => (
              <div className="mg-field"><input id={id} value={field.unit ?? ''} maxLength={20} placeholder={t('admin.format.dec.unitPlaceholder')} disabled={readOnly} onChange={(e) => onChange({ unit: e.target.value })} /></div>
            )}
          </Field>
          <Field label={t('admin.format.dec.cantBelow')}>
            {({ id }) => <LimitInput id={id} value={field.min} disabled={readOnly} onValue={(min) => onChange({ min })} />}
          </Field>
          <Field label={t('admin.format.dec.cantAbove')}>
            {({ id }) => <LimitInput id={id} value={field.max} disabled={readOnly} onValue={(max) => onChange({ max })} />}
          </Field>
        </div>
      )}
      {number && <p className="text-[13px] text-[rgb(var(--mg-muted))]">{t('admin.format.dec.limitNote')}</p>}
    </div>
  );
}

/** A number box that keeps what is being typed ("1." on its way to "1.5") and tells the parent the number, or null when empty. */
function LimitInput({ id, value, disabled, onValue }: { id: string; value: number | null | undefined; disabled: boolean; onValue: (value: number | null) => void }) {
  const { t } = useLanguage();
  const [text, setText] = useState(value == null ? '' : String(value));
  return (
    <div className="mg-field">
      <NumberField id={id} decimal allowNegative value={text} disabled={disabled} placeholder={t('admin.format.dec.noLimit')}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const parsed = next.trim() === '' ? null : Number(next);
          if (parsed === null || Number.isFinite(parsed)) onValue(parsed);
        }} />
    </div>
  );
}
