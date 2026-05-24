import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, FileText, Clock, Activity, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import type { CompetitionDetail, Heat, Session, Team, TrainerNote } from '../types';
import { bibAccent, bibLabel } from '../lib/bib';
import { displaySectionName } from '../lib/section';
import { computeTimings, formatTime, roundTo5Min } from '../lib/time';

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Users className="w-6 h-6 text-brand-600" /> My Teams
      </h1>

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
                  <h2 className="font-semibold text-sm truncate">{t.displayName}</h2>
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
