import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChangePop } from '../../components/ChangePop';
import { ChevronDown } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
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
import type { DeclarationForm, RiderEntry, SectionSignup } from '../../types';
import { useCompetition } from '../competition/context';
import { RefineChoiceRow, RefineDateTimeRow, RefineHeader, RefineList, RefinePage, RefineSection } from '../refine/Refine';
import type { TeamEntry } from './types';
import './operations.css';

type PartKey = 'trainerPhone' | 'bib' | 'dob' | 'weight' | 'ponyHeight' | 'ponyPassport' | 'ponyAge' | 'membershipNumber' | 'emergencyContact' | 'medicalNotes';
const PARTS: Array<{ key: PartKey; label: string }> = [
  { key: 'trainerPhone', label: 'Trainer’s phone number' },
  { key: 'bib', label: 'Bibs or numbers' },
  { key: 'dob', label: 'Rider’s age' },
  { key: 'weight', label: 'Rider’s weight' },
  { key: 'ponyHeight', label: 'Pony’s height' },
  { key: 'ponyPassport', label: 'Pony’s passport or ID number' },
  { key: 'ponyAge', label: 'Pony’s age' },
  { key: 'membershipNumber', label: 'Membership number' },
  { key: 'emergencyContact', label: 'Emergency contact' },
  { key: 'medicalNotes', label: 'Medical notes' },
];

const whenText = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
  return born && Number.isFinite(born) ? `age ${new Date().getFullYear() - born}` : (rider.ageGroup ?? '');
};

interface LockTime { declarationsCloseAt: string | null }

