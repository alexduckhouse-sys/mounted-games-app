import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { api } from '../../api';
import type { Heat, RaceTemplate, Session } from '../../types';
import { useCompetition } from './context';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { DropdownRow } from '../../components/DropdownRow';
import { RaceDiagram } from '../../components/RaceDiagram';
import { RaceRulesSheet, buildRaceRulebooks, type RaceTemplateDetail } from '../../components/RaceRulesSheet';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { crewLines, diffRaceEquipment, equipmentFromDiagram } from '../../lib/raceEquipment';
import { displaySectionName } from '../../lib/section';
import { formatTime, roundTo5Min, computeTimings } from '../../lib/time';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

function heatIsComplete(h: Heat): boolean {
  return h.races.length > 0 && h.races.every((r) => r.isComplete);
}

const isRaceSession = (s: Session) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0;
const arenaOf = (s: Session) => s.arenaName?.trim() ?? '';
const arenaStorageKey = (competitionId: number) => `mg.arena.page.${competitionId}`;

function storedArena(competitionId: number): string {
  try { return localStorage.getItem(arenaStorageKey(competitionId)) ?? ''; } catch { return ''; }
}

interface HeatChoice { session: Session; heat: Heat; heatIndex: number }

/** Every heat of the given sessions, in running order. */
function heatChoices(sessions: Session[]): HeatChoice[] {
  return sessions
    .filter(isRaceSession)
    .slice().sort((a, b) => a.orderIndex - b.orderIndex)
    .flatMap((session) => session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex).map((heat, heatIndex) => ({ session, heat, heatIndex })));
}

/** The heat that is "now": the first one not finished in the live session, or failing that the next one anywhere. */
function currentChoice(choices: HeatChoice[]): HeatChoice | null {
  const live = choices.filter((c) => c.session.status === 1);
  return [...live, ...choices.filter((c) => c.session.status !== 1)].find((c) => !heatIsComplete(c.heat)) ?? choices.at(-1) ?? null;
}

