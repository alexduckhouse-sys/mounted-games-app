import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../../api';
import { apiErrorMessage } from '../../lib/apiError';
import { NumberField } from '../../components/NumberField';
import { SelectField } from '../../components/SelectField';
import {
  asked, BASIC_CONFIG, configProblem, MAX_CUSTOM_FIELDS, newFieldId, NUMBER_FIELD, parseConfigResponse, STANDARD_CONFIG, TEXT_FIELD,
  type CustomField, type DecFormConfig, type DecFormConfigResponse, type Requirement,
} from '../../lib/decFormConfig';
import { Field } from '../auth/Field';

const REQUIREMENT_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Optional' },
  { value: '2', label: 'Required' },
];

type PartKey = 'trainerPhone' | 'bib' | 'dob' | 'weight' | 'ponyHeight' | 'ponyPassport' | 'ponyAge' | 'membershipNumber' | 'emergencyContact' | 'medicalNotes';

interface Part { key: PartKey; label: string; hint: string }

const GROUPS: { title: string; parts: Part[] }[] = [
  {
    title: 'The team',
    parts: [
      { key: 'trainerPhone', label: 'Trainer’s phone number', hint: 'One per team. A UK or Irish number.' },
      { key: 'bib', label: 'Bibs or numbers', hint: 'A note of what the team’s bibs look like.' },
    ],
  },
  {
    title: 'The rider',
    parts: [
      { key: 'dob', label: 'Age', hint: 'Full date of birth, just the year, or only an age group.' },
      { key: 'weight', label: 'Weight', hint: 'For events with a weight limit.' },
    ],
  },
  {
    title: 'The pony',
    parts: [
      { key: 'ponyHeight', label: 'Height', hint: 'In hands, like 13.2.' },
      { key: 'ponyPassport', label: 'Passport or ID number', hint: '' },
      { key: 'ponyAge', label: 'Age', hint: 'In years.' },
    ],
  },
  {
    title: 'Membership and safety',
    parts: [
      { key: 'membershipNumber', label: 'Membership number', hint: '' },
      { key: 'emergencyContact', label: 'Emergency contact', hint: 'A name and a phone number.' },
      { key: 'medicalNotes', label: 'Medical notes', hint: 'Anything a first aider should know.' },
    ],
  },
];

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
  const [saved, setSaved] = useState<DecFormConfigResponse | null>(null);
  const [draft, setDraft] = useState<DecFormConfig>(STANDARD_CONFIG);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

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
  }, [competitionId]);

  if (loadFailed) return <p className="text-sm text-[rgb(var(--mg-muted))]">Couldn’t load the dec form setup. Check your signal and try again.</p>;
  if (!saved) return <p className="text-sm text-[rgb(var(--mg-muted))]">Loading the dec form setup…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.config);
  const problem = configProblem(draft);
  const change = (patch: Partial<DecFormConfig>) => { setDraft((cur) => ({ ...cur, ...patch })); setMessage(null); };
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
    setMessage(null);
    try {
      const { data } = await api.put(`/competitions/${competitionId}/dec-form-config`, draft);
      const parsed = parseConfigResponse(data);
      if (parsed) { setSaved(parsed); setDraft(parsed.config); }
      setMessage({ kind: 'ok', text: 'Saved. New dec forms will use this.' });
    } catch (err) {
      setMessage({ kind: 'error', text: apiErrorMessage(err, 'Could not save the dec form setup. Check your signal and try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5 text-[15px] text-[rgb(var(--mg-body))]">
        <p>
          Rider, pony and trainer names are always included.
          {saved.isStandard && ' Until saved, trainers see the standard form.'}
        </p>
        <p className="text-sm text-[rgb(var(--mg-muted))]">
          Personal details are only seen by organisers and the trainer, and never show on public pages.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="mg-btn mg-btn-secondary !min-h-11" disabled={readOnly} onClick={() => change({ ...BASIC_CONFIG, customFields: draft.customFields })}>
          Start from the basics
        </button>
        <button type="button" className="mg-btn mg-btn-secondary !min-h-11" disabled={readOnly} onClick={() => change({ ...STANDARD_CONFIG, customFields: draft.customFields })}>
          Use the standard form
        </button>
      </div>

      {GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-3 border-0 p-0">
          <legend className="mg-display mb-1 text-[17px] font-bold uppercase tracking-[0.03em] text-[rgb(var(--mg-heading))]">{group.title}</legend>
          {group.parts.map((part) => (
            <div key={part.key} className="flex flex-col gap-2 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-[rgb(var(--mg-ink))]">{part.label}</div>
                  {part.hint && <div className="text-[13px] text-[rgb(var(--mg-muted))]">{part.hint}</div>}
                </div>
                <SelectField aria-label={`${group.title}: ${part.label}`} disabled={readOnly} value={String(draft[part.key])} options={REQUIREMENT_OPTIONS}
                  onChange={(e) => setPart(part.key, Number(e.target.value) as Requirement)} />
              </div>
              {part.key === 'dob' && asked(draft.dob) && (
                <Field label="What to ask for">
                  {({ id }) => (
                    <SelectField id={id} disabled={readOnly} value={String(draft.dobFormat)}
                      options={[{ value: '0', label: 'Full date of birth' }, { value: '1', label: 'Year of birth only' }, { value: '2', label: 'Age group only' }]}
                      onChange={(e) => change({ dobFormat: Number(e.target.value) as 0 | 1 | 2 })} />
                  )}
                </Field>
              )}
              {part.key === 'weight' && asked(draft.weight) && (
                <Field label="Show weight in">
                  {({ id }) => (
                    <SelectField id={id} disabled={readOnly} value={String(draft.weightUnit)}
                      options={[{ value: '0', label: 'Kilograms (kg)' }, { value: '1', label: 'Stone and pounds (st, lb)' }]}
                      onChange={(e) => change({ weightUnit: Number(e.target.value) as 0 | 1 })} />
                  )}
                </Field>
              )}
            </div>
          ))}
        </fieldset>
      ))}

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="mg-display mb-1 text-[17px] font-bold uppercase tracking-[0.03em] text-[rgb(var(--mg-heading))]">Your own questions</legend>
        <p className="text-sm text-[rgb(var(--mg-muted))]">
          Add custom text or number questions. Numbers outside a limit are flagged for organisers.
        </p>
        {draft.customFields.map((field, index) => (
          <CustomFieldCard key={field.id} field={field} index={index} readOnly={readOnly}
            onChange={(patch) => setField(field.id, patch)}
            onRemove={() => change({ customFields: draft.customFields.filter((f) => f.id !== field.id) })} />
        ))}
        <button type="button" className="mg-btn mg-btn-secondary !min-h-11 self-start" disabled={readOnly || draft.customFields.length >= MAX_CUSTOM_FIELDS} onClick={addField}>
          <Plus aria-hidden="true" className="h-4 w-4" /> Add a question
        </button>
      </fieldset>

      <div className="flex flex-col gap-2">
        <p className="mg-notice">
          Changes apply to dec forms sent from now on.
          {saved.formsSubmitted > 0 && ` The ${saved.formsSubmitted} already in keep the answers they have.`}
        </p>
        {problem && <p role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">{problem}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="mg-btn mg-btn-primary !min-h-12" disabled={readOnly || busy || !!problem || (!dirty && !saved.isStandard)} onClick={() => { void save(); }}>
            {busy ? 'Saving…' : saved.isStandard && !dirty ? 'Save this setup' : 'Save the dec form'}
          </button>
          {message && (
            <span role={message.kind === 'error' ? 'alert' : 'status'}
              className={`text-sm font-medium ${message.kind === 'error' ? 'text-[rgb(var(--mg-elim))]' : 'text-[rgb(var(--mg-ok))]'}`}>
              {message.text}
            </span>
          )}
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
  const name = field.label.trim() || `question ${index + 1}`;
  const number = field.type === NUMBER_FIELD;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] p-3">
      <div className="flex items-end gap-2">
        <Field label="Question" className="min-w-0 flex-1">
          {({ id }) => (
            <div className="mg-field">
              <input id={id} value={field.label} maxLength={80} placeholder="e.g. Saddle size" disabled={readOnly} onChange={(e) => onChange({ label: e.target.value })} />
            </div>
          )}
        </Field>
        <button type="button" className="mg-icon-btn" aria-label={`Remove ${name}`} disabled={readOnly} onClick={onRemove}><X aria-hidden="true" className="h-[18px] w-[18px]" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Answer is">
          {({ id }) => (
            <SelectField id={id} disabled={readOnly} value={String(field.type)} options={[{ value: '0', label: 'Text' }, { value: '1', label: 'A number' }]}
              onChange={(e) => onChange(e.target.value === '1' ? { type: NUMBER_FIELD } : { type: TEXT_FIELD, min: null, max: null, unit: null })} />
          )}
        </Field>
        <Field label="Must be answered">
          {({ id }) => (
            <SelectField id={id} disabled={readOnly} value={field.required ? 'yes' : 'no'} options={[{ value: 'no', label: 'No, optional' }, { value: 'yes', label: 'Yes, required' }]}
              onChange={(e) => onChange({ required: e.target.value === 'yes' })} />
          )}
        </Field>
      </div>
      {number && (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit">
            {({ id }) => (
              <div className="mg-field"><input id={id} value={field.unit ?? ''} maxLength={20} placeholder="kg, cm…" disabled={readOnly} onChange={(e) => onChange({ unit: e.target.value })} /></div>
            )}
          </Field>
          <Field label="Can’t be below">
            {({ id }) => <LimitInput id={id} value={field.min} disabled={readOnly} onValue={(min) => onChange({ min })} />}
          </Field>
          <Field label="Can’t be above">
            {({ id }) => <LimitInput id={id} value={field.max} disabled={readOnly} onValue={(max) => onChange({ max })} />}
          </Field>
        </div>
      )}
      {number && <p className="text-[13px] text-[rgb(var(--mg-muted))]">Leave a limit blank for no limit. Going outside it is allowed, but gets flagged.</p>}
    </div>
  );
}

/** A number box that keeps what is being typed ("1." on its way to "1.5") and tells the parent the number, or null when empty. */
function LimitInput({ id, value, disabled, onValue }: { id: string; value: number | null | undefined; disabled: boolean; onValue: (value: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  return (
    <div className="mg-field">
      <NumberField id={id} decimal allowNegative value={text} disabled={disabled} placeholder="No limit"
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const parsed = next.trim() === '' ? null : Number(next);
          if (parsed === null || Number.isFinite(parsed)) onValue(parsed);
        }} />
    </div>
  );
}
