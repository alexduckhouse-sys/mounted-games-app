// Unused in web UI yet — reserved for iOS / upcoming wiring
import type {
  PrintableResults,
  PrintableScoreHeat,
  PrintableSectionResults,
  PrintableSession,
} from '../pages/eventTools/eventToolsTypes';
import type { PrintableSessionSummary } from '../types';

export interface SessionSelectorOption {
  value: string;
  sessionId: number | null;
  sessionName: string;
  sectionName: string;
  totalHeats: number;
  completedHeats: number;
  isCompleted: boolean;
  label: string;
}

export interface CompletedSessionNoticeboardSheet {
  sessionName: string;
  sectionNames: string[];
  isCompleted: boolean;
  completedHeatsCount: number;
  totalHeatsCount: number;
  heats: PrintableScoreHeat[];
  sections: PrintableSectionResults[];
}

/** True when every race in the heat has at least one scored placing, elimination, or sit-out. */
export function isPrintableHeatCompleted(heat: PrintableScoreHeat): boolean {
  if (!heat.races || heat.races.length === 0) return false;
  return heat.races.every((race) =>
    race.teams.some(
      (cell) =>
        cell.placing !== null ||
        cell.eliminated ||
        cell.isSitOut === true ||
        (typeof cell.points === 'number' && cell.points > 0),
    ),
  );
}

/**
 * Builds the Session Selector options (`All Sessions` vs `Session 1`, `Session 2`...)
 * from printable heats, draw sessions, or backend session summaries.
 */
export function buildSessionSelectorOptions(
  heats: readonly PrintableScoreHeat[] = [],
  drawSessions: readonly PrintableSession[] = [],
  summaries: readonly PrintableSessionSummary[] = [],
): SessionSelectorOption[] {
  const options: SessionSelectorOption[] = [
    {
      value: 'all',
      sessionId: null,
      sessionName: 'All Sessions',
      sectionName: '',
      totalHeats: heats.length,
      completedHeats: heats.filter(isPrintableHeatCompleted).length,
      isCompleted: heats.length > 0 && heats.every(isPrintableHeatCompleted),
      label: 'All Sessions',
    },
  ];

  if (summaries.length > 0) {
    for (const s of summaries) {
      const statusSuffix = s.isCompleted
        ? ' (Completed)'
        : s.completedHeats > 0
          ? ` (${s.completedHeats}/${s.totalHeats} heats)`
          : '';
      options.push({
        value: s.sessionName,
        sessionId: s.sessionId,
        sessionName: s.sessionName,
        sectionName: s.sectionName,
        totalHeats: s.totalHeats,
        completedHeats: s.completedHeats,
        isCompleted: s.isCompleted,
        label: s.sectionName
          ? `${s.sessionName} · ${s.sectionName}${statusSuffix}`
          : `${s.sessionName}${statusSuffix}`,
      });
    }
    return options;
  }

  const byName = new Map<
    string,
    { sessionId: number | null; sectionName: string; heats: PrintableScoreHeat[] }
  >();

  for (const ds of drawSessions) {
    if (!byName.has(ds.sessionName)) {
      byName.set(ds.sessionName, {
        sessionId: ds.sessionId,
        sectionName: ds.sectionName,
        heats: [],
      });
    }
  }

  for (const heat of heats) {
    const existing = byName.get(heat.sessionName);
    if (existing) {
      existing.heats.push(heat);
    } else {
      byName.set(heat.sessionName, {
        sessionId: null,
        sectionName: heat.sectionName,
        heats: [heat],
      });
    }
  }

  for (const [sessionName, entry] of byName.entries()) {
    const totalHeats = entry.heats.length;
    const completedHeats = entry.heats.filter(isPrintableHeatCompleted).length;
    const isCompleted = totalHeats > 0 && completedHeats === totalHeats;
    const statusSuffix = isCompleted
      ? ' (Completed)'
      : completedHeats > 0
        ? ` (${completedHeats}/${totalHeats} heats)`
        : '';
    options.push({
      value: sessionName,
      sessionId: entry.sessionId,
      sessionName,
      sectionName: entry.sectionName,
      totalHeats,
      completedHeats,
      isCompleted,
      label: entry.sectionName
        ? `${sessionName} · ${entry.sectionName}${statusSuffix}`
        : `${sessionName}${statusSuffix}`,
    });
  }

  return options;
}

/** Filters printable score heats by the selected session (`'all'` returns all heats). */
export function filterPrintableHeatsBySession(
  heats: readonly PrintableScoreHeat[],
  selectedSession: string,
): PrintableScoreHeat[] {
  if (!selectedSession || selectedSession === 'all') return [...heats];
  return heats.filter((h) => h.sessionName === selectedSession);
}

/** Filters printable draw sessions by the selected session (`'all'` returns all sessions). */
export function filterPrintableDrawSessions(
  sessions: readonly PrintableSession[],
  selectedSession: string,
): PrintableSession[] {
  if (!selectedSession || selectedSession === 'all') return [...sessions];
  return sessions.filter((s) => s.sessionName === selectedSession);
}

/**
 * Builds the 1–2 page "Print Completed Session Sheet (Noticeboard 1-Pager)" model containing
 * only the selected (or latest completed) session's completed heat results + current section standings.
 */
export function buildCompletedSessionNoticeboardSheet(
  results: PrintableResults | null | undefined,
  allHeats: readonly PrintableScoreHeat[],
  selectedSession: string,
): CompletedSessionNoticeboardSheet | null {
  if (!results) return null;

  let targetSession = selectedSession;
  if (!targetSession || targetSession === 'all') {
    const options = buildSessionSelectorOptions(allHeats).filter((o) => o.value !== 'all');
    const latestCompleted = [...options].reverse().find((o) => o.isCompleted);
    const latestWithResults = [...options].reverse().find((o) => o.completedHeats > 0);
    targetSession = latestCompleted?.value ?? latestWithResults?.value ?? options[0]?.value ?? 'all';
  }

  const sessionHeats = filterPrintableHeatsBySession(allHeats, targetSession);
  const completedHeats = sessionHeats.filter(isPrintableHeatCompleted);
  const heatsToPrint = completedHeats.length > 0 ? completedHeats : sessionHeats;

  const sectionNames = Array.from(
    new Set(sessionHeats.map((h) => h.sectionName).filter((n) => Boolean(n && n.trim()))),
  );

  const sections =
    sectionNames.length > 0
      ? results.sections.filter((sec) => sectionNames.includes(sec.sectionName))
      : results.sections;

  return {
    sessionName: targetSession === 'all' ? 'All Sessions' : targetSession,
    sectionNames,
    isCompleted: sessionHeats.length > 0 && completedHeats.length === sessionHeats.length,
    completedHeatsCount: completedHeats.length,
    totalHeatsCount: sessionHeats.length,
    heats: heatsToPrint,
    sections,
  };
}
