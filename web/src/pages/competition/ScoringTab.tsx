import { Dropdown } from '../../components/Dropdown';
import { displaySectionName } from '../../lib/section';
import { TimetableBoard } from './TimetableBoard';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Trophy, Sparkles, X, AlertTriangle } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { StandingRow } from '../../types';
import { buildToplist } from '../../lib/toplist';
import { ToplistView } from './ToplistView';
import { TackLeaderboard } from './TackLeaderboard';
import { ToplistRowsSkeleton } from '../../components/Skeletons';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { SponsorStrip } from '../../components/SponsorStrip';
import { readSavedCopy, savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../../offline/savedCopies';
import { NumberField } from '../../components/NumberField';

const NO_ROWS: StandingRow[] = [];

/** Puts the toplist's title and refresh button in the app header while the standalone page is showing. */
function ToplistHeader({ subtitle, onRefresh }: { subtitle: string; onRefresh: () => void }) {
  usePageHeader({ title: 'Toplist', subtitle, onRefresh, refreshLabel: 'Refresh toplist' });
  return null;
}

/** The age group menu, in the header band. */
function AgeGroupSelect({ sections, value, teamCount, onChange }: { sections: { id: number; displayName: string }[]; value: number | null; teamCount: number; onChange: (id: number) => void }) {
  const current = sections.find((s) => s.id === value);
  const options = sections.map((sec) => ({ value: String(sec.id), label: displaySectionName(sec.displayName) }));
  return (
    <div className="mg-band-header pb-2.5 pt-2.5">
      <Dropdown label="Age group" value={value == null ? '' : String(value)} options={options} onChange={(id) => onChange(Number(id))} buttonClassName="flex min-h-10 w-full items-stretch overflow-hidden rounded-lg border border-[rgb(var(--mg-header-line))] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        <span className="mg-display flex min-w-0 flex-1 items-baseline gap-2 self-center px-3 text-base font-bold uppercase leading-none tracking-[0.04em]">
          <span className="truncate">{displaySectionName(current?.displayName)}</span>
          <span className="shrink-0 text-xs font-medium normal-case tracking-normal text-[rgb(var(--mg-header-sub))]">{teamCount} {teamCount === 1 ? 'team' : 'teams'}</span>
        </span>
        <span aria-hidden="true" className="flex w-11 shrink-0 items-center justify-center border-l border-[rgb(var(--mg-header-line))] bg-white/10"><ChevronDown className="h-[18px] w-[18px]" /></span>
      </Dropdown>
    </div>
  );
}

export function ScoringTab({ toplistOnly = false }: { toplistOnly?: boolean }) {
  const { competition, reload } = useCompetition();
  const { canManage } = useAuth();
  // The age group lives in the URL (?section=ID) so the menu can link straight to one.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = Number(searchParams.get('section'));
  const sectionId = competition.sections.find((s) => s.id === requestedSection)?.id ?? competition.sections[0]?.id ?? null;
  const [showToplist, setShowToplist] = useState(toplistOnly);
  const [showFinals, setShowFinals] = useState(false);

  const [standingsResult, setStandingsResult] = useState<{ sectionId: number; rows: StandingRow[]; error: boolean; savedCopy: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  // While the first answer for this age group is on its way, show the copy this phone saved last time.
  const savedStandings = useMemo(
    () => (sectionId == null ? null : readSavedCopy<StandingRow[]>(savedCopyKeys.standings(competition.id, sectionId))),
    [competition.id, sectionId],
  );
  const standingsLoading = sectionId != null && standingsResult?.sectionId !== sectionId;
  const standings = !standingsLoading && standingsResult ? standingsResult.rows : savedStandings?.data ?? NO_ROWS;
  const standingsError = standingsResult?.sectionId === sectionId && standingsResult.error;
  useEffect(() => {
    if (sectionId == null) return;
    let cancelled = false;
    const key = savedCopyKeys.standings(competition.id, sectionId);
    api.get<StandingRow[]>(`/competitions/${competition.id}/standings`, { params: { sectionId } })
      .then((r) => {
        if (cancelled) return;
        const fallback = serviceWorkerSavedAt(r.headers);
        if (fallback === null) writeSavedCopy(key, r.data);
        // The service worker's fallback can be older than what this page saved from a later visit.
        const local = fallback === null ? null : readSavedCopy<StandingRow[]>(key);
        const preferLocal = local != null && (fallback === 'unknown' || Date.parse(local.savedAt) >= (fallback as Date).getTime());
        setStandingsResult({ sectionId, rows: preferLocal ? local.data : r.data, error: false, savedCopy: fallback !== null });
      })
      .catch(() => {
        if (cancelled) return;
        setStandingsResult((previous) => {
          // A failed refresh keeps the list on screen rather than blanking it.
          if (previous?.sectionId === sectionId && !previous.error) return { ...previous, savedCopy: true };
          const local = readSavedCopy<StandingRow[]>(key);
          return local ? { sectionId, rows: local.data, error: false, savedCopy: true } : { sectionId, rows: [], error: true, savedCopy: false };
        });
      });
    return () => { cancelled = true; };
  }, [competition.id, sectionId, competition.sessions, retry]);

  const section = competition.sections.find((s) => s.id === sectionId) ?? null;
  const sectionName = displaySectionName(section?.displayName);
  const list = useMemo(
    () => buildToplist(standings, competition.sessions, competition.teams, sectionId ?? -1, section?.finalistCount),
    [standings, competition.sessions, competition.teams, sectionId, section?.finalistCount],
  );
  const progress = list.sessionsTotal === 0 ? null
    : list.sessionsDone === list.sessionsTotal ? (list.sessionsTotal === 1 ? 'After session 1' : `After all ${list.sessionsTotal} sessions`)
    : list.sessionsDone > 0 ? `After session ${list.sessionsDone} of ${list.sessionsTotal}` : null;
  const chooseSection = (id: number) => setSearchParams({ section: String(id) }, { replace: true });
  const notices = (
    <>
      {standingsLoading && !savedStandings && <ToplistRowsSkeleton />}
      {standingsError && <div role="alert" className="mg-card flex flex-col items-start gap-3 p-4"><p>Couldn’t load results. Check your connection and try again.</p><button className="mg-btn mg-btn-secondary" onClick={() => { setStandingsResult(null); setRetry((n) => n + 1); }}>Try again</button></div>}
      {sectionId != null && !standingsLoading && !standingsError && standings.length === 0 && <p className="mg-card p-4 text-[rgb(var(--mg-muted))]">No results yet.</p>}
    </>
  );
  const sectionLabel = `Toplist${sectionName ? `, ${sectionName}` : ''}`;
  // The page version draws its own tab band edge to edge, so its notices sit in their own column above it.
  const toplist = toplistOnly ? (
    <section aria-label={sectionLabel} className="flex flex-col">
      <div className="flex flex-col gap-2.5 pt-3 empty:hidden">{notices}</div>
      {standings.length > 0 && <ToplistView key={sectionId} list={list} section={section} standalone />}
      {sectionId != null && <div className="pt-3"><TackLeaderboard competitionId={competition.id} sectionId={sectionId} refresh={retry} /></div>}
    </section>
  ) : (
    <section aria-label={sectionLabel} className="flex flex-col gap-2.5">
      {notices}
      {standings.length > 0 && <ToplistView key={sectionId} list={list} section={section} />}
      {sectionId != null && <TackLeaderboard competitionId={competition.id} sectionId={sectionId} refresh={retry} />}
    </section>
  );
  const finalsButton = canManage(competition) && sectionId != null && (
    <button onClick={() => setShowFinals(true)} className="mg-btn mg-btn-primary">
      <Sparkles className="h-4 w-4" /> Create finals
    </button>
  );
  const finalsModal = (
    <AnimatePresence>
      {showFinals && sectionId != null && (
        <FinalsModal
          sectionId={sectionId}
          onClose={() => setShowFinals(false)}
          onCreated={() => { setShowFinals(false); reload(); }}
        />
      )}
    </AnimatePresence>
  );

  const teamCount = competition.teams.filter((t) => t.competitionSectionId === sectionId && !t.isHorsConcours).length;
  const ageGroups = competition.sections.length > 1 && <AgeGroupSelect sections={competition.sections} value={sectionId} teamCount={teamCount} onChange={chooseSection} />;
  if (toplistOnly || sectionId == null) {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col">
        {toplistOnly && <ToplistHeader subtitle={[competition.name, progress].filter(Boolean).join(' · ')} onRefresh={() => setRetry((n) => n + 1)} />}
        {!toplistOnly && <h1 className="mg-h1 mg-h1-sm py-3">Age groups</h1>}
        {ageGroups}
        <div className="flex flex-col gap-3">
          {sectionId == null ? <p className="mg-card mt-3 p-4 text-[rgb(var(--mg-muted))]">No age groups yet.</p> : toplist}
          {sectionId != null && <SponsorStrip placement="Results" />}
          {finalsButton && <div className="pt-1">{finalsButton}</div>}
        </div>
        {finalsModal}
      </div>
    );
  }

  return (
    <>
      <TimetableBoard
        sectionId={sectionId}
        title={sectionName || 'Age group'}
        bandExtra={ageGroups}
        lead={
          <div className="flex flex-col gap-3">
            <button type="button" className="mg-tint-link" aria-expanded={showToplist} onClick={() => setShowToplist((v) => !v)}>
              <Trophy aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{showToplist ? 'Hide toplist' : `Show ${sectionName ? `${sectionName} ` : ''}toplist`}</span>
              <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${showToplist ? 'rotate-90' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
              {showToplist && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  {toplist}
                </motion.div>
              )}
            </AnimatePresence>
            {finalsButton}
          </div>
        }
      />
      {finalsModal}
    </>
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
              <NumberField  min={1} max={50} className="input mt-1 text-sm"
                value={topN} onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold">Lanes per heat</span>
              <NumberField  min={1} max={20} className="input mt-1 text-sm"
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
