import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { RefineNote, RefineSection } from '../refine/Refine';
import type { PassportCheckBoard, PassportCheckPony } from '../../types';

function message(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string; detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.message ?? candidate.response?.data?.title ?? fallback;
}

function time(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function addMonthsIso(baseIso: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseIso.trim());
  const base = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date();
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

interface InspectionDraft {
  passportCode: string;
  ownerFullName: string;
  lastFluVaccineDate: string;
  fluValidUntil: string;
  lastTetanusDate: string;
  tetanusValidUntil: string;
  inspectorRole: 'Vet' | 'Official';
  officialNotes: string;
}

function draftFromPony(pony: PassportCheckPony): InspectionDraft {
  return {
    passportCode: pony.passportCode ?? '',
    ownerFullName: pony.ownerFullName ?? '',
    lastFluVaccineDate: pony.lastFluVaccineDate ?? '',
    fluValidUntil: pony.fluValidUntil ?? '',
    lastTetanusDate: pony.lastTetanusDate ?? '',
    tetanusValidUntil: pony.tetanusValidUntil ?? '',
    inspectorRole: pony.inspectorRole === 'Vet' ? 'Vet' : 'Official',
    officialNotes: pony.officialNotes ?? '',
  };
}

function isPonyCertified(pony: PassportCheckPony): boolean {
  if (pony.status) return pony.status === 'Certified';
  if (typeof pony.certified === 'boolean') return pony.certified;
  return pony.checkedAt !== null;
}

/**
 * The passport and vaccination check on arrival. Ponies come from each team's declaration and are ticked off one
 * team at a time; vet or official inspection details (passport code, owner full name, flu and tetanus dates, and
 * notes) certify the horse until its vaccine validity dates run out.
 */
export function PassportCheckTab({ competitionId }: { competitionId: string }) {
  const [board, setBoard] = useState<PassportCheckBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, InspectionDraft>>({});
  const base = `/event-tools/competitions/${competitionId}/passport-check`;

  useEffect(() => {
    let cancelled = false;
    api.get<PassportCheckBoard>(base)
      .then(({ data }) => { if (!cancelled) { setBoard(data); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(message(caught, 'Couldn’t load the passport check. Check your signal and try again.')); });
    return () => { cancelled = true; };
  }, [base, attempt]);

  async function toggle(enabled: boolean) {
    setBusy('settings'); setError(null);
    try { setBoard((await api.put<PassportCheckBoard>(`${base}/settings`, { enabled })).data); }
    catch (caught) { setError(message(caught, 'Couldn’t change the passport check. Check your signal and try again.')); }
    finally { setBusy(null); }
  }

  function applyUpdatedPony(teamId: number, ponyName: string, data: PassportCheckPony) {
    setBoard((current) => {
      if (!current) return current;
      const sections = current.sections.map((section) => ({
        ...section,
        teams: section.teams.map((team) => (team.teamId !== teamId ? team : { ...team, ponies: team.ponies.map((p) => (p.ponyName === ponyName ? data : p)) })),
      }));
      const done = sections.flatMap((s) => s.teams).flatMap((t) => t.ponies).filter(isPonyCertified).length;
      return { ...current, sections, checked: done };
    });
  }

  async function tick(teamId: number, pony: PassportCheckPony, checked: boolean) {
    const key = `${teamId}:${pony.ponyName}`;
    setBusy(key); setError(null);
    try {
      const { data } = await api.put<PassportCheckPony>(`${base}/teams/${teamId}`, { ponyName: pony.ponyName, checked });
      applyUpdatedPony(teamId, pony.ponyName, data);
    } catch (caught) { setError(message(caught, 'Couldn’t save that tick. Check your signal and try again.')); }
    finally { setBusy(null); }
  }

  function toggleEditor(key: string, pony: PassportCheckPony) {
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setDrafts((prev) => ({ ...prev, [key]: prev[key] ?? draftFromPony(pony) }));
    setOpenKey(key);
  }

  function updateDraft(key: string, pony: PassportCheckPony, patch: Partial<InspectionDraft>) {
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? draftFromPony(pony)), ...patch } }));
  }

  async function saveInspection(teamId: number, pony: PassportCheckPony) {
    const key = `${teamId}:${pony.ponyName}`;
    const draft = drafts[key] ?? draftFromPony(pony);
    setBusy(key); setError(null);
    try {
      const { data } = await api.put<PassportCheckPony>(`${base}/teams/${teamId}`, {
        ponyName: pony.ponyName,
        checked: true,
        passportCode: draft.passportCode.trim() || null,
        ownerFullName: draft.ownerFullName.trim() || null,
        lastFluVaccineDate: draft.lastFluVaccineDate.trim() || null,
        fluValidUntil: draft.fluValidUntil.trim() || null,
        lastTetanusDate: draft.lastTetanusDate.trim() || null,
        tetanusValidUntil: draft.tetanusValidUntil.trim() || null,
        inspectorRole: draft.inspectorRole,
        officialNotes: draft.officialNotes.trim() || null,
      });
      applyUpdatedPony(teamId, pony.ponyName, data);
      setDrafts((prev) => ({ ...prev, [key]: draftFromPony(data) }));
      setOpenKey(null);
    } catch (caught) { setError(message(caught, 'Couldn’t save that inspection. Check your signal and try again.')); }
    finally { setBusy(null); }
  }

  const search = filter.trim().toLowerCase();
  const matches = (text: string | null | undefined) => Boolean(text && text.toLowerCase().includes(search));
  const ponyMatches = (p: PassportCheckPony) =>
    matches(p.ponyName)
    || p.riders.some((r) => matches(r))
    || matches(p.passportCode)
    || matches(p.ownerFullName);

  return <section aria-labelledby="passport-title">
    <RefineSection title="Passport check" />
    <h2 id="passport-title" className="sr-only">Passport check</h2>
    <RefineNote>For events that check each pony’s passport and vaccinations on arrival. Only the event’s staff see this.</RefineNote>
    {error && <Notice className="tools-msg" actionLabel={!board ? 'Try again' : undefined} onAction={() => setAttempt((n) => n + 1)}>{error}</Notice>}
    {!board && !error && <p role="status" className="rf-note">Loading the passport check…</p>}
    {board && <div className="tools-form">
      <label className="tools-check"><input type="checkbox" checked={board.enabled} disabled={busy !== null} onChange={(event) => toggle(event.target.checked)} />Check passports at this event</label>
      {!board.enabled && <RefineNote>Turn this on to tick off ponies as they arrive. Turning it off later keeps the ticks.</RefineNote>}
      {board.enabled && <>
        <label className="tools-search"><Search aria-hidden="true" /><input type="search" aria-label="Find a team or pony" placeholder="Search ponies, riders, teams or owners" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        {board.sections.map((section) => {
          const teams = section.teams.filter((team) => !search || matches(team.teamName) || matches(team.clubName) || team.ponies.some(ponyMatches));
          if (teams.length === 0) return null;
          return <div key={section.sectionId} className="tools-fields">
            <RefineSection title={section.sectionName} />
            {teams.map((team) => <div key={team.teamId} className="tools-team">
              <div className="tools-team-head">
                <span><span className="tools-team-name">{team.teamName}</span> <span className="tools-muted">{team.clubName}{team.withdrawn ? ' (withdrawn)' : ''}</span></span>
              </div>
              {!team.hasDeclaration && <p className="tools-muted">No declaration yet, so no ponies to check.</p>}
              {team.hasDeclaration && team.ponies.length === 0 && <p className="tools-muted">The declaration has no pony names.</p>}
              {team.ponies.map((pony) => {
                const key = `${team.teamId}:${pony.ponyName}`;
                const certified = isPonyCertified(pony);
                const status = pony.status ?? (certified ? 'Certified' : 'Unchecked');
                const isOpen = openKey === key;
                const draft = drafts[key] ?? draftFromPony(pony);
                const identityParts = [
                  pony.passportCode ? `Passport: ${pony.passportCode}` : null,
                  pony.ownerFullName ? `Owner: ${pony.ownerFullName}` : null,
                ].filter(Boolean);
                const vaccineParts = [
                  pony.lastFluVaccineDate ? `Last flu: ${pony.lastFluVaccineDate}${pony.fluValidUntil ? ` (until ${pony.fluValidUntil})` : ''}` : null,
                  pony.lastTetanusDate ? `Last tetanus: ${pony.lastTetanusDate}${pony.tetanusValidUntil ? ` (until ${pony.tetanusValidUntil})` : ''}` : null,
                  pony.officialNotes
                    ? `${pony.inspectorRole ?? 'Official'}${pony.checkedByName ? ` ${pony.checkedByName}` : ''}: “${pony.officialNotes}”`
                    : null,
                ].filter(Boolean);

                return <div key={pony.ponyName} className="border-b border-[rgb(var(--mg-rule))]/60 py-1.5 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <label className="tools-check flex-1">
                      <input type="checkbox" checked={certified} disabled={busy !== null} onChange={(event) => tick(team.teamId, pony, event.target.checked)} />
                      <span>
                        <span className="font-medium">{pony.ponyName}</span>
                        {status === 'Certified' && <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Certified ✓</span>}
                        {status === 'Expired' && <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">Vaccine expired</span>}
                        {status === 'TooRecent' && <span className="ml-2 inline-flex items-center rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">&lt;7d rule</span>}
                        <span className="tools-check-sub">
                          {pony.riders.join(', ')}
                          {pony.checkedAt ? ` · checked ${time(pony.checkedAt)}${pony.checkedByName ? ` by ${pony.checkedByName}` : ''}` : ''}
                        </span>
                        {identityParts.length > 0 && <span className="tools-check-sub block text-xs">{identityParts.join(' · ')}</span>}
                        {vaccineParts.length > 0 && <span className="tools-check-sub block text-xs">{vaccineParts.join(' · ')}</span>}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="rf-btn rf-btn-text text-xs"
                      onClick={() => toggleEditor(key, pony)}
                    >
                      {isOpen ? 'Close inspection' : 'Vet / Official inspection'}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="mt-2 grid gap-2.5 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface-muted))]/40 p-3 text-sm sm:grid-cols-2">
                      <label className="rf-fld">
                        Passport code
                        <input
                          type="text"
                          placeholder="e.g. GBR-826001234"
                          value={draft.passportCode}
                          onChange={(e) => updateDraft(key, pony, { passportCode: e.target.value })}
                        />
                      </label>
                      <label className="rf-fld">
                        Owner full name
                        <input
                          type="text"
                          placeholder="e.g. Sarah Clarke"
                          value={draft.ownerFullName}
                          onChange={(e) => updateDraft(key, pony, { ownerFullName: e.target.value })}
                        />
                      </label>
                      <label className="rf-fld">
                        Last flu vaccine date
                        <input
                          type="date"
                          value={draft.lastFluVaccineDate}
                          onChange={(e) => {
                            const nextFlu = e.target.value;
                            updateDraft(key, pony, {
                              lastFluVaccineDate: nextFlu,
                              fluValidUntil: draft.fluValidUntil || (nextFlu ? addMonthsIso(nextFlu, 12) : ''),
                            });
                          }}
                        />
                      </label>
                      <div className="flex flex-col gap-1">
                        <label className="rf-fld">
                          Flu valid until
                          <input
                            type="date"
                            value={draft.fluValidUntil}
                            onChange={(e) => updateDraft(key, pony, { fluValidUntil: e.target.value })}
                          />
                        </label>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className="rf-btn rf-btn-text text-xs"
                            onClick={() => updateDraft(key, pony, { fluValidUntil: addMonthsIso(draft.lastFluVaccineDate, 6) })}
                          >
                            +6m
                          </button>
                          <button
                            type="button"
                            className="rf-btn rf-btn-text text-xs"
                            onClick={() => updateDraft(key, pony, { fluValidUntil: addMonthsIso(draft.lastFluVaccineDate, 12) })}
                          >
                            +12m
                          </button>
                        </div>
                      </div>
                      <label className="rf-fld">
                        Last tetanus date
                        <input
                          type="date"
                          value={draft.lastTetanusDate}
                          onChange={(e) => {
                            const nextTet = e.target.value;
                            updateDraft(key, pony, {
                              lastTetanusDate: nextTet,
                              tetanusValidUntil: draft.tetanusValidUntil || (nextTet ? addMonthsIso(nextTet, 24) : ''),
                            });
                          }}
                        />
                      </label>
                      <div className="flex flex-col gap-1">
                        <label className="rf-fld">
                          Tetanus valid until
                          <input
                            type="date"
                            value={draft.tetanusValidUntil}
                            onChange={(e) => updateDraft(key, pony, { tetanusValidUntil: e.target.value })}
                          />
                        </label>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className="rf-btn rf-btn-text text-xs"
                            onClick={() => updateDraft(key, pony, { tetanusValidUntil: addMonthsIso(draft.lastTetanusDate, 24) })}
                          >
                            +24m
                          </button>
                        </div>
                      </div>
                      <label className="rf-fld">
                        Role
                        <select
                          value={draft.inspectorRole}
                          onChange={(e) => updateDraft(key, pony, { inspectorRole: e.target.value === 'Vet' ? 'Vet' : 'Official' })}
                        >
                          <option value="Vet">Vet</option>
                          <option value="Official">Official</option>
                        </select>
                      </label>
                      <label className="rf-fld sm:col-span-2">
                        What the vet / official said
                        <input
                          type="text"
                          placeholder="e.g. Annual flu & tetanus boosters verified against passport"
                          value={draft.officialNotes}
                          onChange={(e) => updateDraft(key, pony, { officialNotes: e.target.value })}
                        />
                      </label>
                      <div className="flex items-center justify-end gap-2 sm:col-span-2">
                        <button
                          type="button"
                          className="rf-btn rf-btn-primary text-xs"
                          disabled={busy !== null}
                          onClick={() => saveInspection(team.teamId, pony)}
                        >
                          Save &amp; certify
                        </button>
                      </div>
                    </div>
                  )}
                </div>;
              })}
            </div>)}
          </div>;
        })}
        {board.total === 0 && <RefineNote>No ponies have been declared yet.</RefineNote>}
        <RefineNote>Event check aid — organisers and vets remain responsible for verifying physical equine passports.</RefineNote>
      </>}
    </div>}
  </section>;
}
