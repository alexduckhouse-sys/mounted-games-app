import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Notice } from '../../components/Notice';
import { useCompetition } from '../competition/context';
import { Chevron, RefineList, RefineNote, RefineSection, RefineSheet, RefineStatus } from '../refine/Refine';
import { RedrawPreviewView } from './RedrawPreviewView';
import { RiderSwapSheet } from './RiderSwapSheet';
import type { SetTeamEntryStatusResult, TeamEntry, TeamEntryStatus } from './types';
import { OFFLINE_MESSAGE, apiMessage, isOffline, statusOf } from './types';
import './operations.css';

interface StatusSheet { team: TeamEntry; next: TeamEntryStatus }

const STATUS_LABEL: Record<TeamEntryStatus, string> = { 0: 'In the draw', 1: 'Withdrawn', 2: 'No-show' };

function whenText(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Organiser's list of every team's entry status: withdraw a team or mark a no-show, reinstate it, swap a rider
 * for a reserve, and open the re-draw preview for the unscored heats. Reasons are shown here only.
 */
export function EntriesPanel({ canWrite, onTimetableChanged }: { canWrite: boolean; onTimetableChanged: () => void }) {
  const { competition } = useCompetition();
  const [entries, setEntries] = useState<TeamEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<StatusSheet | null>(null);
  const [swapTeam, setSwapTeam] = useState<TeamEntry | null>(null);
  const [redrawSection, setRedrawSection] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<TeamEntry[]>(`/competitions/${competition.id}/entries`);
      setEntries(Array.isArray(data) ? data : []);
    } catch (error) {
      setLoadError(isOffline(error)
        ? OFFLINE_MESSAGE
        : apiMessage(error, 'Couldn’t load the entries. Check your signal and try again.'));
    } finally {
      setLoading(false);
    }
  }, [competition.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const bySection = useMemo(() => {
    const groups = new Map<number, { name: string; teams: TeamEntry[] }>();
    for (const entry of entries ?? []) {
      const group = groups.get(entry.sectionId) ?? { name: entry.sectionName, teams: [] };
      group.teams.push(entry);
      groups.set(entry.sectionId, group);
    }
    return [...groups.entries()];
  }, [entries]);
  const redrawSections = bySection.filter(([, group]) => group.teams.some((team) => team.redrawAvailable));

  if (redrawSection != null) {
    const name = bySection.find(([id]) => id === redrawSection)?.[1].name ?? 'Section';
    return (
      <RedrawPreviewView
        competitionId={competition.id}
        sectionId={redrawSection}
        sectionName={name}
        canWrite={canWrite}
        onClose={() => { setRedrawSection(null); void load(); }}
        onApplied={() => { setMessage('Re-draw applied. Phones following this event will update.'); onTimetableChanged(); }}
      />
    );
  }

  return (
    <section aria-label="Entries">
      {message && <Notice tone="info" onDismiss={() => setMessage(null)}>{message}</Notice>}
      {loading && !entries && <p role="status" className="rf-note">Loading teams…</p>}
      {loadError && <Notice actionLabel="Try again" onAction={() => void load()}>{loadError}</Notice>}
      {entries && entries.length === 0 && <RefineNote>No teams have entered yet.</RefineNote>}

      {redrawSections.length > 0 && (
        <>
          <RefineSection title="Re-draw" />
          <RefineList as="div" label="Re-draw previews">
            {redrawSections.map(([id, group]) => {
              const out = group.teams.filter((team) => team.status !== 0).length;
              return (
                <button key={id} type="button" className="rf-row" onClick={() => setRedrawSection(id)}>
                  <span className="rf-grow"><span className="rf-t1">{group.name}</span><span className="rf-t2">{out === 1 ? '1 team is out' : `${out} teams are out`}. Preview how the unscored heats would change.</span></span>
                  <Chevron />
                </button>
              );
            })}
          </RefineList>
        </>
      )}

      {bySection.map(([id, group]) => (
        <div key={id}>
          <RefineSection title={group.name} />
          <RefineList as="ul" label={`${group.name} teams`}>
            {group.teams.map((team) => (
              <li key={team.teamId} className="ops-entry">
                <div className="rf-row ops-entry-head">
                  <span className="rf-grow">
                    <span className="rf-t1">{team.teamName}</span>
                    {team.status !== 0 && (
                      <span className="rf-t2">
                        {team.reason ? `${team.reason} · ` : ''}{whenText(team.changedAt)}
                      </span>
                    )}
                  </span>
                  {team.status === 0 ? <RefineStatus tone="mut">{STATUS_LABEL[0]}</RefineStatus> : <RefineStatus tone="warn">{STATUS_LABEL[team.status]}</RefineStatus>}
                </div>
                <div className="ops-entry-actions">
                  {team.status === 0 ? (
                    <>
                      <button type="button" className="rf-btn" disabled={!canWrite} onClick={() => setSheet({ team, next: 1 })} aria-label={`Withdraw ${team.teamName}`}>Withdraw</button>
                      <button type="button" className="rf-btn" disabled={!canWrite} onClick={() => setSheet({ team, next: 2 })} aria-label={`Mark ${team.teamName} as a no-show`}>No-show</button>
                      <button type="button" className="rf-btn" disabled={!canWrite} onClick={() => setSwapTeam(team)} aria-label={`Swap a rider for ${team.teamName}`}>Swap rider</button>
                    </>
                  ) : team.canReinstate ? (
                    <button type="button" className="rf-btn" disabled={!canWrite} onClick={() => setSheet({ team, next: 0 })} aria-label={`Reinstate ${team.teamName}`}>Reinstate</button>
                  ) : (
                    <span className="rf-t2">A draw has been applied since, so this can’t be undone here. Add the team back from the timetable editor.</span>
                  )}
                </div>
              </li>
            ))}
          </RefineList>
        </div>
      ))}

      {sheet && (
        <StatusSheetView
          key={`${sheet.team.teamId}:${sheet.next}`}
          competitionId={competition.id}
          sheet={sheet}
          onClose={() => setSheet(null)}
          onDone={(result) => {
            setSheet(null);
            const places = result.heatPlacesChanged;
            setMessage(sheet.next === 0
              ? `${sheet.team.teamName} is back in the draw${places > 0 ? ` and was put back in ${places === 1 ? '1 heat' : `${places} heats`}` : ''}.`
              : `${sheet.team.teamName} is out${places > 0 ? ` of ${places === 1 ? '1 unscored heat' : `${places} unscored heats`}. Preview a re-draw to tidy the rest` : ''}.`);
            onTimetableChanged();
            void load();
          }}
        />
      )}
      {swapTeam && (
        <RiderSwapSheet
          competitionId={competition.id}
          team={swapTeam}
          canWrite={canWrite}
          onClose={() => setSwapTeam(null)}
          onSwapped={(text) => { setMessage(text); }}
        />
      )}
    </section>
  );
}

