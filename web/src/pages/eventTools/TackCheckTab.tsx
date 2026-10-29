import { useT } from '../../i18n/LanguageContext';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useDockAction } from '../../components/TickerContext';
import { useToast } from '../../components/Toast';
import { Chevron, RefineList, RefineNote, RefineSection } from '../refine/Refine';
import {
  MAX_SECTOR_NAME, MAX_TACK_SECTORS, TACK_MODES, draftFromMarks, isScored, marksFromDraft, marksFromRiderGrid,
  riderGridFromMarks, riderGridTotal, riderRowTotal, sectorColumnTotal, sectorProblem, teamRiders,
  type MarkDraft, type RiderGridDraft, type TackTeamWithRiders,
} from '../../lib/tackCheck';
import type { TackCheckBoard, TackCheckMode, TackCheckSection, TackCheckTeam } from '../../types';
import { SelectField } from '../../components/SelectField';
import { NumberField } from '../../components/NumberField';
import { clubLabel } from '../../lib/clubName';

function message(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string; detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.message ?? candidate.response?.data?.title ?? fallback;
}

let nextKey = 1;
interface SectorDraft { key: number; id: number | null; name: string }

/** Set up the tack check for each age group and record each team's result. */
export function TackCheckTab({ competitionId }: { competitionId: string }) {
  const t = useT();
  const [board, setBoard] = useState<TackCheckBoard | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get<TackCheckBoard>(`/event-tools/competitions/${competitionId}/tack-check`)
      .then(({ data }) => { if (!cancelled) { setBoard(data); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(message(caught, t('ops3.tc.loadError'))); });
    return () => { cancelled = true; };
  }, [competitionId, attempt, t]);

  const replace = (section: TackCheckSection) =>
    setBoard((current) => current && { ...current, sections: current.sections.map((s) => (s.sectionId === section.sectionId ? section : s)) });

  const section = board?.sections.find((s) => s.sectionId === sectionId) ?? board?.sections[0] ?? null;
  // Once an age group is set up, the settings, age group and print link go behind the dock button so stewards land
  // on the team checklist. Before that (or with no dock) the set-up stays on the page.
  const [toolsOpen, setToolsOpen] = useState(false);
  const docked = useDockAction(section?.configured ? { label: t('ops3.tc.settingsSheet'), icon: 'settings', onClick: () => setToolsOpen(true) } : null);
  const inSheet = docked && !!section?.configured;
  const printLink = <nav aria-label={t('ops3.tc.form')}><RefineList as="div">
    <Link className="rf-row" to={`/event-tools/${competitionId}/print/tack-check`}>
      <span className="rf-grow"><span className="rf-t1">{t('ops3.tc.print')}</span><span className="rf-t2">{t('ops3.tc.printSub')}</span></span><Chevron />
    </Link>
  </RefineList></nav>;
  const ageGroup = board && section && board.sections.length > 1 && <label className="rf-fld">{t('ops3.book.ageGroup')}
    <SelectField value={section.sectionId} onChange={(event) => { setSectionId(Number(event.target.value)); setToolsOpen(false); }}>
      {board.sections.map((s) => <option key={s.sectionId} value={s.sectionId}>{s.sectionName}</option>)}
    </SelectField>
  </label>;
  const settings = board && section && <SettingsForm key={section.sectionId} competitionId={competitionId} section={section} onSaved={replace} />;
  return <section aria-labelledby="tack-title">
    {/* The page title above already says Tack check, so the section's heading is for screen readers only. */}
    <h2 id="tack-title" className="sr-only">{t('ops3.tc.title')}</h2>
    {!inSheet && printLink}
    {error && <Notice className="tools-msg" actionLabel={t('common.tryAgain')} onAction={() => setAttempt((n) => n + 1)}>{error}</Notice>}
    {!board && !error && <p role="status" className="rf-note">{t('ops3.tc.loading')}</p>}
    {board && board.sections.length === 0 && <RefineNote>{t('ops3.tc.addGroup')}</RefineNote>}
    {board && section && <div className="tools-form">
      {!inSheet && ageGroup}
      {!inSheet && settings}
      {section.configured && section.isEnabled && <Marks key={section.sectionId} competitionId={competitionId} section={section} onSaved={replace} />}
    </div>}
    {inSheet && toolsOpen && <Sheet title={t('ops3.tc.settingsSheet')} onClose={() => setToolsOpen(false)}>
      {printLink}
      <div className="tools-form">{ageGroup}{settings}</div>
    </Sheet>}
  </section>;
}

