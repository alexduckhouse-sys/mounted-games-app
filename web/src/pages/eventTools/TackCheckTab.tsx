import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Chevron, RefineList, RefineNote, RefineSection } from '../refine/Refine';
import { MAX_SECTOR_NAME, MAX_TACK_SECTORS, TACK_MODES, draftFromMarks, draftTotal, isScored, marksFromDraft, sectorProblem, type MarkDraft } from '../../lib/tackCheck';
import type { TackCheckBoard, TackCheckMode, TackCheckSection, TackCheckTeam } from '../../types';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';

function message(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string; detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.message ?? candidate.response?.data?.title ?? fallback;
}

let nextKey = 1;
interface SectorDraft { key: number; id: number | null; name: string }

/** Set up the tack check for each age group and record each team's result. */
export function TackCheckTab({ competitionId }: { competitionId: string }) {
  const [board, setBoard] = useState<TackCheckBoard | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get<TackCheckBoard>(`/event-tools/competitions/${competitionId}/tack-check`)
      .then(({ data }) => { if (!cancelled) { setBoard(data); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(message(caught, 'Couldn’t load the tack check.')); });
    return () => { cancelled = true; };
  }, [competitionId, attempt]);

  const replace = (section: TackCheckSection) =>
    setBoard((current) => current && { ...current, sections: current.sections.map((s) => (s.sectionId === section.sectionId ? section : s)) });

  const section = board?.sections.find((s) => s.sectionId === sectionId) ?? board?.sections[0] ?? null;
  return <section aria-labelledby="tack-title">
    <RefineSection title="Tack check" />
    <h2 id="tack-title" className="sr-only">Tack check</h2>
    <nav aria-label="Tack check form"><RefineList as="div">
      <Link className="rf-row" to={`/event-tools/${competitionId}/print/tack-check`}>
        <span className="rf-grow"><span className="rf-t1">Print tack check forms</span><span className="rf-t2">One form per age group, with each team’s riders and ponies</span></span><Chevron />
      </Link>
    </RefineList></nav>
    {error && <div role="alert" className="mg-notice tools-msg">{error} <button type="button" className="rf-btn rf-btn-text" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>}
    {!board && !error && <p role="status" className="rf-note">Loading the tack check…</p>}
    {board && board.sections.length === 0 && <RefineNote>Add an age group to this competition first.</RefineNote>}
    {board && section && <div className="tools-form">
      {board.sections.length > 1 && <label className="rf-fld">Age group
        <SelectField value={section.sectionId} onChange={(event) => setSectionId(Number(event.target.value))}>
          {board.sections.map((s) => <option key={s.sectionId} value={s.sectionId}>{s.sectionName}</option>)}
        </SelectField>
      </label>}
      <SettingsForm key={section.sectionId} competitionId={competitionId} section={section} onSaved={replace} />
      {section.configured && section.isEnabled && <Marks key={section.sectionId} competitionId={competitionId} section={section} onSaved={replace} />}
    </div>}
  </section>;
}

