import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Minus, Plus, X } from 'lucide-react';
import { TickerNumber } from '../../components/TickerNumber';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { defaultRaceList, SCOPE_LABEL, type RaceScope } from '../../lib/defaultRaces';
import {
  AGE_GROUP_PRESETS, defaultSection, FORMAT_LABEL, MAIN_ARENA, MAX_SESSIONS, parseFinalistCount, resizeSessions, sectionHasFinal, sectionLocked, sectionName, setRaceFinals,
  type CreatorDraft, type Format, type SectionDraft,
} from '../../lib/creatorDraft';
import { draftFromCompetition, teamCountsOf } from '../../lib/creatorLoad';
import { LANE_ROTATION_LABELS, type LaneRotationModeValue } from '../../lib/lanes';
import { loadRaceTemplates } from '../../lib/raceTemplates';
import { SessionKind, TieBreakRule, type CompetitionDetail, type Session } from '../../types';
import { useCompetition } from '../competition/context';
import { SaveError, saveCreator } from '../admin/creator/save';
import { Notice } from '../../components/Notice';
import { RefineChoiceRow, RefineHeader, RefineList, RefinePage, RefineSwitchRow, type ChoiceOption } from '../refine/Refine';
import './operations.css';

const TIE_OPTIONS: ChoiceOption<string>[] = [
  { value: String(TieBreakRule.Countback), label: 'Most wins' },
  { value: String(TieBreakRule.LastRace), label: 'Last race' },
  { value: String(TieBreakRule.RunOff), label: 'Run-off race' },
  { value: String(TieBreakRule.Manual), label: 'I decide' },
];
const FORMAT_OPTIONS: ChoiceOption<string>[] = [{ value: 'standard', label: 'Standard' }, { value: 'hhf', label: 'Heat, heat, final' }];
const TYPE_OPTIONS: ChoiceOption<string>[] = [{ value: '2', label: FORMAT_LABEL[2] }, { value: '1', label: FORMAT_LABEL[1] }, { value: '3', label: FORMAT_LABEL[3] }];
const LANE_OPTIONS: ChoiceOption<string>[] = ([0, 1, 2] as LaneRotationModeValue[]).map((mode) => ({ value: String(mode), label: LANE_ROTATION_LABELS[mode] }));
const AGE_OPTIONS: ChoiceOption<string>[] = AGE_GROUP_PRESETS.map((age) => ({ value: age, label: age }));
const DEBOUNCE_MS = 400;

const isRaceSession = (s: Session) => (s.kind ?? (s.isBreak ? SessionKind.Break : SessionKind.Race)) === SessionKind.Race;
const messageOf = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  const data = (error as { response?: { data?: { message?: string; title?: string } | string } })?.response?.data;
  return typeof data === 'string' && data ? data : (typeof data === 'object' && (data?.message || data?.title)) || fallback;
};

/** How a section's races read in the Races row: one line per session, and the final. */
function raceLines(section: SectionDraft): string {
  const text = (races: string[] | null) => (races === null ? 'Left for later' : `${races.length} ${races.length === 1 ? 'race' : 'races'}`);
  const lines = section.sessions.map((session, i) => (section.sessions.length === 1 && !section.finalSessionId ? text(session.races) : `Session ${i + 1}: ${text(session.races)}`));
  if (sectionHasFinal(section)) lines.push(`Final: ${text(section.finalRaces ?? null)}`);
  return lines.join('\n');
}

