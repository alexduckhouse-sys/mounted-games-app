import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Activity, Clock, BookOpen, ArrowRight, Flag, Users,
} from 'lucide-react';
import { api } from '../../api';
import type { Heat, RaceTemplate, Session } from '../../types';
import { useCompetition } from './context';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { RaceDiagram } from '../../components/RaceDiagram';
import {
  buildRaceRulebooks,
  RaceRulebookSection,
  type RaceTemplateDetail,
} from '../../components/RaceRulesSheet';
import { PageGrid } from '../../components/PageGrid';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import {
  diffRaceEquipment, equipmentFromDiagram, type EquipmentCount, type RaceChangeoverDiff,
} from '../../lib/raceEquipment';
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

const isRaceSession = (s: Session) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0;
const arenaOf = (s: Session) => s.arenaName?.trim() ?? '';
const arenaStorageKey = (competitionId: number) => `mg.arena.page.${competitionId}`;

function storedArena(competitionId: number): string {
  try { return localStorage.getItem(arenaStorageKey(competitionId)) ?? ''; } catch { return ''; }
}

/** Sticky pill bar for choosing which arena's heat to show; only drawn when there is more than one arena. */
function ArenaBar({ arenas, selected, onChoose }: { arenas: string[]; selected: string; onChoose: (name: string) => void }) {
  return (
    <div className="sticky z-20 -mx-4 px-4 py-2 border-b" style={{ top: 'var(--mg-shell-h, 0px)', background: 'rgb(var(--mg-surface))', borderColor: 'rgb(var(--mg-control))' }}>
      <div className="mg-chips" role="group" aria-label="Choose arena">
        {arenas.map((name) => (
          <button key={name} type="button" className="mg-chip" aria-pressed={selected === name} onClick={() => onChoose(name)}>{name}</button>
        ))}
      </div>
    </div>
  );
}

