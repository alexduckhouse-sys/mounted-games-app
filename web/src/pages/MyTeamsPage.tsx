import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, FileText, Clock, Activity, CheckCircle2, KeyRound, UserPlus, X, RefreshCw, Copy, Check, Bell, BellOff, Sparkles } from 'lucide-react';
import { api } from '../api';
import type { CompetitionDetail, Heat, Session, Team, TeamSupporter, TrainerNote } from '../types';
import { bibAccent, bibLabel } from '../lib/bib';
import { displaySectionName } from '../lib/section';
import { computeTimings, formatTime, roundTo5Min } from '../lib/time';
import { useTeamNotifications } from '../hooks/useTeamNotifications';

interface TeamHeatRow {
  competitionId: number;
  competitionName: string;
  heatId: number;
  label: string;
  sessionName: string;
  scheduled: Date | null;
  effective: Date | null;
  shifted: boolean;
  status: 'over' | 'live' | 'upcoming';
}

export function MyTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [notes, setNotes] = useState<TrainerNote[]>([]);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [comps, setComps] = useState<Map<number, CompetitionDetail>>(new Map());

  useEffect(() => {
    api.get<Team[]>('/trainer/my-teams').then((r) => setTeams(r.data)).catch(() => {});
    api.get<TrainerNote[]>('/trainer/notes').then((r) => setNotes(r.data)).catch(() => {});
  }, []);

  // Once we have the teams, pull each competition's detail (deduped) for timetable + heat info.
  useEffect(() => {
    if (teams.length === 0) return;
    const compIds = Array.from(new Set(teams.map((t) => t.competitionId)));
    const next = new Map<number, CompetitionDetail>();
    Promise.all(compIds.map((id) =>
      api.get<CompetitionDetail>(`/competitions/${id}`).then((r) => next.set(id, r.data)).catch(() => {})
    )).then(() => setComps(new Map(next)));
  }, [teams]);

  const heatRowsByTeam = useMemo(() => {
    const out = new Map<number, TeamHeatRow[]>();
    for (const team of teams) {
      const comp = comps.get(team.competitionId);
      if (!comp) { out.set(team.id, []); continue; }
      const sessions: Session[] = comp.sessions.filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0);
      const timings = computeTimings(sessions);
      const rows: TeamHeatRow[] = [];
      for (const sess of sessions) {
        const heatsInOrder: Heat[] = sess.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
        const sessTiming = timings.get(sess.id);
        heatsInOrder.forEach((h, idx) => {
          if (!h.entries.some((e) => e.teamId === team.id)) return;
          const t = sessTiming?.heats[idx];
          const allDone = h.races.length > 0 && h.races.every((r) => r.isComplete);
          const live = sess.status === 1 && !allDone
            && h.id === heatsInOrder.find((x) => !(x.races.length > 0 && x.races.every((r) => r.isComplete)))?.id;
          rows.push({
            competitionId: comp.id,
            competitionName: comp.name,
            heatId: h.id,
            label: h.label ?? `Heat ${idx + 1}`,
            sessionName: sess.name,
            scheduled: t?.scheduled ?? null,
            effective: t?.effective ?? null,
            shifted: t?.shifted ?? false,
            status: allDone ? 'over' : live ? 'live' : 'upcoming',
          });
        });
      }
      rows.sort((a, b) => {
        const ta = a.effective?.getTime() ?? a.scheduled?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const tb = b.effective?.getTime() ?? b.scheduled?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return ta - tb;
      });
      out.set(team.id, rows);
    }
    return out;
  }, [teams, comps]);

  async function saveNote() {
    if (!draft.body.trim()) return;
    const { data } = await api.post<TrainerNote>('/trainer/notes', draft);
    setNotes((n) => [data, ...n]);
    setDraft({ title: '', body: '' });
  }

  async function deleteNote(id: number) {
    await api.delete(`/trainer/notes/${id}`);
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  const notify = useTeamNotifications(teams);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2 flex-1">
          <Users className="w-6 h-6 text-brand-600" /> My Teams
        </h1>
        <Link to="/admin/competitions/new" className="btn-primary !py-1.5 !px-3 text-sm">
          <Sparkles className="w-4 h-4" /> Create competition
        </Link>
        <NotificationToggle enabled={notify.enabled} permission={notify.permission} onChange={notify.setEnabled} />
      </div>

      <JoinTeamCard onJoined={() => api.get<Team[]>('/trainer/my-teams').then((r) => setTeams(r.data)).catch(() => {})} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {teams.map((t) => {
          const rows = heatRowsByTeam.get(t.id) ?? [];
          const next = rows.find((r) => r.status !== 'over');
          return (
            <div key={t.id} className="card p-3 space-y-2">
              <Link
                to={`/competitions/${t.competitionId}`}
                className="flex items-center gap-3 hover:opacity-80 transition"
              >
                <span
                  className="inline-block w-2 h-10 rounded-full shrink-0"
                  style={{ background: bibAccent(t.bibColour) }}
                />
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-sm truncate flex items-center gap-1.5">
                    {t.displayName}
                    {t.relationship === 'supporter' && (
                      <span className="text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                        Supporter
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-300 truncate">
                    {displaySectionName(t.sectionName)}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">Bibs: {bibLabel(t.bibColour)}</p>
                </div>
                {next && (
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Next up</div>
                    <div className="font-mono font-bold tabular-nums text-base text-brand-700 dark:text-brand-200">
                      {formatTime(roundTo5Min(next.effective ?? next.scheduled))}
                    </div>
                  </div>
                )}
              </Link>

              <div className="border-t border-slate-100 dark:border-slate-700 pt-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> All heats
                </div>
                {rows.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-300 italic">
                    No heats scheduled yet.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {rows.map((r) => (
                      <li key={r.heatId} className="flex items-center gap-2 text-xs">
                        <span className="font-mono tabular-nums w-12 text-slate-700 dark:text-slate-100 font-semibold">
                          {formatTime(roundTo5Min(r.effective ?? r.scheduled))}
                        </span>
                        <span className="flex-1 min-w-0 truncate">
                          {displaySectionName(r.sessionName)} · {r.label}
                        </span>
                        {r.status === 'live' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-arena-live text-yellow-900 text-[9px] font-bold uppercase tracking-wide">
                            <Activity className="w-2.5 h-2.5" /> In arena
                          </span>
                        )}
                        {r.status === 'over' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 text-[9px] font-bold uppercase tracking-wide">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Over
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {t.relationship === 'trainer' && (
                <SupportersBlock team={t} onTeamUpdated={() => {
                  api.get<Team[]>('/trainer/my-teams').then((r) => setTeams(r.data)).catch(() => {});
                }} />
              )}
            </div>
          );
        })}
        {teams.length === 0 && (
          <div className="card p-3 text-sm text-slate-500 dark:text-slate-300">
            No teams assigned to you yet. An organiser must add you as the trainer of a team.
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <FileText className="w-5 h-5 text-brand-600" /> Notes
        </h2>
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            className="input sm:max-w-xs" placeholder="Title (optional)"
            value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <input
            className="input flex-1" placeholder="Write a quick note…"
            value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && saveNote()}
          />
          <button className="btn-primary" onClick={saveNote}>Save</button>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {notes.map((n) => (
            <li key={n.id} className="py-3 flex items-start gap-3">
              <div className="flex-1">
                {n.title && <p className="font-semibold text-sm">{n.title}</p>}
                <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                <p className="text-xs text-slate-500 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
              <button onClick={() => deleteNote(n.id)} className="btn-ghost !py-1 !px-2 text-xs">Delete</button>
            </li>
          ))}
          {notes.length === 0 && <li className="py-3 text-sm text-slate-500">No notes yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function NotificationToggle({
  enabled, permission, onChange,
}: {
  enabled: boolean;
  permission: 'default' | 'granted' | 'denied' | 'unsupported';
  onChange: (v: boolean) => void;
}) {
  const blocked = permission === 'denied' || permission === 'unsupported';
  const subtitle = permission === 'denied' ? 'Browser permission denied'
    : permission === 'unsupported' ? 'Not supported in this browser'
    : enabled ? 'On — 1hr before, briefings, schedule slips' : 'Off';
  return (
    <button
      onClick={() => onChange(!enabled)}
      disabled={blocked}
      className={`btn-ghost !py-1.5 !px-2.5 text-xs flex items-center gap-1.5 ${
        enabled ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200' : ''
      } ${blocked ? 'opacity-50 cursor-not-allowed' : ''}`}
      title="Browser notifications — only fire while this tab is open"
    >
      {enabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
      <span className="text-left leading-tight">
        <span className="block font-semibold">Notifications</span>
        <span className="block text-[9px] font-normal opacity-80">{subtitle}</span>
      </span>
    </button>
  );
}

function JoinTeamCard({ onJoined }: { onJoined: () => void }) {
  const [key, setKey] = useState('');
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
      if (data.status === 1) {
        setResult(`You're now supporting ${data.teamName}.`);
      } else {
        setResult(`Request sent for ${data.teamName}. The trainer needs to accept.`);
      }
      onJoined();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Could not join. Check the key.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-semibold text-sm flex items-center gap-1.5 flex-1">
          <UserPlus className="w-4 h-4 text-brand-600" /> Join a team
        </h2>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-300">
        Got a join key from a trainer? Enter it to support a team — you'll see their schedule, dec forms and notifications.
      </p>
      <div className="flex gap-2">
        <input
          className="input flex-1 font-mono tracking-widest uppercase text-sm"
          placeholder="ABCD1234"
          maxLength={16}
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
        />
        <button onClick={join} disabled={busy || !key.trim()} className="btn-primary !py-1.5 !px-3 text-xs">
          {busy ? '…' : 'Join'}
        </button>
      </div>
      {result && (
        <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> {result}
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}

function SupportersBlock({ team, onTeamUpdated }: { team: Team; onTeamUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [supporters, setSupporters] = useState<TeamSupporter[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<TeamSupporter[]>(`/teams/${team.id}/supporters`);
      setSupporters(data);
    } catch { setSupporters([]); }
  }
  useEffect(() => { if (open) load(); }, [open, team.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function rotate() {
    setBusy(true);
    try {
      await api.post(`/teams/${team.id}/supporter-key`);
      onTeamUpdated();
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!confirm('Revoke this join key? Existing supporters will stay, but no one new can join until you make a new key.')) return;
    setBusy(true);
    try {
      await api.delete(`/teams/${team.id}/supporter-key`);
      onTeamUpdated();
    } finally {
      setBusy(false);
    }
  }
  async function accept(s: TeamSupporter) {
    await api.put(`/team-supporters/${s.id}/accept`);
    load();
  }
  async function kick(s: TeamSupporter) {
    if (!confirm(`Remove ${s.userName} as supporter?`)) return;
    await api.delete(`/team-supporters/${s.id}`);
    load();
  }

  const pendingCount = supporters.filter((s) => s.status === 0).length;
  const acceptedCount = supporters.filter((s) => s.status === 1).length;

  function copyKey() {
    if (!team.supporterJoinKey) return;
    navigator.clipboard?.writeText(team.supporterJoinKey)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }

  return (
    <div className="border-t border-slate-100 dark:border-slate-700 pt-2 -mx-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-100 px-1 flex items-center gap-1.5"
      >
        <KeyRound className="w-3.5 h-3.5" /> Supporters
        {acceptedCount > 0 && <span className="text-slate-400">· {acceptedCount}</span>}
        {pendingCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200 text-[10px] font-bold">
            {pendingCount} pending
          </span>
        )}
        <span className="ml-auto text-slate-400">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="px-1 mt-2 space-y-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-300">
            Share this key with supporters; they enter it on their <em>My Teams</em> page to request access.
          </div>
          <div className="flex items-center gap-1.5">
            {team.supporterJoinKey ? (
              <>
                <code className="flex-1 font-mono text-base tracking-widest font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 px-2 py-1 rounded-md text-center">
                  {team.supporterJoinKey}
                </code>
                <button onClick={copyKey} className="btn-ghost !py-1 !px-1.5 text-xs" title="Copy">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button onClick={rotate} disabled={busy} className="btn-ghost !py-1 !px-1.5 text-xs" title="Generate new key (old one stops working)">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button onClick={revoke} disabled={busy} className="btn-ghost !py-1 !px-1.5 text-xs text-rose-500" title="Revoke key">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button onClick={rotate} disabled={busy} className="btn-primary !py-1.5 !px-3 text-xs">
                <KeyRound className="w-3.5 h-3.5" /> Generate join key
              </button>
            )}
          </div>
          {supporters.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700/60 text-xs">
              {supporters.map((s) => (
                <li key={s.id} className="py-1.5 flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate">
                    <span className="font-semibold">{s.userName}</span>
                    {s.userEmail && <span className="text-slate-500"> · {s.userEmail}</span>}
                  </span>
                  {s.status === 0 ? (
                    <button onClick={() => accept(s)} className="btn-primary !py-0.5 !px-2 text-[11px]">
                      <Check className="w-3 h-3" /> Accept
                    </button>
                  ) : (
                    <span className="text-[9px] uppercase tracking-wide font-bold text-emerald-600 dark:text-emerald-300">
                      Active
                    </span>
                  )}
                  <button onClick={() => kick(s)} className="btn-ghost !py-0.5 !px-1 text-[11px] text-rose-500" title="Remove">
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
