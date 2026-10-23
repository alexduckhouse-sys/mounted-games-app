import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { CompetitionHelper, CompetitionTeam } from '../../types';
import { RefineList, RefineNote, RefineSection } from '../refine/Refine';
import { apiMessage } from '../operations/types';

/** Keeps a wrong or partial response from reaching the screen. */
function parseTeam(data: unknown): CompetitionTeam | null {
  const team = data as Partial<CompetitionTeam> | null;
  if (!team || !Array.isArray(team.helpers)) return null;
  return {
    owner: team.owner ?? null,
    helpers: team.helpers.filter((helper) => !!helper && typeof helper.userId === 'string'),
  };
}

type TeamState = { competitionId: number; team: CompetitionTeam } | 'error' | null;

/**
 * Who runs one competition. The owner and every competition admin can add and remove competition admins
 * (a site admin only in Edit mode, via `canWrite`), and anyone on the team can leave. The API decides; this only hides what won't work.
 */
export function CompetitionTeamCard({ competitionId, canWrite = true }: { competitionId: number; canWrite?: boolean }) {
  const { user, refreshAccess } = useAuth();
  const [state, setState] = useState<TeamState>(null);
  const [retry, setRetry] = useState(0);
  const [email, setEmail] = useState('');
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
  const mayEdit = !!team && canWrite;
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
      const { data } = await api.post<CompetitionHelper>(`/competitions/${competitionId}/team`, { email: address });
      changeHelpers((helpers) => [...helpers.filter((helper) => helper.userId !== data.userId), data]);
      setEmail('');
      setNotice({ kind: 'ok', text: `${data.name} is now a competition admin.` });
    } catch (error) {
      setNotice({ kind: 'error', text: apiMessage(error, 'Couldn’t add that person. Check your connection and try again.') });
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
              ? 'Competition admins can run every part of this event, from scoring to entries and the shop. Add someone using the email address on their account.'
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
                  {helper.email && <span className="mg-meta block break-all">{helper.email}{helper.emailConfirmed === false && <span className="font-semibold"> (unconfirmed email)</span>}</span>}
                </span>
                {mayEdit && helper.userId !== user?.id ? (
                  <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} aria-label={`Remove ${helper.name}`} onClick={() => void remove(helper)}>Remove</button>
                ) : (
                  <span className="mg-meta">Competition admin</span>
                )}
              </li>
            ))}
            {team.helpers.length === 0 && <li className="p-3 mg-meta">No competition admins yet.</li>}
          </RefineList>

          {mayEdit && (
            <form onSubmit={add} className="rf-list flex flex-col gap-2 p-3">
              <label className="rf-fld">Email address
                <input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <div><button type="submit" className="mg-btn mg-btn-primary" disabled={busy || !email.trim()}>Add competition admin</button></div>
            </form>
          )}

          {me && (
            <div className="rf-list flex flex-col items-start gap-2 p-3">
              <p>You’re a competition admin for this event.</p>
              <button type="button" className="mg-btn mg-btn-secondary" disabled={busy} onClick={() => void leave(me)}>Leave this team</button>
            </div>
          )}
        </>
      )}
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="mg-notice">{notice.text}</p>}
    </section>
  );
}
