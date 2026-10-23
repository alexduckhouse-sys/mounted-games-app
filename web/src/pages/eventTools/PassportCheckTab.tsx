import { useEffect, useState } from 'react';
import { api } from '../../api';
import { RefineNote, RefineSection } from '../refine/Refine';
import type { PassportCheckBoard, PassportCheckPony } from '../../types';

function message(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string; detail?: string; title?: string } } };
  return candidate.response?.data?.detail ?? candidate.response?.data?.message ?? candidate.response?.data?.title ?? fallback;
}

function time(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The passport and vaccination check on arrival. Ponies come from each team's declaration and are ticked off one
 * team at a time; ponies with the same name in different teams are separate and never flagged.
 */
export function PassportCheckTab({ competitionId }: { competitionId: string }) {
  const [board, setBoard] = useState<PassportCheckBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const base = `/event-tools/competitions/${competitionId}/passport-check`;

  useEffect(() => {
    let cancelled = false;
    api.get<PassportCheckBoard>(base)
      .then(({ data }) => { if (!cancelled) { setBoard(data); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(message(caught, 'Couldn’t load the passport check.')); });
    return () => { cancelled = true; };
  }, [base, attempt]);

  async function toggle(enabled: boolean) {
    setBusy('settings'); setError(null);
    try { setBoard((await api.put<PassportCheckBoard>(`${base}/settings`, { enabled })).data); }
    catch (caught) { setError(message(caught, 'Couldn’t change the passport check.')); }
    finally { setBusy(null); }
  }

  async function tick(teamId: number, pony: PassportCheckPony, checked: boolean) {
    const key = `${teamId}:${pony.ponyName}`;
    setBusy(key); setError(null);
    try {
      const { data } = await api.put<PassportCheckPony>(`${base}/teams/${teamId}`, { ponyName: pony.ponyName, checked });
      setBoard((current) => {
        if (!current) return current;
        const sections = current.sections.map((section) => ({
          ...section,
          teams: section.teams.map((team) => (team.teamId !== teamId ? team : { ...team, ponies: team.ponies.map((p) => (p.ponyName === pony.ponyName ? data : p)) })),
        }));
        const done = sections.flatMap((s) => s.teams).flatMap((t) => t.ponies).filter((p) => p.checkedAt).length;
        return { ...current, sections, checked: done };
      });
    } catch (caught) { setError(message(caught, 'Couldn’t save that tick.')); }
    finally { setBusy(null); }
  }

  const search = filter.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(search);
  return <section aria-labelledby="passport-title">
    <RefineSection title="Passport check" />
    <h2 id="passport-title" className="sr-only">Passport check</h2>
    <RefineNote>For events that check each pony’s passport and vaccinations on arrival. Only the event’s staff see this.</RefineNote>
    {error && <div role="alert" className="mg-notice tools-msg">{error} {!board && <button type="button" className="rf-btn rf-btn-text" onClick={() => setAttempt((n) => n + 1)}>Try again</button>}</div>}
    {!board && !error && <p role="status" className="rf-note">Loading the passport check…</p>}
    {board && <div className="tools-form">
      <label className="tools-check"><input type="checkbox" checked={board.enabled} disabled={busy !== null} onChange={(event) => toggle(event.target.checked)} />Check passports at this event</label>
      {!board.enabled && <RefineNote>Turn this on to tick off ponies as they arrive. Turning it off later keeps the ticks.</RefineNote>}
      {board.enabled && <>
        <p role="status" className="tools-muted">{board.checked} of {board.total} {board.total === 1 ? 'pony' : 'ponies'} checked</p>
        <label className="rf-fld">Find a team or pony<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        {board.sections.map((section) => {
          const teams = section.teams.filter((team) => !search || matches(team.teamName) || matches(team.clubName) || team.ponies.some((p) => matches(p.ponyName)));
          if (teams.length === 0) return null;
          return <div key={section.sectionId} className="tools-fields">
            <RefineSection title={section.sectionName} />
            {teams.map((team) => <div key={team.teamId} className="tools-team">
              <div className="tools-team-head">
                <span><span className="tools-team-name">{team.teamName}</span> <span className="tools-muted">{team.clubName}{team.withdrawn ? ' (withdrawn)' : ''}</span></span>
              </div>
              {!team.hasDeclaration && <p className="tools-muted">No declaration yet, so no ponies to check.</p>}
              {team.hasDeclaration && team.ponies.length === 0 && <p className="tools-muted">The declaration has no pony names.</p>}
              {team.ponies.map((pony) => <label key={pony.ponyName} className="tools-check">
                <input type="checkbox" checked={pony.checkedAt !== null} disabled={busy !== null} onChange={(event) => tick(team.teamId, pony, event.target.checked)} />
                <span>{pony.ponyName}<span className="tools-check-sub">{pony.riders.join(', ')}{pony.checkedAt ? ` · checked ${time(pony.checkedAt)}${pony.checkedByName ? ` by ${pony.checkedByName}` : ''}` : ''}</span></span>
              </label>)}
            </div>)}
          </div>;
        })}
        {board.total === 0 && <RefineNote>No ponies have been declared yet.</RefineNote>}
      </>}
    </div>}
  </section>;
}
