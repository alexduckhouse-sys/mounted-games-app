import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Sparkles, X, AlertTriangle } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { StandingRow } from '../../types';
import { bibAccent } from '../../lib/bib';

export function StandingsTab() {
  const { competition, reload } = useCompetition();
  const { canEdit } = useAuth();
  const firstSectionId = competition.sections[0]?.id ?? null;
  const [sectionId, setSectionId] = useState<number | null>(firstSectionId);
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [showFinals, setShowFinals] = useState(false);

  useEffect(() => {
    if (sectionId == null) { setRows([]); return; }
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, {
      params: { sectionId },
    }).then((r) => setRows(r.data));
  }, [competition.id, sectionId]);

  return (
    <div className="space-y-4">
      <div className="card p-3 flex flex-wrap gap-2">
        {competition.sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSectionId(s.id)}
            className={`pill ${sectionId === s.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            {s.displayName}
          </button>
        ))}
        {canEdit() && sectionId != null && (
          <button
            onClick={() => setShowFinals(true)}
            className="ml-auto btn-primary !py-1 !px-2.5 text-xs"
          >
            <Sparkles className="w-3.5 h-3.5" /> Create finals
          </button>
        )}
      </div>

      <PerRaceScoresTable competition={competition} sectionId={sectionId} totals={rows} />

      <AnimatePresence>
        {showFinals && (
          <FinalsModal
            defaultSectionId={sectionId}
            onClose={() => setShowFinals(false)}
            onCreated={() => { setShowFinals(false); reload(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Per-race × per-team score grid. Works for both standard sections and
 * race-finals sections — for race-finals it sums points across Q1+Q2+Final
 * heats that share the same race name, so the public sees one column per
 * race exactly like a standard heat layout. No lane info shown.
 */
function PerRaceScoresTable({
  competition, sectionId, totals,
}: {
  competition: ReturnType<typeof useCompetition>['competition'];
  sectionId: number | null;
  totals: StandingRow[];
}) {
  const grid = useMemo(() => {
    if (sectionId == null) return null;
    // Collect distinct race-name columns (in the order they first appear).
    const raceNames: string[] = [];
    const raceSet = new Set<string>();
    // Points keyed by `${teamId}|${raceName}`.
    const cells = new Map<string, number>();
    const elimSet = new Set<string>(); // teamId|raceName → at least one elim with zero
    for (const sess of competition.sessions) {
      if (sess.competitionSectionId !== sectionId) continue;
      const heats = sess.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      for (const heat of heats) {
        for (const race of heat.races) {
          if (!raceSet.has(race.name)) { raceSet.add(race.name); raceNames.push(race.name); }
          for (const r of race.results) {
            const k = `${r.teamId}|${race.name}`;
            cells.set(k, (cells.get(k) ?? 0) + r.points);
            if (r.eliminated && r.points === 0) elimSet.add(k);
          }
        }
      }
    }
    return { raceNames, cells, elimSet };
  }, [competition.sessions, sectionId]);

  if (sectionId == null) {
    return (
      <div className="card p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Trophy className="w-5 h-5 text-brand-600" /> Standings
        </h2>
        <p className="text-slate-500 text-sm">No sections in this competition.</p>
      </div>
    );
  }
  if (!grid || grid.raceNames.length === 0 || totals.length === 0) {
    return (
      <div className="card p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Trophy className="w-5 h-5 text-brand-600" /> Standings
        </h2>
        <p className="text-slate-500 text-sm">No results yet.</p>
      </div>
    );
  }

  return (
    <div className="card p-3 sm:p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Trophy className="w-5 h-5 text-brand-600" />
        <h2 className="font-semibold flex-1">Standings</h2>
        <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
          Points per race
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-500">
              <th className="text-left font-semibold px-1.5 py-1 sticky left-0 bg-white dark:bg-slate-900 z-10">#</th>
              <th className="text-left font-semibold px-1.5 py-1 sticky left-6 bg-white dark:bg-slate-900 z-10 min-w-[120px]">Team</th>
              {grid.raceNames.map((n) => (
                <th key={n} className="text-center font-semibold px-1.5 py-1 max-w-[80px] truncate" title={n}>
                  {n}
                </th>
              ))}
              <th className="text-right font-bold px-1.5 py-1 text-brand-700 dark:text-brand-200">Total</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((row, idx) => (
              <tr
                key={row.teamId}
                className="border-t border-slate-100 dark:border-slate-700/60"
              >
                <td className="px-1.5 py-1 font-mono font-bold text-brand-700 dark:text-brand-200 sticky left-0 bg-white dark:bg-slate-900">
                  {idx + 1}
                </td>
                <td className="px-1.5 py-1 sticky left-6 bg-white dark:bg-slate-900 truncate">
                  {row.teamName}
                </td>
                {grid.raceNames.map((n) => {
                  const k = `${row.teamId}|${n}`;
                  const pts = grid.cells.get(k);
                  const elim = grid.elimSet.has(k);
                  return (
                    <td key={n} className="px-1.5 py-1 text-center font-mono tabular-nums">
                      {pts == null
                        ? <span className="text-slate-300">—</span>
                        : elim && pts === 0
                          ? <span className="text-rose-500">0</span>
                          : <span className="font-semibold">{pts}</span>}
                    </td>
                  );
                })}
                <td className="px-1.5 py-1 text-right font-mono font-bold text-brand-700 dark:text-brand-200 tabular-nums">
                  {row.totalPoints}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

interface RunoffInfo {
  cutoffPoints: number;
  tiedTeams: StandingRow[];
  seatsLeft: number;
}

function detectRunoff(standings: StandingRow[], topN: number): RunoffInfo | null {
  if (standings.length <= topN) return null;
  const cutoff = standings[topN - 1];
  const next = standings[topN];
  if (cutoff.totalPoints !== next.totalPoints) return null;
  const tied = standings.filter((s) => s.totalPoints === cutoff.totalPoints);
  const teamsAlreadyIn = standings.slice(0, topN).filter((s) => s.totalPoints > cutoff.totalPoints).length;
  const seatsLeft = topN - teamsAlreadyIn;
  return { cutoffPoints: cutoff.totalPoints, tiedTeams: tied, seatsLeft };
}

function FinalsModal({ defaultSectionId, onClose, onCreated }: {
  defaultSectionId: number | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { competition } = useCompetition();
  const [sectionId, setSectionId] = useState<number | null>(defaultSectionId);
  const [topN, setTopN] = useState(6);
  const [lanes, setLanes] = useState(6);
  const [name, setName] = useState('');
  const [races, setRaces] = useState('Litter Lifter\nFlag\nBottle\nMug\nBall and Cone');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [standingsLoading, setStandingsLoading] = useState(false);

  useEffect(() => {
    setStandingsLoading(true);
    const params: Record<string, number> = {};
    if (sectionId) params.sectionId = sectionId;
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params })
      .then((r) => setStandings(r.data))
      .catch(() => setStandings([]))
      .finally(() => setStandingsLoading(false));
  }, [competition.id, sectionId]);

  const runoff = useMemo(() => detectRunoff(standings, topN), [standings, topN]);

  async function submit() {
    setErr(null);
    const raceNames = races.split('\n').map((r) => r.trim()).filter(Boolean);
    if (raceNames.length === 0) { setErr('Add at least one race.'); return; }
    setBusy(true);
    try {
      await api.post(`/competitions/${competition.id}/finals`, {
        competitionSectionId: sectionId,
        topN,
        raceNames,
        lanesPerHeat: lanes,
        name: name.trim() || null,
      });
      onCreated();
    } catch (e) {
      const message = (e as { response?: { data?: string } }).response?.data;
      setErr(typeof message === 'string' ? message : 'Could not create finals.');
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
          <label className="block">
            <span className="text-xs font-semibold">Section</span>
            <select
              className="input mt-1 text-sm"
              value={sectionId ?? ''}
              onChange={(e) => setSectionId(e.target.value ? parseInt(e.target.value, 10) : null)}
            >
              <option value="">All sections</option>
              {competition.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">Top N teams</span>
              <input
                type="number" min={1} max={50}
                className="input mt-1 text-sm"
                value={topN}
                onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Lanes per heat</span>
              <input
                type="number" min={1} max={20}
                className="input mt-1 text-sm"
                value={lanes}
                onChange={(e) => setLanes(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold">Session name (optional)</span>
            <input
              className="input mt-1 text-sm"
              placeholder="Finals · Senior Pairs"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold">Races (one per line)</span>
            <textarea
              rows={5}
              className="input mt-1 text-sm font-mono"
              value={races}
              onChange={(e) => setRaces(e.target.value)}
            />
          </label>

          {standingsLoading ? (
            <div className="text-[11px] text-slate-500">Checking standings…</div>
          ) : runoff ? (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 p-2 text-[12px]">
              <div className="flex items-center gap-1.5 font-semibold mb-1">
                <AlertTriangle className="w-4 h-4" /> Runoff needed before finals
              </div>
              <p className="text-[11px]">
                {runoff.tiedTeams.length} teams are tied on <span className="font-semibold">{runoff.cutoffPoints} pts</span>
                {' '}at position {topN}. Only {runoff.seatsLeft} {runoff.seatsLeft === 1 ? 'spot' : 'spots'} left — run a tie-breaker race
                between these teams before creating the finals:
              </p>
              <ul className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1">
                {runoff.tiedTeams.map((t) => (
                  <li key={t.teamId} className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: bibAccent(t.bibColour) }} />
                    <span className="truncate flex-1">{t.teamName}</span>
                    <span className="font-mono">{t.totalPoints}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : standings.length > 0 && standings.length >= topN && (
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 p-2 text-[11px]">
              Clear split at position {topN} — no runoff needed.
            </div>
          )}

          {err && <div className="text-xs text-rose-600">{err}</div>}
        </div>

        <div className="flex items-center gap-2 p-3 border-t border-slate-200 dark:border-slate-800">
          <button onClick={onClose} className="btn-ghost !py-1.5 !px-3 text-xs">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="btn-primary !py-1.5 !px-3 text-xs ml-auto"
          >
            <Sparkles className="w-3.5 h-3.5" /> {busy ? 'Creating…' : 'Create finals'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