function StatusSheetView({ competitionId, sheet, onClose, onDone }: {
  competitionId: number;
  sheet: StatusSheet;
  onClose: () => void;
  onDone: (result: SetTeamEntryStatusResult) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { team, next } = sheet;
  const title = next === 1 ? `Withdraw ${team.teamName}` : next === 2 ? `${team.teamName}: no-show` : `Reinstate ${team.teamName}`;
  const needsReason = next === 1;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (needsReason && !reason.trim()) { setError('Say why the team is withdrawing.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.put<SetTeamEntryStatusResult>(
        `/competitions/${competitionId}/teams/${team.teamId}/entry-status`,
        { status: next, reason: reason.trim() || null },
      );
      onDone(data);
    } catch (failure) {
      const status = statusOf(failure);
      setError(isOffline(failure)
        ? OFFLINE_MESSAGE
        : apiMessage(failure, status === 409 ? 'This can’t be undone any more.' : 'Couldn’t save the change. Check your signal and try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RefineSheet title={title} onClose={onClose}>
      <form className="ops-form" onSubmit={(event) => void submit(event)}>
        {next === 0
          ? <RefineNote>The team goes back into the heats it left, if they haven’t been scored or re-drawn since.</RefineNote>
          : <RefineNote>Removes the team from unscored heats. Scored or started heats keep the team and its points.</RefineNote>}
        <label className="rf-fld">{next === 0 ? 'Note (optional)' : next === 2 ? 'Reason (optional)' : 'Reason'}
          <textarea className="ops-note-input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </label>
        <span className="rf-t2">Visible to organisers only.</span>
        {error && <Notice>{error}</Notice>}
        <div className="rf-actions">
          <button type="button" className="rf-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="rf-btn rf-btn-primary rf-grow" disabled={busy}>{busy ? 'Saving…' : next === 0 ? 'Reinstate team' : next === 1 ? 'Withdraw team' : 'Mark as no-show'}</button>
        </div>
      </form>
    </RefineSheet>
  );
}
