import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { confirmDialog } from '../../components/ConfirmDialog';
import { tr } from '../../i18n/translate';
import { isShiftCheckedInHere, isShiftMarkedMissing, isShiftTeamSaysHere, sessionStewardDutySummary } from '../../lib/lorryAndVolunteers';
import type { CallMissingStewardResult, Session, VolunteerShift } from '../../types';
import { isDutyShift } from './crewDutyHelpers';


function errorText(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function StatusPill({ shift }: { shift: VolunteerShift }) {
  const here = isShiftCheckedInHere(shift);
  const missing = isShiftMarkedMissing(shift);
  // "Team says here" is the team's own word, not staff's: a dashed blue pill so it never reads as a confirmed check-in.
  const teamSays = !here && isShiftTeamSaysHere(shift);
  const tone = here
    ? 'bg-[rgb(var(--mg-ok)/0.16)] text-[rgb(var(--mg-ok))]'
    : teamSays
      ? 'border-2 border-dashed border-[rgb(var(--mg-info-ink)/0.5)] bg-[rgb(var(--mg-info-bg))] text-[rgb(var(--mg-info-ink))]'
    : missing
      ? 'bg-[rgb(var(--mg-elim)/0.14)] text-[rgb(var(--mg-elim))]'
      : 'bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-body))]';
  return <span className={`inline-flex min-h-7 items-center rounded-full px-3 text-sm font-bold ${tone}`}>{here ? 'Here' : teamSays ? tr('duties.status.teamSaysHere') : missing ? 'Missing' : 'Assigned'}</span>;
}

/** Organisers' view of one session's steward and arena crew duties: who is here, who is not, and the tools to chase them. */
export function SessionDutyBoard({ competitionId, session }: { competitionId: number; session: Pick<Session, 'id' | 'name'> }) {
  const [shifts, setShifts] = useState<VolunteerShift[] | null>(null);
  const [busy, setBusy] = useState<number | 'assign' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/competitions/${competitionId}`;

  const fetchShifts = useCallback(async () => {
    const { data } = await api.get<VolunteerShift[]>(`${base}/volunteer-shifts`);
    if (!Array.isArray(data)) throw new Error('Unexpected response');
    return data;
  }, [base]);

  const loadFailed = (e: unknown) => {
    setError(errorText(e, 'Couldn’t load the duties. Check your connection and try again.'));
    setShifts((cur) => cur ?? []);
  };
  const load = () => fetchShifts().then((data) => { setShifts(data); setError(null); }, loadFailed);

  useEffect(() => {
    let active = true;
    fetchShifts().then(
      (data) => { if (active) { setShifts(data); setError(null); } },
      (e) => { if (active) { setError(errorText(e, 'Couldn’t load the duties. Check your connection and try again.')); setShifts((cur) => cur ?? []); } },
    );
    return () => { active = false; };
  }, [fetchShifts]);

  const duties = (shifts ?? []).filter((s) => isDutyShift(s, session.id));
  const summary = sessionStewardDutySummary(duties, session.id);
  const readiness = summary.totalDuties === 0
    ? 'No duties set'
    : summary.allHere
      ? `All ${summary.totalDuties} here`
      : `${summary.hereCount} of ${summary.totalDuties} here · ${summary.totalDuties - summary.hereCount} not checked in`;

  function replaceShift(next: VolunteerShift) {
    setShifts((cur) => (cur ?? []).map((s) => (s.id === next.id ? next : s)));
  }

  async function markHere(shift: VolunteerShift) {
    const before = shift;
    setBusy(shift.id);
    setError(null);
    replaceShift({ ...shift, attendanceStatus: 'Here' });
    try {
      const { data } = await api.put<VolunteerShift>(`${base}/volunteer-shifts/${shift.id}/attendance`, { status: 'Here' });
      if (data && typeof data === 'object' && 'id' in data) replaceShift(data);
    } catch (e) {
      replaceShift(before);
      setError(errorText(e, 'Couldn’t mark them as here. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function callTeam(shift: VolunteerShift) {
    const who = shift.assignedTeamName || shift.assignedClubName || 'this steward';
    const ok = await confirmDialog({
      title: `Call ${who}?`,
      message: 'This posts a public announcement and sends a notification to the team. It stays up until they check in.',
      confirmLabel: 'Call team',
    });
    if (!ok) return;
    setBusy(shift.id);
    setError(null);
    try {
      const { data } = await api.post<CallMissingStewardResult>(`${base}/volunteer-shifts/${shift.id}/call-missing`, {});
      if (data?.shift) replaceShift(data.shift);
      else await load();
    } catch (e) {
      setError(errorText(e, 'Couldn’t send the call. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function assign() {
    if (duties.length > 0) {
      const ok = await confirmDialog({
        title: 'Replace the duties for this session?',
        message: 'The current steward and arena crew duties for this session are removed and teams not riding are assigned again. Check-ins are lost.',
        confirmLabel: 'Replace duties',
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy('assign');
    setError(null);
    try {
      const { data } = await api.post<VolunteerShift[]>(`${base}/sessions/${session.id}/duty-assignments`, {
        autoAssignNonRidingTeams: true,
        includeChangeoverLineStewards: true,
        replaceExistingSessionDuties: duties.length > 0,
      });
      if (Array.isArray(data)) {
        // The response lists this session's duties; keep other sessions' shifts as they were.
        setShifts((cur) => [...(cur ?? []).filter((s) => !isDutyShift(s, session.id) && !data.some((d) => d.id === s.id)), ...data]);
      } else {
        await load();
      }
    } catch (e) {
      setError(errorText(e, 'Couldn’t assign teams. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  const button = 'min-h-11 rounded-[10px] px-4 text-base font-semibold disabled:opacity-60';
  const outline = `${button} border border-[rgb(var(--mg-control))] bg-[rgb(var(--mg-surface))] text-[rgb(var(--mg-ink))]`;
  const solid = `${button} bg-[rgb(var(--mg-button))] text-[rgb(var(--mg-button-ink))]`;

  return (
    <section className="mg-card space-y-3 p-4" aria-label="Steward duties">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-[rgb(var(--mg-heading))]">Steward duties</h3>
          <p className="text-base text-[rgb(var(--mg-body))]" role="status">{shifts === null ? 'Loading…' : readiness}</p>
        </div>
        {duties.length > 0 && <button type="button" className={outline} disabled={busy !== null} onClick={assign}>Assign teams not riding</button>}
      </div>

      {error && <p role="alert" className="rounded-[10px] bg-[rgb(var(--mg-problem-bg))] px-3 py-2 text-sm text-[rgb(var(--mg-problem-ink))]">{error}</p>}

      {shifts !== null && duties.length === 0 && (
        <div className="space-y-2">
          <p className="text-base text-[rgb(var(--mg-body))]">No duties are set for {session.name}. Assign teams that are not riding in this session to the arena crew and line steward jobs.</p>
          <button type="button" className={solid} disabled={busy !== null} onClick={assign}>Assign teams not riding</button>
        </div>
      )}

      {duties.length > 0 && (
        <ul className="divide-y divide-[rgb(var(--mg-rule-soft))]">
          {duties.map((shift) => {
            const here = isShiftCheckedInHere(shift);
            return (
              <li key={shift.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words text-base font-semibold text-[rgb(var(--mg-ink))]">{shift.role}{shift.laneNumber != null && !shift.role.includes(`Lane ${shift.laneNumber}`) ? `, lane ${shift.laneNumber}` : ''}</p>
                  <p className="mg-meta">{shift.assignedTeamName || shift.assignedClubName || 'No team assigned'}{here && shift.checkedInByName ? ` · checked in by ${shift.checkedInByName}` : ''}</p>
                </div>
                <StatusPill shift={shift} />
                {!here && (
                  <div className="flex w-full gap-2 sm:w-auto">
                    <button type="button" className={`${outline} flex-1`} disabled={busy !== null} onClick={() => markHere(shift)}>They’re here</button>
                    <button type="button" className={`${outline} flex-1`} disabled={busy !== null} onClick={() => callTeam(shift)}>Call team</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
