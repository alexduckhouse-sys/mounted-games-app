import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  COMPETITION_HELPER_ROLES, type CompetitionHelper, type CompetitionHelperRole, type CompetitionTeam,
} from '../../types';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import { apiMessage } from '../operations/types';

function roleLabel(role: CompetitionHelperRole): string {
  return COMPETITION_HELPER_ROLES.find((item) => item.value === role)?.label ?? 'Helper';
}

/** Keeps a wrong or partial response from reaching the screen. */
function parseTeam(data: unknown): CompetitionTeam | null {
  const team = data as Partial<CompetitionTeam> | null;
  if (!team || typeof team.canManageTeam !== 'boolean' || !Array.isArray(team.helpers)) return null;
  return {
    canManageTeam: team.canManageTeam,
    owner: team.owner ?? null,
    helpers: team.helpers.filter((helper) => !!helper && typeof helper.userId === 'string'),
  };
}

type TeamState = { competitionId: number; team: CompetitionTeam } | 'error' | null;

/**
 * Who helps run one competition. The owner and admins can add, change and remove
 * helpers (an admin only in Edit mode, via `canWrite`); a helper can only leave. The API decides; this only hides what won't work.
 */
export function CompetitionTeamCard({ competitionId, canWrite = true }: { competitionId: number; canWrite?: boolean }) {
  const { user, refreshAccess } = useAuth();
  const [state, setState] = useState<TeamState>(null);
  const [retry, setRetry] = useState(0);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CompetitionHelperRole>(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<unknown>(`/competitions/${competitionId}/team`)
      .then(({ data }) => {
        const team = parseTeam(data);
        if (!cancelled) setState(team ? { competitionId, team } : 'error');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [competitionId, retry]);

  const team = state && state !== 'error' && state.competitionId === competitionId ? state.team : null;
  const mayEdit = !!team?.canManageTeam && canWrite;
  const changeHelpers = useCallback((change: (helpers: CompetitionHelper[]) => CompetitionHelper[]) => {
    setState((current) => current && current !== 'error'
      ? { ...current, team: { ...current.team, helpers: change(current.team.helpers) } }
      : current);
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { data } = await api.post<CompetitionHelper>(`/competitions/${competitionId}/team`, { email: address, role });
      changeHelpers((helpers) => [...helpers.filter((helper) => helper.userId !== data.userId), data]);
      setEmail('');
      setNotice({ kind: 'ok', text: `Added ${data.name} as ${roleLabel(data.role).toLowerCase()}.` });
    } catch (error) {
      setNotice({ kind: 'error', text: apiMessage(error, 'Couldn’t add that person. Check your connection and try again.') });
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(helper: CompetitionHelper, next: CompetitionHelperRole) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { data } = await api.put<CompetitionHelper>(`/competitions/${competitionId}/team/${helper.userId}`, { role: next });
      changeHelpers((helpers) => helpers.map((item) => (item.userId === helper.userId ? { ...item, ...data } : item)));
      setNotice({ kind: 'ok', text: `${helper.name} is now ${roleLabel(next).toLowerCase()}.` });
    } catch (error) {
      setNotice({ kind: 'error', text: apiMessage(error, `Couldn’t change ${helper.name}’s role. Try again.`) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(helper: CompetitionHelper) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.delete(`/competitions/${competitionId}/team/${helper.userId}`);
      changeHelpers((helpers) => helpers.filter((item) => item.userId !== helper.userId));
      setNotice({ kind: 'ok', text: `Removed ${helper.name}.` });
    } catch (error) {
      setNotice({ kind: 'error', text: apiMessage(error, `Couldn’t remove ${helper.name}. Try again.`) });
    } finally {
      setBusy(false);
    }
  }

  async function leave(helper: CompetitionHelper) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.delete(`/competitions/${competitionId}/team/${helper.userId}`);
      changeHelpers((helpers) => helpers.filter((item) => item.userId !== helper.userId));
      setNotice({ kind: 'ok', text: 'You’ve left this team.' });
      await refreshAccess();
    } catch (error) {
      setNotice({ kind: 'error', text: apiMessage(error, 'Couldn’t leave the team. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  const me = team?.helpers.find((helper) => helper.userId === user?.id) ?? null;

  return (
    <section aria-label="Competition team">
      <RefineSection title="Competition team" />
      {state === 'error' && (
        <div role="alert" className="rf-list flex flex-col items-start gap-2 p-3">
          <p>Couldn’t load the team. Check your connection and try again.</p>
          <button type="button" className="mg-btn mg-btn-secondary" onClick={() => { setState(null); setRetry((n) => n + 1); }}>Try again</button>
        </div>
      )}
      {state === null && <p role="status" className="rf-note">Loading the team…</p>}
      {team && (
        <>
          <RefineNote>
            {mayEdit
              ? 'Helpers can score and run this event with you. Add someone by the email address on their account.'
              : 'These are the people who run this event.'}
          </RefineNote>
          <RefineList label="People on this team">
            {team.owner && (
              <li className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="font-medium">{team.owner.name}</span>
                <span className="mg-meta">Owner</span>
              </li>
            )}
            {team.helpers.map((helper) => (
              <li key={helper.userId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="block font-medium">{helper.name}</span>
                  {helper.email && <span className="mg-meta block break-all">{helper.email}</span>}
                </span>
                {mayEdit ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <select
                      className="input"
                      aria-label={`Role for ${helper.name}`}
                      value={helper.role}
                      disabled={busy}
                      onChange={(event) => void changeRole(helper, Number(event.target.value) as CompetitionHelperRole)}
                    >
                      {COMPETITION_HELPER_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} aria-label={`Remove ${helper.name}`} onClick={() => void remove(helper)}>Remove</button>
                  </span>
                ) : (
                  <span className="mg-meta">{roleLabel(helper.role)}</span>
                )}
              </li>
            ))}
            {team.helpers.length === 0 && <li className="p-3 mg-meta">No helpers yet.</li>}
          </RefineList>

          {mayEdit && (
            <form onSubmit={add} className="rf-list flex flex-col gap-2 p-3">
              <label className="rf-fld">Email address
                <input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="rf-fld">Role
                <select className="input" value={role} onChange={(event) => setRole(Number(event.target.value) as CompetitionHelperRole)}>
                  {COMPETITION_HELPER_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <div><button type="submit" className="mg-btn mg-btn-primary" disabled={busy || !email.trim()}>Add helper</button></div>
            </form>
          )}

          {me && (
            <div className="rf-list flex flex-col items-start gap-2 p-3">
              <p>You’re on this team as {roleLabel(me.role).toLowerCase()}.</p>
              <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} onClick={() => void leave(me)}>Leave this team</button>
            </div>
          )}
        </>
      )}
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="mg-notice">{notice.text}</p>}
    </section>
  );
}
