import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flag, AlertTriangle, ShieldCheck, ChevronLeft, RefreshCw, Megaphone } from 'lucide-react';
import { useCompetition } from './context';
import { api } from '../../api';
import { useLiveHub } from '../../live/useLiveHub';
import type { Heat, HeatEntry, Session, StewardCall } from '../../types';
import { SessionKind } from '../../types';
import { bibAccent } from '../../lib/bib';

const STEWARD_NAME_KEY = 'mg.stewardName';
const STEWARD_LANE_KEY = 'mg.stewardLane';

function loadStr(k: string): string {
  try { return localStorage.getItem(k) ?? ''; } catch { return ''; }
}
function saveStr(k: string, v: string) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch { /* quota */ }
}

function displayLaneFor(baseLane: number, raceIndex: number, heatSize: number): number {
  if (heatSize <= 0) return baseLane;
  return ((baseLane - 1 + raceIndex) % heatSize) + 1;
}
function teamForDisplayLane(heat: Heat, raceIndex: number, displayLane: number): HeatEntry | null {
  const size = heat.entries.length;
  if (size <= 0) return null;
  return heat.entries.find((e) => displayLaneFor(e.laneIndex, raceIndex, size) === displayLane) ?? null;
}
function heatIsComplete(h: Heat): boolean {
  return h.races.length > 0 && h.races.every((r) => r.isComplete);
}