function SettingsForm({ competitionId, section, onSaved }: { competitionId: string; section: TackCheckSection; onSaved: (s: TackCheckSection) => void }) {
  const t = useT();
  const [enabled, setEnabled] = useState(section.configured ? section.isEnabled : true);
  const [mode, setMode] = useState<TackCheckMode>(section.mode);
  const [maxPoints, setMaxPoints] = useState(String(section.maxPoints));
  const [sectors, setSectors] = useState<SectorDraft[]>(() => section.sectors.map((s) => ({ key: nextKey++, id: s.id || null, name: s.name })));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  function edit(change: () => void) { change(); setProblem(null); }

  async function save(event: FormEvent) {
    event.preventDefault();
    const max = Number(maxPoints);
    const issue = sectorProblem(sectors.map((s) => s.name))
      ?? (Number.isInteger(max) && max >= 1 && max <= 100 ? null : t('ops3.tc.maxPoints'));
    if (issue) { setProblem(issue); return; }
    setBusy(true); setProblem(null);
    try {
      const { data } = await api.put<TackCheckSection>(`/event-tools/competitions/${competitionId}/tack-check/sections/${section.sectionId}`, {
        isEnabled: enabled, mode, maxPoints: max, sectors: sectors.map((s) => ({ id: s.id, name: s.name.trim() })),
      });
      onSaved(data);
      // New sectors now have ids; keep them so the next save updates rather than adds.
      setSectors(data.sectors.map((s) => ({ key: nextKey++, id: s.id, name: s.name })));
      toast.show(t('ops3.tc.saved'));
    } catch (caught) { setProblem(message(caught, t('ops3.tc.saveError'))); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} noValidate><fieldset className="tools-fields" disabled={busy}><legend className="sr-only">{t('ops3.tc.setupFor', { name: section.sectionName })}</legend>
    <label className="tools-check"><input type="checkbox" checked={enabled} onChange={(event) => edit(() => setEnabled(event.target.checked))} />{t('ops3.tc.runFor', { name: section.sectionName })}</label>
    <fieldset className="tools-fields"><legend className="rf-fld">{t('ops3.tc.counts')}</legend>
      {TACK_MODES.map((option) => <label key={option.mode} className="tools-check">
        <input type="radio" name={`tack-mode-${section.sectionId}`} checked={mode === option.mode} onChange={() => edit(() => setMode(option.mode))} />
        <span>{option.label}<span className="tools-check-sub">{option.detail}</span></span>
      </label>)}
    </fieldset>
    {isScored(mode) && <label className="rf-fld">{t('ops3.tc.mostPoints')}<NumberField min={1} max={100} value={maxPoints} onChange={(event) => edit(() => setMaxPoints(event.target.value))} /></label>}
    <fieldset className="tools-fields"><legend className="rf-fld">{t('ops3.tc.sectors')}</legend>
      {sectors.map((sector, index) => <div key={sector.key} className="tools-row">
        <label className="rf-fld">{t('ops3.tc.sectorN', { n: index + 1 })}<input value={sector.name} maxLength={MAX_SECTOR_NAME} onChange={(event) => edit(() => setSectors((list) => list.map((s) => (s.key === sector.key ? { ...s, name: event.target.value } : s))))} /></label>
        <button type="button" className="rf-btn rf-btn-text" aria-label={t('ops3.tc.removeSector', { n: index + 1 })} onClick={() => edit(() => setSectors((list) => list.filter((s) => s.key !== sector.key)))}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
      </div>)}
      {sectors.length < MAX_TACK_SECTORS && <button type="button" className="rf-btn rf-btn-text" onClick={() => edit(() => setSectors((list) => [...list, { key: nextKey++, id: null, name: '' }]))}><Plus className="h-4 w-4" aria-hidden="true" />{t('ops3.tc.addSector')}</button>}
      {section.configured && <p className="tools-muted">{t('ops3.tc.removeNote')}</p>}
    </fieldset>
    {problem && <Notice>{problem}</Notice>}
    <button className="rf-btn rf-btn-primary rf-wide">{busy ? t('common.saving') : t('ops3.tc.save')}</button>
    {toast.node}
  </fieldset></form>;
}

function Marks({ competitionId, section, onSaved }: { competitionId: string; section: TackCheckSection; onSaved: (s: TackCheckSection) => void }) {
  const t = useT();
  if (section.teams.length === 0) return <RefineNote>{t('ops3.tc.noTeams')}</RefineNote>;
  return <>
    <RefineSection title={t('ops2.sp.results')} meta={isScored(section.mode) ? t('ops3.tc.outOf', { max: section.maxPoints }) : t('ops3.tc.passFail')} />
    {section.teams.map((team) => <TeamMarks key={`${team.teamId}:${section.mode}:${section.sectors.map((s) => s.id).join(',')}:${JSON.stringify(team.marks)}`}competitionId={competitionId} section={section} team={team} onSaved={onSaved} />)}
  </>;
}

function TeamMarks({ competitionId, section, team, onSaved }: { competitionId: string; section: TackCheckSection; team: TackCheckTeam; onSaved: (s: TackCheckSection) => void }) {
  const t = useT();
  const riders = teamRiders(team as TackTeamWithRiders);
  const [draft, setDraft] = useState<Record<number, MarkDraft>>(() => draftFromMarks(section.sectors, team.marks));
  const [grid, setGrid] = useState<RiderGridDraft>(() => riderGridFromMarks(section.sectors, (team as TackTeamWithRiders).marks, riders.length));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const scored = isScored(section.mode);

  function change(sectorId: number, patch: Partial<MarkDraft>) {
    setDraft((current) => ({ ...current, [sectorId]: { ...current[sectorId], ...patch } }));
    setDirty(true); setProblem(null);
  }

  function changeRiderCell(sectorId: number, riderIndex: number, value: string) {
    setGrid((current) => {
      const row = [...(current[sectorId] ?? Array.from({ length: riders.length }, () => ''))];
      row[riderIndex] = value;
      return { ...current, [sectorId]: row };
    });
    setDirty(true); setProblem(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const result = scored ? marksFromRiderGrid(grid, section.maxPoints) : marksFromDraft(draft, section.maxPoints);
    if ('problem' in result) { setProblem(result.problem); return; }
    setBusy(true); setProblem(null);
    try {
      const { data } = await api.put<TackCheckSection>(
        `/event-tools/competitions/${competitionId}/tack-check/sections/${section.sectionId}/teams/${team.teamId}`, { marks: result.marks });
      onSaved(data);
      setDirty(false);
    } catch (caught) { setProblem(message(caught, t('ops3.tc.resultsError'))); }
    finally { setBusy(false); }
  }

  const tags = [team.isHorsConcours ? 'HC' : null, team.withdrawn ? t('ops3.withdrawn') : null].filter(Boolean).join(', ');
  const teamTotal = riderGridTotal(grid, section.maxPoints);
  const summary = scored ? t('ops3.digest.pts', { points: teamTotal }) : t('ops3.tc.summary', { passed: team.passed, failed: team.failed });
  return <form className="tools-team" onSubmit={save} aria-label={team.teamName} noValidate><fieldset className="tools-fields" disabled={busy}><legend className="sr-only">{team.teamName}</legend>
    <div className="tools-team-head">
      <span><span className="tools-team-name">{team.teamName}</span> <span className="tools-muted">{clubLabel(team.clubName)}{tags ? ` (${tags})` : ''}</span></span>
      <span className="tools-muted">{summary}</span>
    </div>
    {scored ? (
      <div className="overflow-hidden">
        {/* Sectors share what the rider names leave, so the grid never scrolls sideways on a phone. */}
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-[30%] text-left py-1 pr-2">{t('ops3.rider')}</th>
              {section.sectors.map((sector) => <th key={sector.id} scope="col" className="break-words text-left py-1 px-1 text-xs leading-tight">{sector.name}</th>)}
              <th scope="col" className="w-12 text-right py-1 pl-2">{t('ops3.tc.riderTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {riders.map((riderName, riderIndex) => (
              <tr key={`${riderIndex}-${riderName}`} className="border-t border-[rgb(var(--mg-rule-soft))]">
                <th scope="row" className="break-words py-1.5 pr-2 text-left font-medium">{riderName}</th>
                {section.sectors.map((sector) => (
                  <td key={sector.id} className="py-1 px-1">
                    <NumberField
                      aria-label={`${riderName} ${sector.name}`}
                      className="input w-full min-w-0 !px-1 text-center"
                      min={0}
                      max={section.maxPoints}
                      value={grid[sector.id]?.[riderIndex] ?? ''}
                      onChange={(event) => changeRiderCell(sector.id, riderIndex, event.target.value)}
                    />
                  </td>
                ))}
                <td className="py-1.5 pl-2 text-right font-semibold tabular-nums" data-testid={`rider-total-${riderIndex}`}>
                  {riderRowTotal(grid, riderIndex, section.maxPoints)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[rgb(var(--mg-rule-soft))] font-semibold">
              <th scope="row" className="py-1.5 pr-2 text-left">{t('ops3.tc.teamTotal')}</th>
              {section.sectors.map((sector) => (
                <td key={sector.id} className="py-1.5 px-1 tabular-nums">{sectorColumnTotal(grid, sector.id, section.maxPoints)}</td>
              ))}
              <td className="py-1.5 pl-2 text-right tabular-nums" data-testid="team-total">{t('ops3.digest.pts', { points: teamTotal })}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    ) : (
      <div className="tools-grid">
        {section.sectors.map((sector) => (
          <label key={sector.id} className="rf-fld">{sector.name}
            <SelectField value={draft[sector.id]?.passed ?? ''} onChange={(event) => change(sector.id, { passed: event.target.value as MarkDraft['passed'] })}>
              <option value="">{t('ops3.tc.notChecked')}</option><option value="pass">{t('ops3.tc.pass')}</option><option value="fail">{t('ops3.tc.fail')}</option>
            </SelectField>
          </label>
        ))}
      </div>
    )}
    {problem && <Notice>{problem}</Notice>}
    <button className="rf-btn rf-btn-primary" disabled={!dirty}>{busy ? t('common.saving') : t('ops3.tc.saveTeam', { name: team.teamName })}</button>
  </fieldset></form>;
}
