import { displaySectionName } from '../../lib/section';
import { TimetableBoard } from './TimetableBoard';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Sparkles, X, AlertTriangle } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { StandingRow } from '../../types';

export function ScoringTab({ toplistOnly = false }: { toplistOnly?: boolean }) {
  const { competition, reload } = useCompetition();
  const { canEdit } = useAuth();
  // The age group lives in the URL (?section=ID) so the menu can link straight to one.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = Number(searchParams.get('section'));
  const sectionId = competition.sections.find((s) => s.id === requestedSection)?.id ?? competition.sections[0]?.id ?? null;
  const [showToplist, setShowToplist] = useState(toplistOnly);
  const [showFinals, setShowFinals] = useState(false);

  const [standingsResult, setStandingsResult] = useState<{ sectionId: number; rows: StandingRow[]; error: boolean; savedCopy: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const standings = standingsResult?.sectionId === sectionId ? standingsResult.rows : [];
  const standingsLoading = sectionId != null && standingsResult?.sectionId !== sectionId;
  const standingsError = standingsResult?.sectionId === sectionId && standingsResult.error;
  useEffect(() => {
    if (sectionId == null) return;
    let cancelled = false;
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then((r) => { if (!cancelled) setStandingsResult({ sectionId, rows: r.data, error: false, savedCopy: r.headers['x-mg-saved-copy'] === '1' }); })
      .catch(() => { if (!cancelled) setStandingsResult({ sectionId, rows: [], error: true, savedCopy: false }); });
    return () => { cancelled = true; };
  }, [competition.id, sectionId, competition.sessions, retry]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-0 flex-1 basis-48">
          <span className="sr-only">Age group</span>
          <select className="input min-h-12 w-full !text-xl !font-bold" value={sectionId ?? ''} onChange={(e) => setSearchParams({ section: e.target.value }, { replace: true })} disabled={competition.sections.length === 0}>
            {competition.sections.length === 0 && <option value="">No age groups yet</option>}
            {competition.sections.map((sec) => <option key={sec.id} value={sec.id}>{displaySectionName(sec.displayName)}</option>)}
          </select>
        </label>
        <div className="ml-auto flex gap-1">
          {!toplistOnly && <button
            onClick={() => setShowToplist((v) => !v)}
            className={`btn-ghost min-h-11 !px-3 text-sm ${showToplist ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200' : ''}`}
          >
            <Trophy className="w-3.5 h-3.5" /> {showToplist ? 'Hide toplist' : 'Show toplist'}
          </button>}
          {canEdit() && sectionId != null && (
            <button onClick={() => setShowFinals(true)} className="btn-primary !py-1.5 !px-2.5 text-xs">
              <Sparkles className="w-3.5 h-3.5" /> Create finals
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {(toplistOnly || showToplist) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="card p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold mb-1 px-1">
                Toplist · {displaySectionName(competition.sections.find((s) => s.id === sectionId)?.displayName) || '—'}
              </div>
              {sectionId == null && <p className="text-slate-500 text-xs">Pick an age group.</p>}
              {standingsResult?.sectionId === sectionId && standingsResult.savedCopy && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Showing saved results. Positions may have changed.</p>}
              {standingsLoading && <p role="status" className="p-3 text-sm text-slate-500">Loading results…</p>}
              {standingsError && <div role="alert" className="space-y-2 p-3 text-sm"><p>Couldn’t load results. Check your connection and try again.</p><button className="btn-ghost min-h-11" onClick={() => { setStandingsResult(null); setRetry((n) => n + 1); }}>Try again</button></div>}
              {sectionId != null && !standingsLoading && !standingsError && standings.length === 0 && <p className="p-3 text-sm text-slate-500">No results yet.</p>}
              <ol className="divide-y divide-slate-100 dark:divide-slate-700">
                {standings.map((r, idx) => (
                  <li key={r.teamId} className="flex min-h-12 items-center gap-3 px-3 py-2">
                    <span className="w-5 text-right shrink-0 font-mono font-bold text-brand-700 dark:text-brand-200 text-xs tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1 break-words text-sm">{r.teamName}</div>
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

      {!toplistOnly && sectionId != null && <TimetableBoard sectionId={sectionId} hideTitle />}

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