function SettingsForm({ competitionId, section, onSaved }: { competitionId: string; section: TackCheckSection; onSaved: (s: TackCheckSection) => void }) {
  const [enabled, setEnabled] = useState(section.configured ? section.isEnabled : true);
  const [mode, setMode] = useState<TackCheckMode>(section.mode);
  const [maxPoints, setMaxPoints] = useState(String(section.maxPoints));
  const [sectors, setSectors] = useState<SectorDraft[]>(() => section.sectors.map((s) => ({ key: nextKey++, id: s.id || null, name: s.name })));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function edit(change: () => void) { change(); setSaved(false); setProblem(null); }

  async function save(event: FormEvent) {
    event.preventDefault();
    const max = Number(maxPoints);
    const issue = sectorProblem(sectors.map((s) => s.name))
      ?? (Number.isInteger(max) && max >= 1 && max <= 100 ? null : 'The most points for a sector must be a whole number from 1 to 100.');
    if (issue) { setProblem(issue); return; }
    setBusy(true); setProblem(null);
    try {
      const { data } = await api.put<TackCheckSection>(`/event-tools/competitions/${competitionId}/tack-check/sections/${section.sectionId}`, {
        isEnabled: enabled, mode, maxPoints: max, sectors: sectors.map((s) => ({ id: s.id, name: s.name.trim() })),
      });
      onSaved(data);
      // New sectors now have ids; keep them so the next save updates rather than adds.
      setSectors(data.sectors.map((s) => ({ key: nextKey++, id: s.id, name: s.name })));
      setSaved(true);
    } catch (caught) { setProblem(message(caught, 'Couldn’t save the tack check.')); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} noValidate><fieldset className="tools-fields" disabled={busy}><legend className="sr-only">Tack check set-up for {section.sectionName}</legend>
    <label className="tools-check"><input type="checkbox" checked={enabled} onChange={(event) => edit(() => setEnabled(event.target.checked))} />Run a tack check for {section.sectionName}</label>
    <fieldset className="tools-fields"><legend className="rf-fld">What it counts for</legend>
      {TACK_MODES.map((option) => <label key={option.mode} className="tools-check">
        <input type="radio" name={`tack-mode-${section.sectionId}`} checked={mode === option.mode} onChange={() => edit(() => setMode(option.mode))} />
        <span>{option.label}<span className="tools-check-sub">{option.detail}</span></span>
      </label>)}
    </fieldset>
    {isScored(mode) && <label className="rf-fld">Most points for one sector<NumberField min={1} max={100} value={maxPoints} onChange={(event) => edit(() => setMaxPoints(event.target.value))} /></label>}
    <fieldset className="tools-fields"><legend className="rf-fld">Sectors</legend>
      {sectors.map((sector, index) => <div key={sector.key} className="tools-row">
        <label className="rf-fld">Sector {index + 1}<input value={sector.name} maxLength={MAX_SECTOR_NAME} onChange={(event) => edit(() => setSectors((list) => list.map((s) => (s.key === sector.key ? { ...s, name: event.target.value } : s))))} /></label>
        <button type="button" className="rf-btn rf-btn-text" aria-label={`Remove sector ${index + 1}`} onClick={() => edit(() => setSectors((list) => list.filter((s) => s.key !== sector.key)))}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
      </div>)}
      {sectors.length < MAX_TACK_SECTORS && <button type="button" className="rf-btn rf-btn-text" onClick={() => edit(() => setSectors((list) => [...list, { key: nextKey++, id: null, name: '' }]))}><Plus className="h-4 w-4" aria-hidden="true" />Add a sector</button>}
      {section.configured && <p className="tools-muted">Removing a sector also removes the results recorded in it.</p>}
    </fieldset>
    {problem && <p role="alert" className="tools-error">{problem}</p>}
    <button className="rf-btn rf-btn-primary rf-wide">{busy ? 'Saving…' : 'Save tack check'}</button>
    {saved && <p role="status" className="rf-note">Tack check saved.</p>}
  </fieldset></form>;
}

function Marks({ competitionId, section, onSaved }: { competitionId: string; section: TackCheckSection; onSaved: (s: TackCheckSection) => void }) {
  if (section.teams.length === 0) return <RefineNote>No teams in this age group yet.</RefineNote>;
  return <>
    <RefineSection title="Results" meta={isScored(section.mode) ? `Points out of ${section.maxPoints} for each sector` : 'Pass or fail for each sector'} />
    {section.teams.map((team) => <TeamMarks key={`${team.teamId}:${section.mode}:${section.sectors.map((s) => s.id).join(',')}:${JSON.stringify(team.marks)}`}competitionId={competitionId} section={section} team={team} onSaved={onSaved} />)}
  </>;
}

function TeamMarks({ competitionId, section, team, onSaved }: { competitionId: string; section: TackCheckSection; team: TackCheckTeam; onSaved: (s: TackCheckSection) => void }) {
  const [draft, setDraft] = useState<Record<number, MarkDraft>>(() => draftFromMarks(section.sectors, team.marks));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const scored = isScored(section.mode);

  function change(sectorId: number, patch: Partial<MarkDraft>) {
    setDraft((current) => ({ ...current, [sectorId]: { ...current[sectorId], ...patch } }));
    setDirty(true); setProblem(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const result = marksFromDraft(draft, section.maxPoints);
    if ('problem' in result) { setProblem(result.problem); return; }
    setBusy(true); setProblem(null);
    try {
      const { data } = await api.put<TackCheckSection>(
        `/event-tools/competitions/${competitionId}/tack-check/sections/${section.sectionId}/teams/${team.teamId}`, { marks: result.marks });
      onSaved(data);
      setDirty(false);
    } catch (caught) { setProblem(message(caught, 'Couldn’t save these results.')); }
    finally { setBusy(false); }
  }

  const tags = [team.isHorsConcours ? 'HC' : null, team.withdrawn ? 'withdrawn' : null].filter(Boolean).join(', ');
  const summary = scored ? `${draftTotal(draft, section.maxPoints)} pts` : `${team.passed} passed, ${team.failed} failed`;
  return <form className="tools-team" onSubmit={save} aria-label={team.teamName} noValidate><fieldset className="tools-fields" disabled={busy}><legend className="sr-only">{team.teamName}</legend>
    <div className="tools-team-head">
      <span><span className="tools-team-name">{team.teamName}</span> <span className="tools-muted">{team.clubName}{tags ? ` (${tags})` : ''}</span></span>
      <span className="tools-muted">{summary}</span>
    </div>
    <div className="tools-grid">
      {section.sectors.map((sector) => scored
        ? <label key={sector.id} className="rf-fld">{sector.name}<NumberField min={0} max={section.maxPoints} value={draft[sector.id]?.points ?? ''} onChange={(event) => change(sector.id, { points: event.target.value })} /></label>
        : <label key={sector.id} className="rf-fld">{sector.name}
          <SelectField value={draft[sector.id]?.passed ?? ''} onChange={(event) => change(sector.id, { passed: event.target.value as MarkDraft['passed'] })}>
            <option value="">Not checked</option><option value="pass">Pass</option><option value="fail">Fail</option>
          </SelectField>
        </label>)}
    </div>
    {problem && <p role="alert" className="tools-error">{problem}</p>}
    <button className="rf-btn rf-btn-primary" disabled={!dirty}>{busy ? 'Saving…' : `Save ${team.teamName}`}</button>
  </fieldset></form>;
}
