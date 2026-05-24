import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Activity, Flag, Trophy, Sparkles, X, AlertTriangle, Clock } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { Session, StandingRow } from '../../types';
import { SessionKind } from '../../types';
import { computeTimings, roundTo5Min, formatTime } from '../../lib/time';

function heatIsComplete(h: Session['heats'][number]): boolean {
  return h.races.length > 0 && h.races.every((r) => r.isComplete);
}

interface TimeChipProps { scheduled: Date | null; effective: Date | null; shifted: boolean }
function TimeChip({ scheduled, effective, shifted }: TimeChipProps) {
  const eff = roundTo5Min(effective);
  const sch = roundTo5Min(scheduled);
  return (
    <span className="inline-flex items-baseline gap-1 font-mono tabular-nums text-[11px] shrink-0">
      <Clock className="inline w-3 h-3 -mt-px text-slate-400" />
      {shifted && sch && <span className="line-through text-slate-400">{formatTime(sch)}</span>}
      <span className={shifted ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>
        {formatTime(eff ?? sch)}
      </span>
    </span>
  );
}

export function ScoringTab() {
  const { competition, reload } = useCompetition();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const firstSectionId = competition.sections[0]?.id ?? null;
  const [sectionId, setSectionId] = useState<number | null>(firstSectionId);
  const [showToplist, setShowToplist] = useState(false);
  const [showFinals, setShowFinals] = useState(false);

  const raceSessions = useMemo(
    () => competition.sessions
      .filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === SessionKind.Race)
      .filter((s) => sectionId == null || s.competitionSectionId === sectionId)
      .sort((a, b) => a.orderIndex - b.orderIndex),
    [competition.sessions, sectionId]
  );

  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);

  const [standings, setStandings] = useState<StandingRow[]>([]);
  useEffect(() => {
    if (sectionId == null) { setStandings([]); return; }
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then((r) => setStandings(r.data))
      .catch(() => setStandings([]));
  }, [competition.id, sectionId, competition.sessions]);

  return (
    <div className="space-y-3">
      <div className="card p-1.5 flex overflow-x-auto gap-1 -mx-1 px-1 items-center">
        {competition.sections.map((sec) => (
          <button
            key={sec.id}
            onClick={() => setSectionId(sec.id)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
              sectionId === sec.id
                ? 'bg-brand-600 text-white shadow-soft'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800'
            }`}
          >
            {sec.displayName}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setShowToplist((v) => !v)}
            className={`btn-ghost !py-1.5 !px-2.5 text-xs ${showToplist ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200' : ''}`}
          >
            <Trophy className="w-3.5 h-3.5" /> Toplist
          </button>
          {hasRole('Admin') && sectionId != null && (
            <button onClick={() => setShowFinals(true)} className="btn-primary !py-1.5 !px-2.5 text-xs">
              <Sparkles className="w-3.5 h-3.5" /> Create finals
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showToplist && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="card p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1 px-1">
                Toplist · {competition.sections.find((s) => s.id === sectionId)?.displayName ?? '—'}
              </div>
              {sectionId == null && <p className="text-slate-500 text-xs">Pick a section.</p>}
              {sectionId != null && standings.length === 0 && <p className="text-slate-500 text-xs">No results yet.</p>}
              <ol className="divide-y divide-slate-100 dark:divide-slate-700">
                {standings.map((r, idx) => (
                  <li key={r.teamId} className="flex items-center gap-2 px-1.5 py-1">
                    <span className="w-5 text-right shrink-0 font-mono font-bold text-brand-700 dark:text-brand-200 text-xs tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0 text-xs truncate">{r.teamName}</div>
                    <div className="font-mono text-sm font-bold text-brand-700 dark:text-brand-200 tabular-nums">
                      {r.totalPoints}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {raceSessions.length === 0 && (
        <p className="text-slate-500 dark:text-slate-300 text-sm">No race sessions in this section.</p>
      )}

      <div className="space-y-1.5">
        {raceSessions.map((s, si) => {
          const t = timings.get(s.id);
          const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
          const sessionIndex = si + 1;
          return (
            <div
              key={s.id}
              className={`rounded-lg border ${
                s.status === 1
                  ? 'border-yellow-300 dark:border-yellow-700 ring-1 ring-yellow-300/60'
                  : 'border-slate-200 dark:border-slate-700'
              } bg-white/60 dark:bg-slate-800/40 overflow-hidden`}
            >
              <div className="px-2 py-1 flex items-center gap-1.5 flex-wrap text-[11px] bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700">
                {s.status === 1 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-arena-live/90 text-yellow-900 text-[9px] font-bold">
                    <Activity className="w-2.5 h-2.5" /> IN ARENA
                  </span>
                )}
                {s.status === 2 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-arena-finished/90 text-white text-[9px] font-bold">
                    <CheckCircle2 className="w-2.5 h-2.5" /> DONE
                  </span>
                )}
                <span className="font-semibold truncate flex-1 min-w-0">
                  Session {sessionIndex} <span className="text-slate-500 dark:text-slate-400 font-normal">· {s.name}</span>
                </span>
              </div>
              {heats.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-300">No heats yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {heats.map((h, idx) => {
                    const ht = t?.heats[idx];
                    const complete = heatIsComplete(h);
                    const racesDone = h.races.filter((r) => r.isComplete).length;
                    return (
                      <li
                        key={h.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`../session/${s.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`../session/${s.id}`);
                          }
                        }}
                        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition ${
                          complete ? 'text-slate-400 dark:text-slate-500' : ''
                        }`}
                      >
                        <TimeChip scheduled={ht?.scheduled ?? null} effective={ht?.effective ?? null} shifted={ht?.shifted ?? false} />
                        <span className="font-semibold text-xs truncate flex-1">{h.label ?? `Heat ${idx + 1}`}</span>
                        <Flag className="w-3 h-3 text-brand-500 shrink-0" />
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                          {h.entries.length}t · {racesDone}/{h.races.length}
                        </span>
                        {complete && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {showFinals && sectionId != null && (
          <FinalsModal
            sectionId={sectionId}
            onClose={() => setShowFinals(false)}
            onCreated={() => { setShowFinals(false); reload(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface FinalsModalProps { sectionId: number; onClose: () => void; onCreated: () => void }

function FinalsModal({ sectionId, onClose, onCreated }: FinalsModalProps) {
  const { competition } = useCompetition();
  const [topN, setTopN] = useState(6);
  const [lanes, setLanes] = useState(6);
  const [name, setName] = useState('');
  const [races, setRaces] = useState('Litter Lifter\nFlag\nBottle\nMug\nBall and Cone');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);

  useEffect(() => {
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then((r) => setStandings(r.data))
      .catch(() => setStandings([]));
  }, [competition.id, sectionId]);

  const runoff = useMemo(() => {
    if (standings.length <= topN) return null;
    const cutoff = standings[topN - 1];
    const next = standings[topN];
    if (cutoff.totalPoints !== next.totalPoints) return null;
    const tied = standings.filter((s) => s.totalPoints === cutoff.totalPoints);
    const seatsLeft = topN - standings.slice(0, topN).filter((s) => s.totalPoints > cutoff.totalPoints).length;
    return { tied, points: cutoff.totalPoints, seatsLeft };
  }, [standings, topN]);

  async function submit() {
    setErr(null);
    const raceNames = races.split('\n').map((r) => r.trim()).filter(Boolean);
    if (raceNames.length === 0) { setErr('Add at least one race.'); return; }
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/finals`, {
        competitionSectionId: sectionId,
        topN, raceNames, lanesPerHeat: lanes, name: name.trim() || null,
      });
      onCreated();
    } catch (e) {
      const m = (e as { response?: { data?: string } }).response?.data;
      setErr(typeof m === 'string' ? m : 'Could not create finals.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-3"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
        className="card w-full max-w-md max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-800">
          <Sparkles className="w-4 h-4 text-brand-600" />
          <h3 className="font-semibold text-sm flex-1">Create finals</h3>
          <button onClick={onClose} className="btn-ghost !py-1 !px-1.5"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">Top N teams</span>
              <input type="number" min={1} max={50} className="input mt-1 text-sm"
                value={topN} onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Lanes per heat</span>
              <input type="number" min={1} max={20} className="input mt-1 text-sm"
                value={lanes} onChange={(e) => setLanes(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold">Session name (optional)</span>
            <input className="input mt-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold">Races (one per line)</span>
            <textarea rows={5} className="input mt-1 text-sm font-mono" value={races} onChange={(e) => setRaces(e.target.value)} />
          </label>

          {runoff && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 p-2 text-[12px]">
              <div className="flex items-center gap-1.5 font-semibold mb-1">
                <AlertTriangle className="w-4 h-4" /> Runoff needed
              </div>
              <p className="text-[11px]">
                {runoff.tied.length} teams tied on {runoff.points} pts at position {topN} — only {runoff.seatsLeft}{' '}
                {runoff.seatsLeft === 1 ? 'spot' : 'spots'} left. Run a tie-breaker first:
              </p>
              <ul className="mt-1 space-y-0.5">
                {runoff.tied.map((t) => (
                  <li key={t.teamId} className="flex items-center justify-between text-[11px]">
                    <span className="truncate">{t.teamName}</span>
                    <span className="font-mono">{t.totalPoints}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {err && <div className="text-xs text-rose-600">{err}</div>}
        </div>
        <div className="flex items-center gap-2 p-3 border-t border-slate-200 dark:border-slate-800">
          <button onClick={onClose} className="btn-ghost !py-1.5 !px-3 text-xs">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn-primary !py-1.5 !px-3 text-xs ml-auto">
            <Sparkles className="w-3.5 h-3.5" /> {busy ? 'Creating…' : 'Create finals'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
