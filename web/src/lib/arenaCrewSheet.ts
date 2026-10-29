// Unused in web UI yet — reserved for iOS / upcoming wiring
import {
  DIAGRAM_TOOLS,
  type ArenaCrewPropSheet,
  type ArenaCrewRaceCard,
  type ArenaCrewTransitionDiff,
  type ArenaCrewZoneProps,
  type DiagramElement,
  type Heat,
  type RaceTemplate,
  type SectionFormat,
  type Session,
} from '../types';
import { findRaceTemplate } from './raceTemplates';

export type ArenaCrewZoneFilter = 'all' | 'start' | 'centre' | 'top';

const POSITIONAL_LABEL = /^(?:p?\d+|pole\s*\d+|cone\s*\d+|\d+(?:st|nd|rd|th)(?:\s*(?:pole|cone))?)$/i;

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function classifyElementZone(el: DiagramElement): 'start' | 'centre' | 'top' {
  if ('anchor' in el && typeof el.anchor === 'string' && el.anchor.trim()) {
    const anchor = el.anchor.trim().toLowerCase();
    if (anchor === 'start' || anchor === 'gap0') return 'start';
    if (
      anchor === 'gap4' ||
      anchor === 'mid_4_top' ||
      anchor === 'changeover' ||
      anchor === 'gap5' ||
      anchor === 'top' ||
      anchor === 'pole5' ||
      anchor === 'beyond'
    ) {
      return 'top';
    }
    if (anchor.startsWith('pole') || anchor.startsWith('gap') || anchor.startsWith('mid')) {
      return 'centre';
    }
  }
  if ('x' in el && typeof el.x === 'number') {
    if (el.x < 18) return 'start';
    if (el.x >= 92) return 'top';
  }
  return 'centre';
}

function elementLabel(el: DiagramElement): string {
  if (el.t === 'pole') return 'Bending pole';
  if (el.t === 'in' || el.t === 'table') return 'Table / stand';
  if ('label' in el && typeof el.label === 'string' && el.label.trim() && !POSITIONAL_LABEL.test(el.label.trim())) {
    return el.label.trim();
  }
  if ('kind' in el && typeof el.kind === 'string' && el.kind.trim()) {
    const k = el.kind.trim();
    const matchedTool = DIAGRAM_TOOLS.find((tool) => tool.t === el.t && tool.kind === k);
    if (matchedTool) return matchedTool.label;
    if (el.t === 'cone') return `${capitalise(k)} cone`;
    return capitalise(k.replace(/_/g, ' '));
  }
  return capitalise(el.t);
}

function accumulateElement(
  el: DiagramElement,
  zoneCounts: Map<string, number>,
  overallCounts: Map<string, number>,
): void {
  if (el.t === 'lane' || el.t === 'midline') return;
  const label = elementLabel(el);
  zoneCounts.set(label, (zoneCounts.get(label) ?? 0) + 1);
  overallCounts.set(label, (overallCounts.get(label) ?? 0) + 1);

  if ('on' in el && Array.isArray(el.on)) {
    for (const child of el.on) {
      accumulateElement(child, zoneCounts, overallCounts);
    }
  }
}

function buildZone(zoneKey: 'start' | 'centre' | 'top', zoneLabel: string, counts: Map<string, number>): ArenaCrewZoneProps {
  const entries = [...counts.entries()].sort((a, b) => {
    const aPole = a[0].toLowerCase() === 'bending pole' ? 0 : 1;
    const bPole = b[0].toLowerCase() === 'bending pole' ? 0 : 1;
    if (aPole !== bPole) return aPole - bPole;
    return a[0].localeCompare(b[0]);
  });
  const items = entries.map(([name, count]) => `${count} × ${name} per lane`);
  return {
    zoneKey,
    zoneLabel,
    items,
    summaryText: items.length === 0 ? 'Clear' : items.join(', '),
  };
}

export function buildArenaCrewRaceCardFromDiagram(
  raceName: string,
  orderIndex: number,
  diagramJson?: string | null,
  options?: { raceId?: number | null; summary?: string | null },
): { card: ArenaCrewRaceCard; propCounts: Map<string, number> } {
  const startCounts = new Map<string, number>();
  const centreCounts = new Map<string, number>();
  const topCounts = new Map<string, number>();
  const overallCounts = new Map<string, number>();
  let bendingPoles = 0;

  if (diagramJson?.trim()) {
    try {
      const parsed = JSON.parse(diagramJson) as unknown;
      if (Array.isArray(parsed)) {
        for (const raw of parsed) {
          if (!raw || typeof raw !== 'object' || !('t' in raw)) continue;
          const el = raw as DiagramElement;
          if (el.t === 'lane' || el.t === 'midline') continue;
          const zone = classifyElementZone(el);
          const target = zone === 'start' ? startCounts : zone === 'top' ? topCounts : centreCounts;
          if (el.t === 'pole' && zone === 'centre') {
            bendingPoles += 1;
          }
          accumulateElement(el, target, overallCounts);
        }
      }
    } catch {
      // Ignore malformed diagram JSON
    }
  }

  const zones: ArenaCrewZoneProps[] = [
    buildZone('start', 'Start/finish line', startCounts),
    buildZone('centre', 'Centre line (poles 1–4)', centreCounts),
    buildZone('top', 'Changeover line', topCounts),
  ];

  return {
    card: {
      raceId: options?.raceId ?? null,
      raceName,
      orderIndex,
      bendingPolesPerLane: bendingPoles,
      summary: options?.summary ?? null,
      zones,
    },
    propCounts: overallCounts,
  };
}

