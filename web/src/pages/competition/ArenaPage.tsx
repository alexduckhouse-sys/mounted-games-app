import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Activity, Clock, BookOpen, ArrowRight, Flag, Users,
} from 'lucide-react';
import { api } from '../../api';
import type { Heat, RaceTemplate, Session } from '../../types';
import { useCompetition } from './context';
import { RaceDiagram } from '../../components/RaceDiagram';
import { displaySectionName } from '../../lib/section';
import { formatTime, roundTo5Min, computeTimings } from '../../lib/time';

function heatIsComplete(h: Heat): boolean {
  return h.races.length > 0 && h.races.every((r) => r.isComplete);
}

function computeTarget(sessions: Session[]): { session: Session; heat: Heat; heatIndex: number } | null {
  const races = sessions
    .filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0)
    .slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const live = races.find((s) => s.status === 1);
  const pool = live ? [live, ...races.filter((s) => s.id !== live.id)] : races;
  for (const s of pool) {
    const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const idx = heats.findIndex((h) => !heatIsComplete(h));
    if (idx >= 0) return { session: s, heat: heats[idx], heatIndex: idx };
  }
  return null;
}

export function ArenaPage() {
  const { competition } = useCompetition();
  const [templates, setTemplates] = useState<RaceTemplate[]>([]);

  useEffect(() => {
    api.get<RaceTemplate[]>('/race-templates').then((r) => setTemplates(r.data)).catch(() => {});
  }, []);

  const tmplByName = useMemo(() => {
    const m = new Map<string, RaceTemplate>();
    for (const t of templates) m.set(t.name.toLowerCase().trim(), t);
    return m;
  }, [templates]);

  // Pick the heat that's most "now": the first not-complete heat in the first session
  // whose status is In Arena (1) or — failing that — the next not-complete heat anywhere.
  const target = computeTarget(competition.sessions);
  const orderedRaces = target
    ? target.heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex)
    : [];

  // Keep a per-heat step offset so we don't need a reset-on-change effect (which trips the lint).
  // Step offset is relative to the first incomplete race; 0 means "auto-pick".
  const heatKey = target?.heat.id ?? 0;
  const [offsetByHeat, setOffsetByHeat] = useState<Record<number, number>>({});
  const stepOffset = offsetByHeat[heatKey] ?? 0;
  function bumpOffset(delta: number) {
    setOffsetByHeat((cur) => ({ ...cur, [heatKey]: (cur[heatKey] ?? 0) + delta }));
  }
  function setOffsetTo(value: number) {
    setOffsetByHeat((cur) => ({ ...cur, [heatKey]: value }));
  }
  const baseIdx = orderedRaces.findIndex((r) => !r.isComplete);
  const activeIdx = Math.max(0, Math.min(orderedRaces.length - 1,
    (baseIdx >= 0 ? baseIdx : 0) + stepOffset
  ));

  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const heatTiming = target ? timings.get(target.session.id)?.heats[target.heatIndex] ?? null : null;

  if (!target) {
    return (
      <div className="space-y-3">
        <Link to=".." className="btn-ghost !py-1.5 !px-2.5 text-sm">
          <ChevronLeft className="w-4 h-4" /> Back
        </Link>
        <div className="card p-6 text-center">
          <Activity className="w-10 h-10 mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">Nothing currently in the arena.</p>
        </div>
      </div>
    );
  }

  const activeRace = orderedRaces[activeIdx];
  const template = activeRace ? tmplByName.get(activeRace.name.toLowerCase().trim()) : null;
  const nextRace = orderedRaces[activeIdx + 1] ?? null;
  const prevRace = activeIdx > 0 ? orderedRaces[activeIdx - 1] : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Link to=".." className="btn-ghost !py-1.5 !px-2.5 text-sm">
          <ChevronLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-arena-live" /> Arena setup
        </h1>
      </div>

      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">Heat in arena</div>
          <div className="font-bold text-lg truncate">
            {displaySectionName(target.session.sectionName ?? target.session.name)} · {target.heat.label ?? `Heat ${target.heatIndex + 1}`}
          </div>
        </div>
        {heatTiming && (
          <div className="flex items-center gap-1 text-sm font-mono tabular-nums text-slate-600 dark:text-slate-200">
            <Clock className="w-4 h-4 text-slate-400" /> {formatTime(roundTo5Min(heatTiming.effective ?? heatTiming.scheduled))}
          </div>
        )}
        <div className="text-xs text-slate-500 inline-flex items-center gap-1 shrink-0">
          <Users className="w-3 h-3" /> {target.heat.entries.length} teams
        </div>
      </div>

      <div className="card p-3 sm:p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Race {activeIdx + 1} of {orderedRaces.length}</span>
          <h2 className="text-2xl sm:text-3xl font-extrabold flex-1 min-w-0 truncate">
            {activeRace?.name ?? 'No race'}
          </h2>
          {activeRace?.isComplete && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 text-xs font-bold">
              Done
            </span>
          )}
        </div>

        {template ? (
          <>
            {template.summary && (
              <p className="text-sm text-slate-700 dark:text-slate-200 mb-2">{template.summary}</p>
            )}
            <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeRace?.id ?? activeIdx}
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <RaceDiagram diagramJson={template.diagramJson} height={200} />
                </motion.div>
              </AnimatePresence>
            </div>
            {template.rules && (
              <div className="mt-3 rounded-md border border-brand-200 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-900/20 p-3">
                <div className="text-sm font-bold flex items-center gap-1.5 text-brand-800 dark:text-brand-200 mb-1">
                  <BookOpen className="w-4 h-4" /> Set-up rules
                </div>
                <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">
                  {template.rules}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 p-6 text-center">
            <Flag className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No setup diagram for "{activeRace?.name}" yet — add it under Admin → Race rules.</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => bumpOffset(-1)}
          disabled={!prevRace}
          className="btn-ghost !py-2 !px-3 text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>
        <div className="flex-1 text-center text-xs text-slate-500">
          Heat {target.heat.label ?? target.heatIndex + 1}
        </div>
        <button
          onClick={() => bumpOffset(1)}
          disabled={!nextRace}
          className="btn-primary !py-2 !px-4 text-sm"
        >
          {nextRace ? <>Next race · {nextRace.name} <ArrowRight className="w-4 h-4" /></> : <>End of heat</>}
        </button>
      </div>

      <div className="card p-3">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">All races in this heat</div>
        <div className="flex flex-wrap gap-1.5">
          {orderedRaces.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setOffsetTo(i - (baseIdx >= 0 ? baseIdx : 0))}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                i === activeIdx
                  ? 'bg-brand-600 text-white'
                  : r.isComplete
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-100'
              }`}
            >
              {i + 1}. {r.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