/** Sections and races: how each age group runs, how long it takes, and what it races. Every change saves as it is made. */
export function SectionsPage() {
  const { competition, reload } = useCompetition();
  const { hasRole } = useAuth();
  const isAdmin = Boolean(hasRole?.('Admin'));
  const [draft, setDraft] = useState<CreatorDraft>(() => draftFromCompetition(competition));
  const [seen, setSeen] = useState<CompetitionDetail>(competition);
  const [saving, setSaving] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const [pending, setPending] = useState<Array<{ key: number; format: Format }>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const latest = useRef(draft);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const competitionRef = useRef(competition);
  useEffect(() => { competitionRef.current = competition; });

  // A fresh copy of the competition replaces the draft, unless there are changes waiting to be saved.
  if (competition !== seen && !waiting && !saving) {
    setSeen(competition);
    setDraft(draftFromCompetition(competition));
  }
  useEffect(() => { latest.current = draft; }, [draft]);

  useEffect(() => {
    let cancelled = false;
    loadRaceTemplates().then((list) => { if (!cancelled) setTemplates(list.map((t) => t.name)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function flush() {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current) return;
    setWaiting(false);
    setSaving(true);
    setError(null);
    setRetryable(false);
    try {
      const current = competitionRef.current;
      await saveCreator(latest.current, { editingId: current.id, competition: current, teamCounts: teamCountsOf(current), progress: () => {} });
      dirty.current = false;
      reload();
    } catch (caught) {
      if (caught instanceof SaveError && caught.status === 409) {
        // The API said no to the change as things stand (a final that already exists or has scored): show why, then show the saved state again.
        dirty.current = false;
        setError(messageOf(caught, 'Couldn’t save.'));
        reload();
      } else {
        setError(messageOf(caught, 'Couldn’t save. Check your signal and try again.'));
        setRetryable(true);
      }
    } finally {
      setSaving(false);
    }
  }
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  // Leaving the page with a change still waiting saves it.
  useEffect(() => () => { if (dirty.current) void flushRef.current(); }, []);

  /** Applies a change to the draft at once and saves it: straight away, or once the taps stop for steppers. */
  function commit(next: CreatorDraft, wait = false) {
    latest.current = next;
    dirty.current = true;
    setDraft(next);
    setWaiting(true);
    if (timer.current) window.clearTimeout(timer.current);
    if (wait) timer.current = window.setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
    else void flush();
  }
  const change = (index: number, update: (section: SectionDraft) => SectionDraft, wait = false) =>
    commit({ ...latest.current, sections: latest.current.sections.map((s, i) => (i === index ? update(s) : s)) }, wait);

  /** Saves a setting that lives on the section or its sessions rather than in the draft. */
  async function saveSetting(what: string, work: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    setRetryable(false);
    try { await work(); reload(); }
    catch (caught) { setError(messageOf(caught, `Couldn’t save ${what}. Check your signal and try again.`)); }
    finally { setSaving(false); }
  }

  const sectionsById = useMemo(() => new Map(competition.sections.map((s) => [s.id, s])), [competition.sections]);
  const sessionsOf = (sectionId: number) => competition.sessions.filter((s) => isRaceSession(s) && s.competitionSectionId === sectionId);
  const arenas = useMemo(() => {
    const seen = new Map<string, string>();
    for (const name of [MAIN_ARENA, ...draft.sections.map((s) => s.arena.trim()), ...competition.sessions.map((s) => s.arenaName?.trim() ?? '')]) {
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
    return [...seen.values()];
  }, [draft.sections, competition.sessions]);
  const arenaOptions: ChoiceOption<string>[] = arenas.map((name) => ({ value: name, label: name }));

  function setTieBreak(section: SectionDraft, rule: string) {
    if (!section.existingId) return;
    const saved = sectionsById.get(section.existingId);
    const finalistCount = parseFinalistCount(section.finalistCount) ?? saved?.finalistCount ?? null;
    const nextRule = Number(rule);
    const nextDraft: CreatorDraft = {
      ...latest.current,
      sections: latest.current.sections.map((s) => (s.existingId === section.existingId
        ? { ...s, tieBreak: nextRule, finalistCount: s.finalistCount || (finalistCount != null ? String(finalistCount) : '') }
        : s)),
    };
    latest.current = nextDraft;
    setDraft(nextDraft);
    const runoff = section.runoffRaceName.trim() || null;
    // The API clears the number of finalists when it is left out, so send the one the section has.
    void saveSetting('the tie-break', () => api.put(`/competitions/${competition.id}/sections/${section.existingId}`, { runoffRaceName: runoff, tieBreakRule: nextRule, finalistCount }));
  }
  function setSessionSettings(section: SectionDraft, patch: { laneRotationMode?: number; raceOrderAlternating?: boolean }) {
    if (!section.existingId) return;
    void saveSetting('this setting', async () => {
      for (const s of sessionsOf(section.existingId!)) {
        await api.put(`/competitions/${competition.id}/sessions/${s.id}/settings`, {
          minutesPerHeat: s.minutesPerHeat ?? null,
          raceOrderAlternating: patch.raceOrderAlternating ?? s.raceOrderAlternating ?? false,
          laneRotationMode: patch.laneRotationMode ?? s.laneRotationMode ?? 0,
        });
      }
    });
  }

  async function remove(index: number) {
    const section = latest.current.sections[index];
    if (section.existingId && !(await confirmDialog({ title: `Remove ${sectionName(section)} and its sessions?`, message: 'You can’t undo this.', confirmLabel: 'Remove section', destructive: true }))) return;
    commit({ ...latest.current, sections: latest.current.sections.filter((_, i) => i !== index) });
  }

  let nextKey = pending.reduce((m, p) => Math.max(m, p.key), 0) + 1;
  const addBlank = () => { setPending((list) => [...list, { key: nextKey++, format: 2 }]); };
  function createFrom(key: number, format: Format, ageGroup: string) {
    setPending((list) => list.filter((p) => p.key !== key));
    commit({ ...latest.current, sections: [...latest.current.sections, { ...defaultSection(format), ageGroup: ageGroup.trim() }] });
  }

  const busy = saving;
  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel="Back to preparations" context={competition.name} title="Sections and races" />
      <div className="ops-sections" aria-busy={busy}>
        {error && <Notice actionLabel={retryable ? 'Try again' : undefined} onAction={() => void flush()}>{error}</Notice>}
        {busy && <p role="status" className="rf-note">Saving…</p>}
        <hr className="ops-navybar ops-navybar-first" />
        {draft.sections.map((section, index) => {
          const saved = section.existingId ? sectionsById.get(section.existingId) : undefined;
          const mine = section.existingId ? sessionsOf(section.existingId) : [];
          const locked = sectionLocked(section);
          const first = mine.find((s) => !section.finalSessionId || s.id !== section.finalSessionId) ?? mine[0];
          const tie = String(saved?.tieBreakRule ?? TieBreakRule.Countback);
          const minutes = Number(section.minutesPerRace) || 10;
          const key = section.existingId ?? `new-${index}`;
          return (
            <Fragment key={key}>
              {index > 0 && <hr className="ops-navybar" />}
              <section aria-label={sectionName(section)} className="ops-section">
                <h2 className="ops-sec-name">{sectionName(section)}</h2>
                <RefineList as="div">
                  <RefineChoiceRow label="Format" value={section.usesRaceFinals ? 'hhf' : 'standard'} options={FORMAT_OPTIONS} disabled={busy || locked}
                    onChange={(v) => change(index, (s) => setRaceFinals(s, v === 'hhf'))} />
                  <RefineChoiceRow label="Arena" value={section.arena} options={arenaOptions} allowOther disabled={busy}
                    onChange={(arena) => change(index, (s) => ({ ...s, arena }))} />
                  <div className="ops-pair">
                    <Stepper label="Sessions" value={section.sessions.length} min={1} max={MAX_SESSIONS} disabled={busy || locked || section.usesRaceFinals}
                      onChange={(n) => change(index, (s) => resizeSessions(s, n), true)} />
                    <Stepper label="Minutes per heat" value={minutes} min={5} max={180} step={5} disabled={busy}
                      onChange={(n) => change(index, (s) => ({ ...s, minutesPerRace: String(n) }), true)} />
                  </div>
                  <div className="ops-sub">
                    <h3>Scoring extras</h3>
                    <RefineChoiceRow label="Tie-break" value={tie} options={TIE_OPTIONS} disabled={busy || !section.existingId} onChange={(v) => setTieBreak(section, v)} />
                    {tie === String(TieBreakRule.RunOff) && (
                      <RefineChoiceRow label="Run-off race" value={section.runoffRaceName} placeholder="None" disabled={busy}
                        options={[{ value: '', label: 'None' }, ...templates.map((name) => ({ value: name, label: name }))]}
                        onChange={(runoffRaceName) => change(index, (s) => ({ ...s, runoffRaceName }))} />
                    )}
                    {!section.usesRaceFinals && first && (
                      <>
                        <RefineChoiceRow label="Lane after each race" value={String(first.laneRotationMode ?? 0)} options={LANE_OPTIONS} disabled={busy}
                          onChange={(v) => setSessionSettings(section, { laneRotationMode: Number(v) })} />
                        <RefineSwitchRow label="Run 2 heats in parallel" on={first.raceOrderAlternating === true} disabled={busy}
                          onChange={(on) => setSessionSettings(section, { raceOrderAlternating: on })} />
                      </>
                    )}
                    {sectionHasFinal(section) && (
                      <>
                        <RefineSwitchRow label="Carry points into the final" on={section.carryPointsIntoFinal === true} disabled={busy}
                          onChange={(on) => change(index, (s) => ({ ...s, carryPointsIntoFinal: on }))} />
                        <RefineSwitchRow label="Double points in the final" on={section.doublePointsInFinal === true} disabled={busy}
                          onChange={(on) => change(index, (s) => ({ ...s, doublePointsInFinal: on }))} />
                      </>
                    )}
                  </div>
                  <div className="rf-row ops-races">
                    <span className="rf-grow"><span className="rf-t1">Races</span><span className="rf-t2 ops-lines">{raceLines(section)}</span></span>
                    <button type="button" className="rf-btn" aria-expanded={editing === key.toString()} onClick={() => setEditing(editing === key.toString() ? null : key.toString())}>{editing === key.toString() ? 'Done' : 'Edit'}</button>
                  </div>
                  {editing === key.toString() && (
                    <RaceEditor section={section} templates={templates} disabled={busy} onChange={(next) => change(index, () => next)} />
                  )}
                  {!section.hasEntries && (isAdmin || !section.existingId) && (
                    <div className="rf-row ops-end"><button type="button" className="ops-danger-link" disabled={busy} onClick={() => void remove(index)}>Remove this section</button></div>
                  )}
                </RefineList>
              </section>
            </Fragment>
          );
        })}
        {pending.map((item) => (
          <Fragment key={`p${item.key}`}>
            <hr className="ops-navybar" />
            <section aria-label="New section" className="ops-section">
              <h2 className="ops-sec-name">New section</h2>
              <RefineList as="div">
                <RefineChoiceRow label="Type" value={String(item.format)} options={TYPE_OPTIONS}
                  onChange={(v) => setPending((list) => list.map((p) => (p.key === item.key ? { ...p, format: Number(v) as Format } : p)))} />
                <RefineChoiceRow label="Age group" value="" placeholder="Choose" options={AGE_OPTIONS} allowOther disabled={busy}
                  onChange={(age) => createFrom(item.key, item.format, age)} />
                <div className="rf-row ops-end"><button type="button" className="ops-danger-link" onClick={() => setPending((list) => list.filter((p) => p.key !== item.key))}>Remove this section</button></div>
              </RefineList>
            </section>
          </Fragment>
        ))}
        <button type="button" className="ops-addbar" disabled={busy} onClick={addBlank}><Plus className="h-4 w-4" aria-hidden="true" />Add a section</button>
      </div>
    </RefinePage>
  );
}

/** A small round − and + with the number on its own between them. */
function Stepper({ label, value, min, max, step = 1, disabled, onChange }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (next: number) => void }) {
  return (
    <div className="ops-step">
      <span className="ops-step-label" id={`step-${label}`}>{label}</span>
      <span className="ops-step-ctl" role="group" aria-labelledby={`step-${label}`}>
        <button type="button" className="ops-ibtn" aria-label={`Fewer ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - step))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
        <output aria-live="polite"><TickerNumber value={value} format={String} /></output>
        <button type="button" className="ops-ibtn" aria-label={`More ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + step))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
      </span>
    </div>
  );
}

/** The race list for each session and the final: reorder, remove, add from the library, or start from a preset. */
function RaceEditor({ section, templates, disabled, onChange }: { section: SectionDraft; templates: string[]; disabled: boolean; onChange: (next: SectionDraft) => void }) {
  const hasFinal = sectionHasFinal(section);
  const tabs = [...section.sessions.map((_, i) => `Session ${i + 1}`), ...(hasFinal ? ['Final'] : [])];
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState('');
  const [presets, setPresets] = useState(false);
  const active = Math.min(tab, tabs.length - 1);
  const onFinal = hasFinal && active === section.sessions.length;
  const session = onFinal ? null : section.sessions[active];
  const races = onFinal ? section.finalRaces ?? null : session?.races ?? null;
  const fixed = onFinal ? Boolean(section.finalHasHeats || section.finalScored) : Boolean(session?.hasHeats || session?.scored);
  const readOnly = disabled || fixed;
  const list = races ?? [];

  const set = (next: string[] | null) => onChange(onFinal
    ? { ...section, finalRaces: next }
    : { ...section, sessions: section.sessions.map((s, i) => (i === active ? { ...s, races: next } : s)) });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    set(next);
  };
  const add = (name: string) => { const text = name.trim(); if (text) { set([...list, text]); setQuery(''); } };
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? templates.filter((name) => name.toLowerCase().includes(q)) : templates).slice(0, 12);
  }, [templates, query]);
  const typed = query.trim();

  return (
    <div className="ops-races-edit">
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Race list for" className="ops-seg">
          {tabs.map((label, i) => <button key={label} type="button" role="tab" aria-selected={i === active} onClick={() => { setTab(i); setPresets(false); }}>{label}</button>)}
        </div>
      )}
      {!section.usesRaceFinals && !hasFinal && (
        <button type="button" className="ops-addbar ops-addbar-flat" disabled={disabled} onClick={() => { onChange({ ...section, hasFinal: true }); setTab(section.sessions.length); setPresets(false); }}>
          <Plus className="h-4 w-4" aria-hidden="true" />Add a final
        </button>
      )}
      {onFinal && (
        <div className="ops-final-end">
          <button type="button" className="ops-danger-link" disabled={disabled} onClick={() => { onChange({ ...section, hasFinal: false }); setTab(0); setPresets(false); }}>Remove the final</button>
        </div>
      )}
      {fixed && <p className="rf-note">Heats are made, so these races are fixed.</p>}
      {races === null && !fixed && <p className="rf-note">Left for later. The standard list is used until you choose.</p>}
      <ol className="ops-race-list">
        {list.map((name, i) => (
          <li key={`${name}-${i}`}>
            <span className="ops-race-n">{i + 1}</span>
            <span className="ops-race-name">{name}</span>
            {!readOnly && <>
              <button type="button" className="ops-ibtn" aria-label={`Move ${name} up`} onClick={() => move(i, i - 1)} disabled={i === 0}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className="ops-ibtn" aria-label={`Move ${name} down`} onClick={() => move(i, i + 1)} disabled={i === list.length - 1}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className="ops-ibtn ops-ibtn-red" aria-label={`Remove ${name}`} onClick={() => set(list.filter((_, j) => j !== i))}><X className="h-4 w-4" aria-hidden="true" /></button>
            </>}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <>
          <label className="rf-fld">Add a race<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the library" /></label>
          <div className="ops-matches">
            {matches.map((name) => <button key={name} type="button" className="rf-btn" onClick={() => add(name)}>{name}</button>)}
            {typed && !templates.some((name) => name.toLowerCase() === typed.toLowerCase()) && <button type="button" className="rf-btn" onClick={() => add(typed)}>Add “{typed}”</button>}
          </div>
          <div className="ops-race-actions">
            <button type="button" className="rf-btn rf-btn-text" aria-expanded={presets} onClick={() => setPresets((v) => !v)}>Use a preset list</button>
            <button type="button" className="rf-btn rf-btn-text" onClick={() => set(null)}>Leave for later</button>
          </div>
          {presets && (
            <RefineList as="div">
              {(['Zone', 'Area'] as RaceScope[]).map((scope) => {
                const preset = defaultRaceList(scope, section.format, section.ageGroup);
                return (
                  <div key={scope} className="rf-row">
                    <span className="rf-grow"><span className="rf-t1">{SCOPE_LABEL[scope]}</span><span className="rf-t2">{preset.length} races</span></span>
                    <button type="button" className="rf-btn" onClick={() => { set(preset); setPresets(false); }}>Use this</button>
                  </div>
                );
              })}
            </RefineList>
          )}
        </>
      )}
    </div>
  );
}