function EquipmentList({ items }: { items: EquipmentCount[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2" aria-label="Equipment required">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Equipment required (per lane)</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            {item.count} × {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChangeoverStrip({ diff }: { diff: RaceChangeoverDiff }) {
  return (
    <div
      className="mt-2.5 rounded-lg border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-subtle))] p-2.5 text-xs space-y-1.5"
      aria-label="Ring crew changeover"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold uppercase tracking-wide text-[rgb(var(--mg-muted))]">Ring crew changeover</span>
        <span className="rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 font-semibold text-amber-900 dark:text-amber-200">
          {diff.poleLabel}
        </span>
      </div>
      {diff.removeItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold uppercase text-rose-700 dark:text-rose-300">OUT:</span>
          {diff.removeItems.map((it) => (
            <span key={`${it.label}-${it.zone}`} className="rounded bg-rose-50 dark:bg-rose-950/50 px-1.5 py-0.5 font-medium text-rose-800 dark:text-rose-200">
              −{it.count} {it.label} · {it.zone}
            </span>
          ))}
        </div>
      )}
      {diff.addItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold uppercase text-emerald-700 dark:text-emerald-300">IN:</span>
          {diff.addItems.map((it) => (
            <span key={`${it.label}-${it.zone}`} className="rounded bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 font-medium text-emerald-800 dark:text-emerald-200">
              +{it.count} {it.label} · {it.zone}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArenaPage() {
  usePageWidth('wide');
  const desktop = useIsDesktop();
  const { competition } = useCompetition();
  usePageHeader({
    title: 'Arena setup',
    subtitle: competition.name,
    backTo: `/competitions/${competition.id}/timetable`,
    backLabel: 'Timetable',
  });
  const [templates, setTemplates] = useState<RaceTemplate[]>([]);
  const [byNameDetails, setByNameDetails] = useState<Record<string, RaceTemplateDetail>>({});
  const arenas = useMemo(
    () => [...new Set(competition.sessions.filter(isRaceSession).map(arenaOf).filter(Boolean))],
    [competition.sessions],
  );
  const [pickedArena, setPickedArena] = useState(() => storedArena(competition.id));
  // A stale or missing choice falls back to the first arena; with one arena (or none) there is nothing to choose.
  const selectedArena = arenas.length > 1 ? (arenas.includes(pickedArena) ? pickedArena : arenas[0]) : '';
  function chooseArena(name: string) {
    setPickedArena(name);
    try { localStorage.setItem(arenaStorageKey(competition.id), name); } catch { /* storage blocked */ }
  }
  const arenaBar = arenas.length > 1 ? <ArenaBar arenas={arenas} selected={selectedArena} onChoose={chooseArena} /> : null;

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
  // With several arenas, only that arena's sessions (plus any shared "all arenas" ones) are considered.
  const target = computeTarget(selectedArena
    ? competition.sessions.filter((s) => !arenaOf(s) || arenaOf(s) === selectedArena)
    : competition.sessions);
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
  const activeRace = orderedRaces[activeIdx];
  const activeRaceName = activeRace?.name?.trim() ?? '';
  const activeKey = activeRaceName.toLowerCase();

  useEffect(() => {
    if (!activeRaceName || byNameDetails[activeKey]) return;
    let cancelled = false;
    api
      .get<RaceTemplateDetail>(`/race-templates/by-name/${encodeURIComponent(activeRaceName)}`)
      .then((res) => {
        if (!cancelled && res?.data && typeof res.data.name === 'string') {
          setByNameDetails((cur) => ({
            ...cur,
            [activeKey]: { ...res.data, rulebooks: buildRaceRulebooks(res.data) },
          }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeRaceName, activeKey, byNameDetails]);

  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const heatTiming = target ? timings.get(target.session.id)?.heats[target.heatIndex] ?? null : null;

  if (!target) {
    return (
      <div className="space-y-2.5 pt-2">
        <h1 className="sr-only">Arena setup</h1>
        {arenaBar}
        <div className="mg-card p-6 text-center">
          <Activity className="mx-auto mb-2 h-10 w-10 text-[rgb(var(--mg-faint))]" />
          <p className="text-sm text-[rgb(var(--mg-muted))]">Nothing currently in the arena.</p>
        </div>
      </div>
    );
  }

  const template = activeRace ? (byNameDetails[activeKey] ?? tmplByName.get(activeKey) ?? null) : null;
  const activeEquipment = equipmentFromDiagram(template?.diagramJson);
  const nextRace = orderedRaces[activeIdx + 1] ?? null;
  const nextTemplate = nextRace ? tmplByName.get(nextRace.name.toLowerCase().trim()) : null;
  const nextEquipment = equipmentFromDiagram(nextTemplate?.diagramJson);
  const nextDescription = nextTemplate?.summary || nextTemplate?.rules || null;
  const prevRace = activeIdx > 0 ? orderedRaces[activeIdx - 1] : null;
  const prevTemplate = prevRace ? tmplByName.get(prevRace.name.toLowerCase().trim()) : null;
  const activeChangeover = template ? diffRaceEquipment(prevTemplate?.diagramJson, template.diagramJson) : null;
  const nextChangeover = nextTemplate ? diffRaceEquipment(template?.diagramJson, nextTemplate.diagramJson) : null;

  return (
    <div className="space-y-2.5 pt-2">
      <h1 className="sr-only">Arena setup</h1>
      {arenaBar}

      <PageGrid aside={(
      <div className="mg-card p-3">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--mg-muted))]">All races in this heat</div>
        <div className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-1">
          {orderedRaces.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setOffsetTo(i - (baseIdx >= 0 ? baseIdx : 0))}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition lg:min-h-10 lg:px-3 lg:text-left lg:text-sm ${
                i === activeIdx
                  ? 'bg-[rgb(var(--mg-button))] text-[rgb(var(--mg-button-ink))]'
                  : r.isComplete
                    ? 'mg-tag-ok'
                    : 'bg-[rgb(var(--mg-subtle))] text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-tint))]'
              }`}
            >
              {i + 1}. {r.name}
            </button>
          ))}
        </div>
      </div>
      )} asideLabel="Races in this heat">
        <div className="space-y-2.5">
      <div className="mg-card flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--mg-muted))]">Heat in arena</div>
          <div className="truncate text-lg font-bold text-[rgb(var(--mg-heading))]">
            {displaySectionName(target.session.sectionName ?? target.session.name)} · {target.heat.label ?? `Heat ${target.heatIndex + 1}`}
          </div>
        </div>
        {heatTiming && (
          <div className="flex items-center gap-1 font-mono text-sm tabular-nums text-[rgb(var(--mg-body))]">
            <Clock className="h-4 w-4 text-[rgb(var(--mg-muted))]" /> {formatTime(roundTo5Min(heatTiming.effective ?? heatTiming.scheduled))}
          </div>
        )}
        <div className="inline-flex shrink-0 items-center gap-1 text-xs text-[rgb(var(--mg-muted))]">
          <Users className="h-3 w-3" /> {target.heat.entries.length} teams
        </div>
      </div>

      <div className="mg-card p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--mg-muted))]">Race {activeIdx + 1} of {orderedRaces.length}</span>
          <h2 className="mg-display min-w-0 flex-1 truncate text-2xl font-bold text-[rgb(var(--mg-heading))] sm:text-3xl">
            {activeRace?.name ?? 'No race'}
          </h2>
          {activeRace?.isComplete && (
            <span className="mg-pill mg-pill-done">
              Done
            </span>
          )}
          {activeRace && (
            <Link
              to={`/competitions/${competition.id}/rulebooks?race=${encodeURIComponent(activeRace.name)}`}
              className="btn-ghost !py-1 !px-2 text-xs"
            >
              <BookOpen aria-hidden="true" className="h-3.5 w-3.5" /> Rules
            </Link>
          )}
        </div>

        {template ? (
          <>
            {template.summary && (
              <p className="mb-2 text-sm text-[rgb(var(--mg-body))]">{template.summary}</p>
            )}
            <div className="overflow-hidden rounded-lg border border-[rgb(var(--mg-rule))]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeRace?.id ?? activeIdx}
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <RaceDiagram diagramJson={template.diagramJson} height={desktop ? 340 : 200} />
                </motion.div>
              </AnimatePresence>
            </div>
            <EquipmentList items={activeEquipment} />
            {activeChangeover && <ChangeoverStrip diff={activeChangeover} />}
            <RaceRulebookSection template={template} />
          </>
        ) : (
          <div className="rounded-lg border-2 border-dashed border-[rgb(var(--mg-dash))] p-6 text-center">
            <Flag className="mx-auto mb-2 h-8 w-8 text-[rgb(var(--mg-faint))]" />
            <p className="text-sm text-[rgb(var(--mg-muted))]">No setup diagram for "{activeRace?.name}" yet. Add it under Admin → Race rules.</p>
          </div>
        )}
      </div>

      {nextRace && (
        <section aria-label="Next race" className="card p-3 sm:p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wide text-brand-600 dark:text-brand-300 font-semibold">
              Up next · Race {activeIdx + 2} of {orderedRaces.length}
            </span>
            <h3 className="text-lg sm:text-xl font-bold flex-1 min-w-0 truncate">
              {nextRace.name}
            </h3>
          </div>
          {nextTemplate ? (
            <>
              {nextDescription && (
                <p className="text-sm text-slate-700 dark:text-slate-200">{nextDescription}</p>
              )}
              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                <RaceDiagram diagramJson={nextTemplate.diagramJson} height={150} />
              </div>
              <EquipmentList items={nextEquipment} />
              {nextChangeover && <ChangeoverStrip diff={nextChangeover} />}
            </>
          ) : (
            <p className="text-xs text-slate-500">No setup diagram for "{nextRace.name}" yet.</p>
          )}
        </section>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => bumpOffset(-1)}
          disabled={!prevRace}
          className="mg-btn mg-btn-secondary !min-h-11 !px-3 !py-2 text-sm"
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <div className="flex-1 text-center text-xs text-[rgb(var(--mg-muted))]">
          Heat {target.heat.label ?? target.heatIndex + 1}
        </div>
        <button
          onClick={() => bumpOffset(1)}
          disabled={!nextRace}
          className="mg-btn mg-btn-primary !min-h-11 !px-4 !py-2 text-sm"
        >
          {nextRace ? <>Next race · {nextRace.name} <ArrowRight className="h-4 w-4" /></> : <>End of heat</>}
        </button>
      </div>
        </div>
      </PageGrid>
    </div>
  );
}