export function StewardPage() {
  const { competition } = useCompetition();
  const navigate = useNavigate();

  // The active session = first one in arena (Status=1), else first one with
  // incomplete heats. Steward sees one heat at a time.
  const liveSession = useMemo<Session | null>(() => {
    const race = competition.sessions.filter((s) =>
      (s.kind ?? (s.isBreak ? 1 : 0)) === SessionKind.Race);
    return race.find((s) => s.status === 1)
      ?? race.find((s) => s.heats.some((h) => !heatIsComplete(h)))
      ?? race.sort((a, b) => a.orderIndex - b.orderIndex)[0]
      ?? null;
  }, [competition.sessions]);

  const activeHeat = useMemo<Heat | null>(() => {
    if (!liveSession) return null;
    const ordered = liveSession.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    return ordered.find((h) => !heatIsComplete(h)) ?? ordered[ordered.length - 1] ?? null;
  }, [liveSession]);

  const activeRace = useMemo(() => {
    if (!activeHeat) return null;
    const races = activeHeat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    return races.find((r) => !r.isComplete) ?? null;
  }, [activeHeat]);

  const activeRaceIndex = useMemo(() => {
    if (!activeHeat || !activeRace) return 0;
    const races = activeHeat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    return Math.max(0, races.findIndex((r) => r.id === activeRace.id));
  }, [activeHeat, activeRace]);

  const heatSize = activeHeat?.entries.length ?? 0;

  const [name, setName] = useState(() => loadStr(STEWARD_NAME_KEY));
  const [lane, setLane] = useState<number | null>(() => {
    const stored = parseInt(loadStr(STEWARD_LANE_KEY), 10);
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  useEffect(() => saveStr(STEWARD_NAME_KEY, name), [name]);
  useEffect(() => saveStr(STEWARD_LANE_KEY, lane != null ? String(lane) : ''), [lane]);

  const team = activeHeat && lane ? teamForDisplayLane(activeHeat, activeRaceIndex, lane) : null;

  const [calls, setCalls] = useState<StewardCall[]>([]);
  useEffect(() => {
    api.get<StewardCall[]>(`/competitions/${competition.id}/steward-calls`)
      .then((r) => setCalls(r.data))
      .catch(() => setCalls([]));
  }, [competition.id]);

  useLiveHub(competition.id, {
    onStewardCall: (c) => {
      const call = c as StewardCall;
      setCalls((cur) => cur.some((x) => x.id === call.id) ? cur : [call, ...cur]);
    },
    onStewardCallResolved: ({ id }) => {
      setCalls((cur) => cur.filter((x) => x.id !== id));
    },
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  async function reportElimination() {
    if (!team || !activeRace || lane == null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/races/${activeRace.id}/steward-calls`, {
        teamId: team.teamId,
        laneIndex: lane,
        reporterName: name.trim() || null,
      });
      setJustSent(true);
      setTimeout(() => setJustSent(false), 4000);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Could not send report.');
    } finally {
      setBusy(false);
    }
  }

  // Same-team-same-race already pending? Used to disable button + show status.
  const ownPending = useMemo(() => {
    if (!team || !activeRace) return null;
    return calls.find((c) => c.raceId === activeRace.id && c.teamId === team.teamId) ?? null;
  }, [calls, team, activeRace]);

  if (!liveSession || !activeHeat) {
    return (
      <div className="space-y-3 max-w-md mx-auto p-3">
        <Header competitionName={competition.name} />
        <div className="card p-4 text-center">
          <Flag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            No live heats right now. The page will update automatically when the next heat starts.
          </p>
          <button onClick={() => navigate(0)} className="btn-ghost !py-1.5 !px-3 text-xs mt-2">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-md mx-auto p-3">
      <Header competitionName={competition.name} />

      <div className="card p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
            In arena
          </span>
          <span className="text-sm font-bold truncate flex-1 min-w-0">
            {liveSession.name} · {activeHeat.label ?? `Heat ${activeHeat.orderIndex}`}
          </span>
        </div>
        {activeRace ? (
          <div className="text-base font-bold text-brand-700 dark:text-brand-200">
            {activeRace.name} <span className="text-xs text-slate-500 font-normal">· race {activeRaceIndex + 1} of {activeHeat.races.length}</span>
          </div>
        ) : (
          <div className="text-sm text-slate-500">All races scored — waiting for the next heat.</div>
        )}
      </div>

      <div className="card p-3 space-y-2">
        <label className="block">
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Your name (optional)</span>
          <input
            className="input mt-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="So admins know who reported"
          />
        </label>
        <div>
          <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Which lane are you watching?</span>
          <div className="grid grid-cols-6 gap-1.5 mt-1">
            {Array.from({ length: Math.max(6, heatSize) }, (_, i) => i + 1).slice(0, Math.max(6, heatSize)).map((n) => {
              const inUse = n <= heatSize;
              const isMine = lane === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLane(isMine ? null : n)}
                  disabled={!inUse}
                  className={`py-2 rounded-md text-sm font-bold border-2 transition ${
                    isMine
                      ? 'bg-brand-600 text-white border-brand-700'
                      : inUse
                        ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-brand-300'
                        : 'opacity-30 cursor-not-allowed border-dashed'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {lane != null && team && activeRace ? (
        <motion.div initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="card p-4 space-y-3" style={{ borderLeft: `6px solid ${bibAccent(team.bibColour)}` }}>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
                Lane {lane} · {team.teamName}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-300">
                Tap below if you saw this team get eliminated this race. An admin reviews before it counts.
              </div>
            </div>

            <button
              onClick={reportElimination}
              disabled={busy || !!ownPending}
              className="w-full py-5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-bold text-lg flex items-center justify-center gap-2 shadow-soft transition"
            >
              <AlertTriangle className="w-6 h-6" />
              {ownPending ? 'Report sent — admin reviewing' : busy ? 'Sending…' : 'Mark ELIMINATED'}
            </button>

            {justSent && !ownPending && (
              <div className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Sent. Admin will confirm shortly.
              </div>
            )}
            {error && (
              <div className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 p-2 rounded-md">
                {error}
              </div>
            )}
          </div>
        </motion.div>
      ) : lane != null && activeRace ? (
        <div className="card p-3 text-xs text-slate-500">No team in lane {lane} for this race.</div>
      ) : (
        <div className="card p-3 text-xs text-slate-500">Pick the lane you're watching above.</div>
      )}

      {calls.length > 0 && (
        <div className="card p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
            <Megaphone className="w-3.5 h-3.5" /> Pending reports
          </div>
          <ul className="space-y-1 text-xs">
            {calls.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: bibAccent(c.teamBibColour) }} />
                <span className="font-semibold truncate flex-1">{c.teamName}</span>
                <span className="text-slate-400 text-[10px]">lane {c.laneIndex}{c.reporterName ? ` · ${c.reporterName}` : ''}</span>
              </li>
            ))}
            {calls.length > 8 && <li className="text-slate-400 text-[10px]">+ {calls.length - 8} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function Header({ competitionName }: { competitionName: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link to="../" className="btn-ghost !py-1 !px-2 text-xs">
        <ChevronLeft className="w-3.5 h-3.5" /> Back
      </Link>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Steward</div>
        <div className="text-sm font-bold truncate">{competitionName}</div>
      </div>
    </div>
  );
}