export function buildArenaCrewTransitionDiff(
  currentCounts: ReadonlyMap<string, number>,
  nextCounts: ReadonlyMap<string, number>,
): ArenaCrewTransitionDiff {
  const keys = [...new Set([...currentCounts.keys(), ...nextCounts.keys()])].sort((a, b) => a.localeCompare(b));
  const bringIn: string[] = [];
  const clearOut: string[] = [];
  const keepInRing: string[] = [];

  for (const key of keys) {
    const cur = currentCounts.get(key) ?? 0;
    const nxt = nextCounts.get(key) ?? 0;
    const shared = Math.min(cur, nxt);
    if (shared > 0) keepInRing.push(`${shared} × ${key} per lane`);
    if (nxt > cur) bringIn.push(`${nxt - cur} × ${key} per lane`);
    if (cur > nxt) clearOut.push(`${cur - nxt} × ${key} per lane`);
  }

  const parts: string[] = [];
  if (bringIn.length > 0) parts.push(`Bring in: ${bringIn.join(', ')}`);
  if (clearOut.length > 0) parts.push(`Clear: ${clearOut.join(', ')}`);
  if (keepInRing.length > 0) parts.push(`Keep: ${keepInRing.join(', ')}`);

  return {
    bringIn,
    clearOut,
    keepInRing,
    summaryText: parts.length === 0 ? 'No prop changes needed.' : parts.join(' · '),
  };
}

export function filterRaceCardZones(
  card: ArenaCrewRaceCard,
  zoneFilter: ArenaCrewZoneFilter = 'all',
): ArenaCrewZoneProps[] {
  if (zoneFilter === 'all') return card.zones;
  return card.zones.filter((z) => z.zoneKey === zoneFilter);
}

export function buildOfflineArenaCrewPropSheet(
  competitionId: number,
  session: Session | null | undefined,
  heat: Heat | null | undefined,
  templates: readonly RaceTemplate[],
  /** The session's section format: a Pairs or Individual session sets out its own version of each race. */
  format?: SectionFormat | null,
): ArenaCrewPropSheet {
  if (!session) {
    return {
      competitionId,
      sessionId: null,
      sessionName: null,
      arenaName: null,
      heatId: null,
      heatLabel: null,
      lanesPerHeat: 5,
      currentRace: null,
      nextRace: null,
      transition: null,
      allHeatRaces: [],
    };
  }

  const rawRaces =
    heat && heat.races.length > 0
      ? heat.races
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((r) => ({ raceId: r.id, name: r.name, orderIndex: r.orderIndex, isComplete: r.isComplete }))
      : (session.plannedRaces ?? []).map((name, idx) => ({
          raceId: null,
          name,
          orderIndex: idx + 1,
          isComplete: false,
        }));

  const cards: ArenaCrewRaceCard[] = [];
  const countsList: Map<string, number>[] = [];

  for (const r of rawRaces) {
    const tpl = findRaceTemplate(templates, r.name, format);
    const { card, propCounts } = buildArenaCrewRaceCardFromDiagram(r.name, r.orderIndex, tpl?.diagramJson, {
      raceId: r.raceId,
      summary: tpl?.summary ?? null,
    });
    cards.push(card);
    countsList.push(propCounts);
  }

  let currentIdx = rawRaces.findIndex((r) => !r.isComplete);
  if (currentIdx < 0 && cards.length > 0) currentIdx = cards.length - 1;

  const currentRace = currentIdx >= 0 ? cards[currentIdx] : null;
  const nextRace = currentIdx >= 0 && currentIdx + 1 < cards.length ? cards[currentIdx + 1] : null;
  const transition =
    currentRace && nextRace ? buildArenaCrewTransitionDiff(countsList[currentIdx], countsList[currentIdx + 1]) : null;

  return {
    competitionId,
    sessionId: session.id,
    sessionName: session.name,
    arenaName: session.arenaName ?? null,
    heatId: heat?.id ?? null,
    heatLabel: heat ? (heat.label?.trim() || `Heat ${heat.orderIndex}`) : null,
    lanesPerHeat: Math.max(heat?.entries.length ?? 0, session.lanesPerHeat ?? 5),
    currentRace,
    nextRace,
    transition,
    allHeatRaces: cards,
  };
}
