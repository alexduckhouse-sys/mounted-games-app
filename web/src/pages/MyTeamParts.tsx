import { useCallback, useEffect, useState } from 'react';
import { CopiedTick } from '../components/CopiedTick';
import { useLocation } from 'react-router-dom';
import { Check, ChevronDown, RefreshCw, X } from 'lucide-react';
import { api } from '../api';
import { joinKeyFromSearch } from '../lib/sharing';
import type { Team, TeamSupporter } from '../types';
import { JoinQr, TeamCalendarFeed } from './TeamSharing';
import { SelectField } from '../components/SelectField';
import { confirmDialog } from '../components/ConfirmDialog';

const messageOf = (e: unknown, fallback: string) => {
  const data = (e as { response?: { data?: { message?: string } | string } }).response?.data;
  return typeof data === 'string' ? data : data?.message ?? fallback;
};

/** "Join a team with a code": a supporter or parent types the code a trainer gave them. */
export function JoinTeamCard({ onJoined }: { onJoined: () => void }) {
  // A scanned team QR code opens this page with the key in the address (/teams?join=KEY).
  const { search } = useLocation();
  const [key, setKey] = useState(() => joinKeyFromSearch(search));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post<TeamSupporter>('/teams/join', { key: key.trim() });
      setKey('');
      setResult(data.status === 1 ? `You're now supporting ${data.teamName}.` : `Request sent for ${data.teamName}. The trainer needs to accept.`);
      onJoined();
    } catch (e) {
      setError(messageOf(e, 'Could not join. Check the key.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mg-card space-y-2 p-3">
      <h2 className="mg-display text-lg font-bold text-[rgb(var(--mg-heading))]">Join a team</h2>
      <p className="mg-meta">Got a join key from a trainer? Enter it to support a team. You'll see their schedule, dec forms and notifications.</p>
      <div className="flex gap-2">
        <input
          className="input min-h-11 flex-1 font-mono text-sm uppercase tracking-widest"
          aria-label="Join key"
          placeholder="ABCD1234"
          maxLength={16}
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
        />
        <button onClick={join} disabled={busy || !key.trim()} className="mg-btn mg-btn-primary !min-h-11 !px-4">{busy ? '…' : 'Join'}</button>
      </div>
      {result && <p role="status" className="flex items-center gap-1.5 text-sm text-[rgb(var(--mg-ok))]"><Check className="h-4 w-4" aria-hidden="true" /> {result}</p>}
      {error && <p role="alert" className="text-sm text-[rgb(var(--mg-elim))]">{error}</p>}
    </div>
  );
}

/** The parent join code: shown with Copy and Change. Change opens a small editor for a custom, random or switched-off code. */
export function CodeRow({ team, onTeamUpdated }: { team: Team; onTeamUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  function copyKey() {
    if (!team.supporterJoinKey) return;
    navigator.clipboard?.writeText(team.supporterJoinKey)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }
  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setCodeErr(null);
    try {
      await action();
      onTeamUpdated();
      after?.();
    } catch (e) {
      setCodeErr(messageOf(e, 'Could not change the code.'));
    } finally {
      setBusy(false);
    }
  }
  const saveCustom = () => {
    const code = codeInput.trim().toUpperCase();
    if (code.length < 3) { setCodeErr('At least 3 characters.'); return; }
    return run(() => api.put(`/teams/${team.id}/team-code`, { code }), () => { setEditing(false); setCodeInput(''); });
  };
  const random = () => run(() => api.post(`/teams/${team.id}/supporter-key`), () => setEditing(false));
  const revoke = async () => {
    if (!(await confirmDialog({ title: 'Turn this code off?', message: 'Existing supporters stay, but no one new can join until you set a new code.', confirmLabel: 'Turn code off', destructive: true }))) return;
    return run(() => api.delete(`/teams/${team.id}/supporter-key`), () => setEditing(false));
  };

  return (
    <div className="border-t border-[rgb(var(--mg-rule-soft))]">
      <div className="flex min-h-[52px] items-center gap-2 py-1.5 pl-3.5 pr-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-[rgb(var(--mg-muted))]">Parent join code</span>
          <span className="mg-display truncate text-lg font-bold leading-none tracking-[0.08em]">{team.supporterJoinKey ?? 'Not set'}</span>
        </span>
        {team.supporterJoinKey && <button type="button" onClick={copyKey} className="mg-small-btn" aria-label={`Copy join code for ${team.displayName}`}>{copied ? <><CopiedTick className="h-3.5 w-3.5 text-[rgb(var(--mg-ok))]" />Copied</> : 'Copy'}</button>}
        <button type="button" onClick={() => { setEditing(!editing); setCodeInput(team.supporterJoinKey ?? ''); setCodeErr(null); }} aria-expanded={editing} className="inline-flex min-h-11 items-center px-2.5 text-[13px] font-semibold text-[rgb(var(--mg-heading))]">{team.supporterJoinKey ? 'Change' : 'Set code'}<span className="sr-only"> join code for {team.displayName}</span></button>
      </div>
      {editing && (
        <div className="space-y-2 bg-[rgb(var(--mg-subtle))] px-3.5 py-3">
          <div className="flex items-center gap-2">
            <input className="input min-h-11 flex-1 font-mono text-sm uppercase" aria-label="New join code" placeholder="STOCKPORT-A" maxLength={32} value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} autoFocus />
            <button type="button" onClick={saveCustom} disabled={busy} className="mg-btn mg-btn-primary !min-h-11 !px-3"><Check className="h-4 w-4" aria-hidden="true" /> Save</button>
            <button type="button" onClick={() => { setEditing(false); setCodeErr(null); }} className="mg-icon-btn" aria-label="Cancel"><X className="h-4 w-4" /></button>
          </div>
          <p className="mg-meta">3 to 32 characters: letters, digits, dashes and underscores. It must be unique within this competition.</p>
          {codeErr && <p role="alert" className="text-sm text-[rgb(var(--mg-elim))]">{codeErr}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={random} disabled={busy} className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm"><RefreshCw className="h-4 w-4" aria-hidden="true" /> New random code</button>
            {team.supporterJoinKey && <button type="button" onClick={revoke} disabled={busy} className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm !text-[rgb(var(--mg-elim))]">Turn code off</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A supporter list for the trainer: who has joined, who is waiting, plus the team's QR code and calendar feed. */
export function SupportersBlock({ team }: { team: Team }) {
  const [open, setOpen] = useState(false);
  const [supporters, setSupporters] = useState<TeamSupporter[]>([]);

  const fetchSupporters = useCallback(
    () => api.get<TeamSupporter[]>(`/teams/${team.id}/supporters`).then((r) => r.data).catch(() => [] as TeamSupporter[]),
    [team.id],
  );
  async function load() { setSupporters(await fetchSupporters()); }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchSupporters().then((list) => { if (!cancelled) setSupporters(list); });
    return () => { cancelled = true; };
  }, [open, fetchSupporters]);

  async function accept(s: TeamSupporter) {
    await api.put(`/team-supporters/${s.id}/accept`);
    load();
  }
  async function kick(s: TeamSupporter) {
    if (!(await confirmDialog({ title: `Remove ${s.userName} as a supporter?`, message: 'They stop seeing this team’s heats and dec forms.', confirmLabel: 'Remove supporter', destructive: true }))) return;
    await api.delete(`/team-supporters/${s.id}`);
    load();
  }

  const pendingCount = supporters.filter((s) => s.status === 0).length;
  const acceptedCount = supporters.filter((s) => s.status === 1).length;

  return (
    <div className="border-t border-[rgb(var(--mg-rule-soft))]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[13px] font-semibold text-[rgb(var(--mg-heading))]">
        Supporters and sharing
        {acceptedCount > 0 && <span className="font-medium text-[rgb(var(--mg-muted))]">· {acceptedCount}</span>}
        {pendingCount > 0 && <span className="mg-tag mg-tag-late">{pendingCount} pending</span>}
        <ChevronDown className={`ml-auto h-4 w-4 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-2 px-3.5 pb-3">
          <p className="mg-meta">Share the join code with parents and friends. Anyone who signs up to a competition can type it in to be linked to this team, and supporters can use it on their <em>My teams</em> page.</p>
          <JoinQr team={team} />
          <TeamCalendarFeed team={team} />
          {supporters.length > 0 && (
            <ul className="divide-y divide-[rgb(var(--mg-rule-soft))] text-sm">
              {supporters.map((s) => (
                <li key={s.id} className="flex min-h-11 items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">{s.userName}</span>
                    {s.userEmail && <span className="text-[rgb(var(--mg-muted))]"> · {s.userEmail}</span>}
                  </span>
                  {s.status === 0
                    ? <button onClick={() => accept(s)} className="mg-btn mg-btn-primary !min-h-11 !px-3 !text-sm"><Check className="h-4 w-4" aria-hidden="true" /> Accept</button>
                    : <span className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--mg-ok))]">Active</span>}
                  <button onClick={() => kick(s)} className="mg-icon-btn" aria-label={`Remove ${s.userName}`}><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** For a club's Team Manager: who trains the team, and what its bibs look like. */
export function ManageTeamBlock({ team, onSaved }: { team: Team; onSaved: () => void }) {
  const [trainers, setTrainers] = useState<{ userId: string; fullName: string }[]>([]);
  const [trainerId, setTrainerId] = useState(team.trainerUserId ?? '');
  const [bibs, setBibs] = useState(team.bibDescription ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ userId: string; fullName: string }[]>(`/clubs/${team.clubId}/trainers`)
      .then((r) => setTrainers(r.data))
      .catch(() => setTrainers([]));
  }, [team.clubId]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api.put(`/teams/${team.id}/trainer`, { trainerUserId: trainerId, bibDescription: bibs });
      setMessage('Saved.');
      onSaved();
    } catch {
      setMessage('Could not save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-[rgb(var(--mg-rule-soft))] px-3.5 py-3">
      <label className="block text-xs">
        <span className="text-[rgb(var(--mg-muted))]">Trainer</span>
        <SelectField className="input mt-1 min-h-11 text-sm" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
          <option value="">No trainer yet</option>
          {trainers.map((tr) => <option key={tr.userId} value={tr.userId}>{tr.fullName}</option>)}
        </SelectField>
      </label>
      <label className="block text-xs">
        <span className="text-[rgb(var(--mg-muted))]">Bibs</span>
        <input className="input mt-1 min-h-11 text-sm" maxLength={200} placeholder="e.g. Red bibs, numbered 1 to 5" value={bibs} onChange={(e) => setBibs(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" className="mg-btn mg-btn-primary !min-h-11 !px-3 !text-sm" disabled={busy} onClick={save}>Save team details</button>
        {message && <span role="status" className="text-xs text-[rgb(var(--mg-body))]">{message}</span>}
      </div>
    </div>
  );
}