export function ArenaPage() {
  usePageWidth('narrow');
  const desktop = useIsDesktop();
  const { competition } = useCompetition();
  usePageHeader({
    title: 'Arena setup',
    subtitle: competition.name,
    backTo: `/competitions/${competition.id}`,
    backLabel: 'Timetable',
  });
  const [templates, setTemplates] = useState<RaceTemplate[]>([]);
  const [byNameDetails, setByNameDetails] = useState<Record<string, RaceTemplateDetail>>({});
  const [rulesFor, setRulesFor] = useState<string | null>(null);
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

  useEffect(() => {
    api.get<RaceTemplate[]>('/race-templates').then((r) => setTemplates(r.data)).catch(() => {});
  }, []);

  const tmplByName = useMemo(() => {
    const m = new Map<string, RaceTemplate>();
    for (const t of templates) m.set(t.name.toLowerCase().trim(), t);
    return m;
  }, [templates]);

  // With several arenas, only that arena's sessions (plus any shared "all arenas" ones) are listed.
  const choices = useMemo(() => heatChoices(selectedArena
    ? competition.sessions.filter((s) => !arenaOf(s) || arenaOf(s) === selectedArena)
    : competition.sessions), [competition.sessions, selectedArena]);
  const timings = useMemo(() => computeTimings(competition.sessions), [competition.sessions]);
  const [pickedHeat, setPickedHeat] = useState<number | null>(null);
  const target = choices.find((c) => c.heat.id === pickedHeat) ?? currentChoice(choices);

  // The race shown in each heat: the first one not finished until someone steps through them.
  const [raceByHeat, setRaceByHeat] = useState<Record<number, number>>({});
  const orderedRaces = target ? target.heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const firstOpen = Math.max(0, orderedRaces.findIndex((r) => !r.isComplete));
  const activeIdx = target ? Math.max(0, Math.min(orderedRaces.length - 1, raceByHeat[target.heat.id] ?? firstOpen)) : 0;
  const activeRace = orderedRaces[activeIdx];
  const activeRaceName = activeRace?.name?.trim() ?? '';
  const activeKey = activeRaceName.toLowerCase();
  function goToRace(index: number) {
    if (target) setRaceByHeat((cur) => ({ ...cur, [target.heat.id]: index }));
  }

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

  const arenaTabs = arenas.length > 1 ? (
    <div className="sp-seg mb-3" role="tablist" aria-label="Arena">
      {arenas.map((name) => (
        <button key={name} type="button" role="tab" aria-selected={selectedArena === name} onClick={() => chooseArena(name)}>{name}</button>
      ))}
    </div>
  ) : null;

  const shell = (children: ReactNode) => (
    <div className="rf-page mx-auto flex w-full max-w-xl flex-col pb-6 pt-3">
      <h1 className="sr-only">Arena setup</h1>
      {arenaTabs}
      {children}
    </div>
  );

  if (!target) {
    return shell(
      <div className="ev-card p-6 text-center">
        <Activity className="mx-auto mb-2 h-10 w-10 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
        <p className="ev-body">Nothing currently in the arena.</p>
      </div>,
    );
  }

  const timeOf = (c: HeatChoice) => {
    const timing = timings.get(c.session.id)?.heats[c.heatIndex];
    const when = timing ? roundTo5Min(timing.effective ?? timing.scheduled) : null;
    return when ? formatTime(when) : '';
  };
  const heatLabel = (c: HeatChoice) => [displaySectionName(c.session.sectionName ?? c.session.name), c.heat.label ?? `Heat ${c.heatIndex + 1}`, timeOf(c)].filter(Boolean).join(' · ');
  const heatOptions = choices.map((c) => ({ value: String(c.heat.id), label: heatLabel(c) }));

  const template = activeRace ? (byNameDetails[activeKey] ?? tmplByName.get(activeKey) ?? null) : null;
  const equipment = equipmentFromDiagram(template?.diagramJson);
  const prevRace = activeIdx > 0 ? orderedRaces[activeIdx - 1] : null;
  const prevTemplate = prevRace ? tmplByName.get(prevRace.name.toLowerCase().trim()) : null;
  const crew = template ? crewLines(diffRaceEquipment(prevTemplate?.diagramJson, template.diagramJson)) : [];

  return shell(
    <>
      <DropdownRow label="Heat" value={String(target.heat.id)} options={heatOptions} onChange={(value) => setPickedHeat(Number(value))} />

      <div className="ev-card mt-3 overflow-hidden">
        <div className="flex items-center gap-1.5 border-b border-[rgb(var(--mg-rule-soft))] px-1.5 py-2">
          <button type="button" className="ev-arrow" aria-label="Previous race" disabled={activeIdx === 0} onClick={() => goToRace(activeIdx - 1)}>
            <ChevronLeft className="h-[22px] w-[22px]" aria-hidden="true" strokeWidth={2.5} />
          </button>
          <div className="flex min-w-0 flex-1 flex-col items-center text-center">
            <span className="sp-t2">Race {activeRace ? activeIdx + 1 : 0} of {orderedRaces.length}{activeRace?.isComplete ? ' · Done' : ''}</span>
            <h2 className="m-0 max-w-full truncate mg-display text-2xl font-extrabold leading-[1.05] text-[rgb(var(--mg-heading))]">{activeRace?.name ?? 'No race'}</h2>
          </div>
          <button type="button" className="ev-arrow" aria-label="Next race" disabled={activeIdx >= orderedRaces.length - 1} onClick={() => goToRace(activeIdx + 1)}>
            <ChevronRight className="h-[22px] w-[22px]" aria-hidden="true" strokeWidth={2.5} />
          </button>
        </div>

        {template ? (
          <div className="flex flex-col gap-3 px-4 py-3.5">
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
            {template.summary && <p className="ev-body !text-[15px]">{template.summary}</p>}
            {equipment.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Equipment required">
                <span className="sp-t2 mr-1">Each lane</span>
                {equipment.map((item) => <span key={item.label} className="ev-chip">{item.count > 1 ? `${item.count} × ` : ''}{item.label}</span>)}
              </div>
            )}
            <p className="m-0 text-center">
              <button type="button" className="ev-text-btn !no-underline" onClick={() => setRulesFor(activeRaceName)}>Full rules</button>
            </p>
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <Flag className="mx-auto mb-2 h-8 w-8 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
            <p className="ev-body !text-[15px]">{activeRace ? `No setup diagram for “${activeRace.name}” yet.` : 'This heat has no races yet.'}</p>
            {activeRace && <button type="button" className="ev-text-btn !no-underline" onClick={() => setRulesFor(activeRaceName)}>Full rules</button>}
          </div>
        )}
      </div>

      {crew.length > 0 && (
        <section aria-label="Ring crew before this race">
          <h2 className="sp-sec">Ring crew before this race</h2>
          <div className="ev-card flex flex-col gap-1 px-4 py-3 text-[15px] leading-snug">
            {crew.map((line) => <p key={line} className="m-0">{line}</p>)}
          </div>
        </section>
      )}

      <RaceRulesSheet raceName={rulesFor} open={rulesFor != null} onClose={() => setRulesFor(null)} />
    </>,
  );
}