/** Entries and dec forms: who has entered and paid, which forms are in, and what the form asks. Every change saves as it is made. */
export function EntriesPage() {
  const { competition, reload } = useCompetition();
  const [entries, setEntries] = useState<TeamEntry[] | null>(null);
  const [signups, setSignups] = useState<SectionSignup[]>([]);
  const [forms, setForms] = useState<DeclarationForm[]>([]);
  const [lock, setLock] = useState<string | null>(null);
  const [config, setConfig] = useState<DecFormConfig | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const base = `/competitions/${competition.id}`;
    const [e, s, f, l, c] = await Promise.allSettled([
      api.get<TeamEntry[]>(`${base}/entries`),
      api.get<SectionSignup[]>(`${base}/signups`),
      api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } }),
      api.get<LockTime>(`/declaration-forms/competition/${competition.id}/lock-time`),
      api.get(`${base}/dec-form-config`),
    ]);
    if (e.status === 'fulfilled') setEntries(Array.isArray(e.value.data) ? e.value.data : []);
    if (s.status === 'fulfilled' && Array.isArray(s.value.data)) setSignups(s.value.data);
    if (f.status === 'fulfilled' && Array.isArray(f.value.data)) setForms(f.value.data);
    if (l.status === 'fulfilled') setLock(l.value.data?.declarationsCloseAt ?? null);
    if (c.status === 'fulfilled') setConfig(parseConfigResponse(c.value.data)?.config ?? STANDARD_CONFIG);
    setError(e.status === 'rejected' ? 'Couldn’t load the entries. Check your signal and try again.' : null);
  }, [competition.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Runs one change, then loads everything again. Failures show on the page. */
  async function run(failure: string, work: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try { await work(); await load(); return true; }
    catch (caught) { setError(apiErrorMessage(caught, `${failure} Check your signal and try again.`)); return false; }
    finally { setBusy(false); }
  }

  const live = signups.filter((s) => s.status === 0 || s.status === 1);
  const paidCount = live.filter((s) => s.status === 1).length;
  const unpaidCount = live.length - paidCount;
  const closed = Boolean(competition.signupsLocked);

  const groups = useMemo(() => {
    const map = new Map<number, { name: string; teams: TeamEntry[] }>();
    for (const entry of entries ?? []) {
      const group = map.get(entry.sectionId) ?? { name: displaySectionName(entry.sectionName), teams: [] };
      group.teams.push(entry);
      map.set(entry.sectionId, group);
    }
    return [...map.entries()];
  }, [entries]);

  const toggleEntries = () => run('Couldn’t change entries.', async () => {
    await api.post(`/competitions/${competition.id}/signups-locked`, { locked: !closed });
    reload();
  });

  const setPaid = (team: TeamEntry, paid: boolean) => run('Couldn’t change the payment.', async () => {
    for (const signup of live.filter((s) => s.teamId === team.teamId)) {
      if (paid && signup.status === 0) await api.post(`/competitions/${competition.id}/signups/${signup.id}/mark-paid`);
      if (!paid && signup.status === 1) await api.put(`/signups/${signup.id}/status`, { status: 0 });
    }
  });

  async function withdraw(team: TeamEntry) {
    if (!(await confirmDialog({ title: `Withdraw ${team.teamName}?`, message: 'They come out of the draw. You can bring them back until a draw depends on it.', confirmLabel: 'Withdraw', destructive: true }))) return;
    await run('Couldn’t withdraw the entry.', () => api.put(`/competitions/${competition.id}/teams/${team.teamId}/entry-status`, { status: 1, reason: null }));
    reload();
  }
  async function reinstate(team: TeamEntry) {
    await run('Couldn’t reinstate the entry.', () => api.put(`/competitions/${competition.id}/teams/${team.teamId}/entry-status`, { status: 0, reason: null }));
    reload();
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/competitions/${competition.id}/declarations`); toast.show('Link copied'); }
    catch { setError('Couldn’t copy the link.'); }
  }

  const saveLock = (iso: string | null) => run('Couldn’t save the deadline.', () => api.put(`/declaration-forms/competition/${competition.id}/lock-time`, { declarationsCloseAt: iso }));
  const saveConfig = (next: DecFormConfig) => {
    const problem = configProblem(next);
    if (problem) { setError(problem); return Promise.resolve(false); }
    setConfig(next);
    return run('Couldn’t save the dec form.', async () => { await api.put(`/competitions/${competition.id}/dec-form-config`, next); });
  };

  const days = eventDays(competition.startDate, competition.endDate);

  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel="Back to preparations" context={competition.name} title="Entries and dec forms" />
      <div className="ops-cards ops-entries" aria-busy={busy}>
        {error && <Notice>{error}</Notice>}
        {toast.node}

        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow"><span className="rf-t1">{closed ? 'Entries closed' : 'Entries open'}</span><span className="rf-t2">{paidCount} paid · {unpaidCount} not paid</span></span>
            <button type="button" className="rf-btn" disabled={busy} onClick={() => void toggleEntries()}>{closed ? 'Reopen entries' : 'Close entries'}</button>
          </div>
        </RefineList>

        {entries !== null && entries.length === 0 && <p className="rf-note">No entries yet.</p>}
        {groups.map(([sectionId, group]) => (
          <Fragment key={sectionId}>
            <RefineSection title={group.name} />
            <RefineList as="div" label={group.name}>
              {group.teams.map((team) => {
                const mine = live.filter((s) => s.teamId === team.teamId);
                const paid = mine.length > 0 && mine.every((s) => s.status === 1);
                const form = forms.find((f) => f.teamId === team.teamId);
                const flags = (form?.riders ?? []).flatMap((r) => r.flags ?? []);
                const out = team.status !== 0;
                const tag = out ? { text: 'Withdrawn', tone: 'mut' } : !form ? { text: 'Missing', tone: 'mut' } : flags.length > 0 ? { text: 'Flagged', tone: 'warn' } : { text: 'Received', tone: 'ok' };
                const isOpen = open === team.teamId;
                return (
                  <div key={team.teamId}>
                    <button type="button" className="rf-row ops-entry-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : team.teamId)}>
                      <span className="rf-grow">
                        <span className="rf-t1">{team.teamName}</span>
                        <span className="rf-t2">
                          {mine.length > 0 && <span className={paid ? 'ops-paid' : 'ops-unpaid'}><ChangePop value={paid ? 'Paid' : 'Not paid'} tick={paid}>{paid ? 'Paid' : 'Not paid'}</ChangePop></span>}
                          {mine.length > 0 && form ? ' · ' : ''}{form ? `Form in ${whenText(form.submittedAt)}` : ''}
                        </span>
                      </span>
                      <span className={`rf-st rf-${tag.tone}`}>{tag.text}</span>
                      <ChevronDown className={`rf-chev rf-chev-down h-4 w-4 ${isOpen ? 'ops-flip' : ''}`} aria-hidden="true" />
                    </button>
                    {isOpen && (
                      <div className="ops-entry-body">
                        {mine.length > 0 && (
                          <div className="ops-line">
                            <span className="rf-grow"><span className="rf-t1"><ChangePop value={paid ? 'Paid' : 'Not paid yet'} tick={paid}>{paid ? 'Paid' : 'Not paid yet'}</ChangePop></span></span>
                            <button type="button" className="rf-btn" disabled={busy} onClick={() => void setPaid(team, !paid)}>{paid ? 'Mark not paid' : 'Mark paid'}</button>
                          </div>
                        )}
                        {form ? <FormView form={form} flags={flags} /> : (
                          <div className="ops-line">
                            <span className="rf-grow"><span className="rf-t1">Not received yet</span></span>
                            <button type="button" className="rf-btn" onClick={() => void copyLink()}>Copy form link</button>
                          </div>
                        )}
                        <div className="ops-line ops-line-end">
                          {out
                            ? (team.canReinstate ? <button type="button" className="rf-btn" disabled={busy} onClick={() => void reinstate(team)}>Reinstate</button> : <span className="rf-t2">This entry is out of the draw.</span>)
                            : <button type="button" className="ops-danger-link" disabled={busy} onClick={() => void withdraw(team)}>Withdraw this entry</button>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </RefineList>
          </Fragment>
        ))}

        <RefineSection title="Dec form" />
        <RefineList as="div">
          <div className="rf-row">
            <span className="rf-grow"><span className="rf-t1">Questions and flags</span>{config && <span className="rf-t2">{questionCount(config)} questions · {rulesOf(config).length} flag rules</span>}</span>
            <button type="button" className="rf-btn" aria-expanded={setup} onClick={() => setSetup((v) => !v)}>{setup ? 'Done' : 'Edit'}</button>
          </div>
          {setup && config && (
            <>
              <RefineDateTimeRow label="Deadline" value={lock} eventDays={days} disabled={busy} onChange={(iso) => void saveLock(iso)} />
              <div className="rf-row">
                <span className="rf-grow"><span className="rf-t1">Download</span><span className="rf-t2">Received forms, CSV</span></span>
                <button type="button" className="rf-btn" disabled={forms.length === 0}
                  onClick={() => downloadCsv(`${safeFilename(competition.name)}-dec-forms.csv`, decFormsCsv(forms, config.customFields))}>CSV</button>
              </div>
            </>
          )}
        </RefineList>
        {setup && config && <SetupEditor config={config} busy={busy} onSave={saveConfig} />}
      </div>
    </RefinePage>
  );
}

function FormView({ form, flags }: { form: DeclarationForm; flags: string[] }) {
  const riders = form.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  return (
    <div className="ops-form">
      {flags.map((text) => <Notice key={text} role="status">{text}</Notice>)}
      <p className="rf-t1">Trainer: {form.trainerName ?? form.submittedByName ?? 'not given'}</p>
      <ol className="ops-riders">
        {riders.map((rider, i) => (
          <li key={rider.id}>
            <span className="ops-race-n">{i + 1}</span>
            <span className="rf-grow"><span className="rf-t1">{rider.fullName}</span><span className="rf-t2">{rider.horseName ?? ''}</span></span>
            <span className="rf-t2 ops-facts">{[rider.ponyHeightHands != null ? `${heightText(rider.ponyHeightHands)} hh` : '', ageOf(rider)].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
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
  const label = (id: string) => config.customFields.find((f) => f.id === id)?.label.trim() || 'Question';
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
      <RefineSection title="Questions" />
      <RefineList as="div" label="Questions">
        {used.map((part) => (
          <div key={part.key} className="rf-row"><span className="rf-grow rf-t1">{part.label}</span>
            <button type="button" className="ops-danger-link" disabled={busy} aria-label={`Remove ${part.label}`} onClick={() => void onSave({ ...config, [part.key]: OFF })}>Remove</button></div>
        ))}
        {config.customFields.map((field) => (
          <div key={field.id} className="rf-row"><span className="rf-grow"><span className="rf-t1">{field.label}</span>{field.type === NUMBER_FIELD && <span className="rf-t2">A number{field.unit ? ` in ${field.unit}` : ''}</span>}</span>
            <button type="button" className="ops-danger-link" disabled={busy} aria-label={`Remove ${field.label}`}
              onClick={() => void onSave({ ...config, customFields: config.customFields.filter((f) => f.id !== field.id) })}>Remove</button></div>
        ))}
        <div className="rf-row ops-end">
          <button type="button" className="rf-btn" aria-expanded={adding} disabled={busy} onClick={() => { setAdding((v) => !v); setOwn(false); }}>+ Add a question</button>
        </div>
        {adding && !own && (
          <div className="rf-choices ops-add-list" role="listbox" aria-label="Add a question">
            {unused.map((part) => (
              <button key={part.key} type="button" role="option" aria-selected={false} className="rf-choice" onClick={() => { void onSave({ ...config, [part.key]: OPTIONAL }); setAdding(false); }}>{part.label}</button>
            ))}
            <button type="button" role="option" aria-selected={false} className="rf-choice" onClick={() => setOwn(true)}>Write your own…</button>
          </div>
        )}
        {adding && own && (
          <form className="ops-dup" onSubmit={(event) => { event.preventDefault(); addOwn(); }}>
            <label className="rf-fld">Question<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
            <RefineChoiceRow label="Answer" value={kind} options={[{ value: 'text', label: 'Text' }, { value: 'number', label: 'A number' }]} onChange={setKind} />
            {kind === 'number' && <label className="rf-fld">Unit (optional)<input value={unit} maxLength={20} onChange={(event) => setUnit(event.target.value)} /></label>}
            <div className="rf-actions"><button type="submit" className="rf-btn rf-btn-primary" disabled={!name.trim()}>Add question</button><button type="button" className="rf-btn" onClick={() => setOwn(false)}>Cancel</button></div>
          </form>
        )}
      </RefineList>

      <RefineSection title="Flag rules" />
      {numbers.length === 0 && <p className="rf-note">Add a number question to flag answers that go over or under a limit.</p>}
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
          <button type="button" className="ops-addbar" disabled={busy} onClick={() => setPending((list) => [...list, { key: list.length ? list[list.length - 1].key + 1 : 1, field: numbers[0].id, op: 'over' }])}>+ Add a flag rule</button>
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
  const [text, setText] = useState(value);
  const commit = () => { const n = Number(text); if (text.trim() !== '' && Number.isFinite(n) && String(n) !== value) onChange({ field, op, value: n }); };
  return (
    <RefineList as="div" label={`Flag rule for ${label}`}>
      <div className="rf-row ops-rule-head"><span className="rf-grow rf-t1">Flag if</span></div>
      <RefineChoiceRow label="Answer" value={field} options={numbers.map((f) => ({ value: f.id, label: f.label.trim() || 'Question' }))} disabled={busy}
        onChange={(next) => onChange({ field: next, op, value: text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : null })} />
      <RefineChoiceRow label="Is" value={op} options={[{ value: 'over', label: 'is over' }, { value: 'under', label: 'is under' }]} disabled={busy}
        onChange={(next) => onChange({ field, op: next, value: text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : null })} />
      <div className="rf-row">
        <label className="rf-grow rf-t1" htmlFor={`rule-${uid}`}>Value</label>
        <input id={`rule-${uid}`} className="ops-value" inputMode="decimal" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} onBlur={commit} />
        {unit && <span className="rf-t2">{unit}</span>}
      </div>
      <div className="rf-row ops-end"><button type="button" className="ops-danger-link" disabled={busy} onClick={onRemove}>Remove rule</button></div>
    </RefineList>
  );
}
