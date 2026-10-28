import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Check, ChevronDown, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { api } from '../../api';
import type { Heat, RaceTemplate, Session } from '../../types';
import { useCompetition } from './context';
import { usePageHeader } from '../../components/CompactPageBarContext';
import { Sheet } from '../../components/Sheet';
import { useDockAction } from '../../components/TickerContext';
import { RaceDiagram } from '../../components/RaceDiagram';
import { RaceRulesSheet, buildRaceRulebooks, type RaceTemplateDetail } from '../../components/RaceRulesSheet';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { crewGroups, diffRaceEquipment, equipmentFromDiagram } from '../../lib/raceEquipment';
import { findRaceTemplate, sessionFormat } from '../../lib/raceTemplates';
import { displaySectionName } from '../../lib/section';
import { roundTo5Min, computeTimings } from '../../lib/time';
import '../../components/sitePages.css';
import '../../components/eventPages.css';
import './heat.css';
import { useLanguage, useT } from '../../i18n/LanguageContext';

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
  const t = useT();
  const { locale } = useLanguage();
  const clock = (when: Date) => when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const { competition } = useCompetition();
  usePageHeader({
    title: t('teams.arena.title'),
    subtitle: competition.name,
    backTo: `/competitions/${competition.id}`,
    backLabel: t('teams.team.timetable'),
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
  // A Pairs or Individual heat sets out its section's version of each race.
  const format = sessionFormat(competition, target?.session);
  const activeKey = `${activeRaceName.toLowerCase()}|${format ?? ''}`;
  function goToRace(index: number) {
    if (target) setRaceByHeat((cur) => ({ ...cur, [target.heat.id]: index }));
  }

  useEffect(() => {
    if (!activeRaceName || byNameDetails[activeKey]) return;
    let cancelled = false;
    api
      .get<RaceTemplateDetail>(`/race-templates/by-name/${encodeURIComponent(activeRaceName)}`, format ? { params: { format } } : undefined)
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
  }, [activeRaceName, activeKey, format, byNameDetails]);

  const timeOf = (c: HeatChoice) => {
    const timing = timings.get(c.session.id)?.heats[c.heatIndex];
    const when = timing ? roundTo5Min(timing.effective ?? timing.scheduled) : null;
    return when ? clock(when) : '';
  };

  const [pickerOpen, setPickerOpen] = useState(false);
  // Where you are looking opens from the list button beside the ticker dock; the inline row stays when there is no dock.
  const hasWhere = arenas.length > 1 || target != null;
  const docked = useDockAction(hasWhere ? { label: t('teams.arena.where'), icon: 'list', onClick: () => setPickerOpen(true) } : null);
  const whereRow = hasWhere && !docked && (
    <WhereRow arena={arenas.length > 1 ? selectedArena : ''} target={target} nextHere={target != null && target === currentChoice(choices)} timings={timings} clock={clock} onOpen={() => setPickerOpen(true)} />
  );
  const picker = pickerOpen && (
    <Sheet title={t('teams.arena.where')} className="heat-sheet" onClose={() => setPickerOpen(false)}>
      {({ close }) => (
        <>
          {arenas.length > 1 && (
            <div className="sp-seg" role="tablist" aria-label={t('teams.arena.arena')}>
              {arenas.map((name) => (
                <button key={name} type="button" role="tab" aria-selected={selectedArena === name} onClick={() => { chooseArena(name); setPickedHeat(null); }}>{name}</button>
              ))}
            </div>
          )}
          <div className="hc-list">
            {choices.map((c) => {
              const finished = heatIsComplete(c.heat);
              const live = !finished && c.session.status === 1 && c === currentChoice(choices);
              const chosen = target != null && c.heat.id === target.heat.id;
              return (
                <button key={c.heat.id} type="button" className="hc-row" aria-current={chosen ? 'true' : undefined} onClick={() => close(() => { setPickedHeat(c.heat.id); setPickerOpen(false); })}>
                  <span className="hc-time">{timeOf(c) || '–'}</span>
                  <span className="hc-name">{heatName(c, t)}</span>
                  <span className={`hc-status${live ? ' hc-status-live' : ''}`}>{finished ? t('common.finished') : live ? t('shell.header.onNow') : ''}</span>
                  <span className="hc-tick" aria-hidden="true">{chosen && <Check className="h-5 w-5" strokeWidth={2.5} />}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );

  const shell = (children: ReactNode) => (
    <div className="rf-page mx-auto flex w-full max-w-xl flex-col pb-6 pt-3">
      <h1 className="sr-only">{t('teams.arena.title')}</h1>
      {whereRow}
      {children}
      {picker}
    </div>
  );

  if (!target) {
    return shell(
      <div className="ev-card p-6 text-center">
        <Activity className="mx-auto mb-2 h-10 w-10 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
        <p className="ev-body">{t('teams.arena.nothing')}</p>
      </div>,
    );
  }

  const template = activeRace ? (byNameDetails[activeKey] ?? findRaceTemplate(templates, activeRaceName, format)) : null;
  const equipment = equipmentFromDiagram(template?.diagramJson);
  const prevRace = activeIdx > 0 ? orderedRaces[activeIdx - 1] : null;
  const prevTemplate = prevRace ? findRaceTemplate(templates, prevRace.name, format) : null;
  const crew = template ? crewGroups(diffRaceEquipment(prevTemplate?.diagramJson, template.diagramJson)) : [];

  return shell(
    <>
      <div className="ev-card overflow-hidden">
        <div className="flex items-center gap-1.5 border-b border-[rgb(var(--mg-rule-soft))] px-1.5 py-2">
          <button type="button" className="ev-arrow" aria-label={t('teams.arena.previous')} disabled={activeIdx === 0} onClick={() => goToRace(activeIdx - 1)}>
            <ChevronLeft className="h-[22px] w-[22px]" aria-hidden="true" strokeWidth={2.5} />
          </button>
          <div className="flex min-w-0 flex-1 flex-col items-center text-center">
            <span className="sp-t2">{t('teams.arena.raceOf', { current: activeRace ? activeIdx + 1 : 0, total: orderedRaces.length })}{activeRace?.isComplete ? ` · ${t('teams.arena.done')}` : ''}</span>
            <h2 className="m-0 max-w-full truncate mg-display text-2xl font-extrabold leading-[1.05] text-[rgb(var(--mg-heading))]">{activeRace?.name ?? t('teams.arena.noRace')}</h2>
          </div>
          <button type="button" className="ev-arrow" aria-label={t('teams.arena.next')} disabled={activeIdx >= orderedRaces.length - 1} onClick={() => goToRace(activeIdx + 1)}>
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
                  <RaceDiagram drop diagramJson={template.diagramJson} height={desktop ? 340 : 200} />
                </motion.div>
              </AnimatePresence>
            </div>
            {template.summary && <p className="ev-body !text-[15px]">{template.summary}</p>}
            {equipment.length > 0 && (
              <p className="m-0 text-sm font-medium leading-snug text-[rgb(var(--mg-muted))]" aria-label={t('teams.arena.equipment')}>
                <b className="font-semibold text-[rgb(var(--mg-ink))]">{t('teams.arena.eachLane')}:</b> {equipment.map((item) => `${item.count > 1 ? `${item.count} × ` : ''}${item.label}`).join(', ')}
              </p>
            )}
            <p className="m-0 text-center">
              <button type="button" className="ev-text-btn !no-underline" onClick={() => setRulesFor(activeRaceName)}>{t('teams.arena.fullRules')}</button>
            </p>
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <Flag className="mx-auto mb-2 h-8 w-8 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
            <p className="ev-body !text-[15px]">{activeRace ? t('teams.arena.noDiagram', { name: activeRace.name }) : t('teams.arena.noRaces')}</p>
            {activeRace && <button type="button" className="ev-text-btn !no-underline" onClick={() => setRulesFor(activeRaceName)}>{t('teams.arena.fullRules')}</button>}
          </div>
        )}
      </div>

      {crew.length > 0 && (
        <section aria-label={t('teams.arena.crew')}>
          <h2 className="sp-sec">{t('teams.arena.crew')}</h2>
          <div className="ev-card divide-y divide-[rgb(var(--mg-rule-soft))] text-[15px] leading-snug">
            {crew.map((group) => (
              <div key={group.place} className="flex flex-col gap-1 px-4 py-3">
                <h3 className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-[rgb(var(--mg-muted))]">{t(CREW_PLACE_KEY[group.place])}</h3>
                {group.lines.map((line) => <p key={line} className="m-0">{line}</p>)}
              </div>
            ))}
          </div>
        </section>
      )}

      <RaceRulesSheet raceName={rulesFor} format={format} open={rulesFor != null} onClose={() => setRulesFor(null)} competitionId={competition.id} />
    </>,
  );
}

const CREW_PLACE_KEY = { top: 'teams.arena.crewTop', middle: 'teams.arena.crewMiddle', start: 'teams.arena.crewStart' } as const;

const heatName = (c: HeatChoice, t: ReturnType<typeof useT>) => [displaySectionName(c.session.sectionName ?? c.session.name), c.heat.label ?? t('teams.team.heatN', { number: c.heatIndex + 1 })].filter(Boolean).join(' ');

/** One row for where you are looking: the arena and heat ("Main Arena · Seniors Heat 1"), with the time and what it is doing under it. */
function WhereRow({ arena, target, nextHere, timings, clock, onOpen }: { arena: string; target: HeatChoice | null; nextHere: boolean; timings: ReturnType<typeof computeTimings>; clock: (when: Date) => string; onOpen: () => void }) {
  const t = useT();
  const timing = target ? timings.get(target.session.id)?.heats[target.heatIndex] : undefined;
  const when = timing ? roundTo5Min(timing.effective ?? timing.scheduled) : null;
  const live = target != null && !heatIsComplete(target.heat) && target.session.status === 1 && nextHere;
  const state = target == null ? '' : heatIsComplete(target.heat) ? t('common.finished') : live ? t('shell.header.onNow') : nextHere ? t('teams.arena.nextHere') : '';
  const main = [arena, target ? heatName(target, t) : ''].filter(Boolean).join(' · ');
  const sub = [when ? clock(when) : '', state].filter(Boolean).join(' · ');
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog"
      className="mb-3 flex min-h-[50px] w-full items-center gap-2 rounded-xl border border-[rgb(var(--mg-line))] bg-[rgb(var(--mg-surface))] py-1.5 pl-3.5 pr-2.5 text-left">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold leading-tight text-[rgb(var(--mg-heading))]">{main}</span>
        {sub && <small className="text-xs font-medium leading-none text-[rgb(var(--mg-muted))]">{sub}</small>}
      </span>
      <ChevronDown aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-muted))]" strokeWidth={2.2} />
    </button>
  );
}
