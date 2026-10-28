import type { PrintableDraw, PrintableScoreSheets } from '../eventTools/eventToolsTypes';

export type SessionPrintView = 'draw' | 'score-sheets' | 'results';

/** The session id in a print page's address (`?sessionId=12`), or null when it is missing or not a whole positive number. */
export function parseSessionId(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value.trim())) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

/** Where the print page for one session lives. */
export function sessionPrintPath(competitionId: number | string, view: SessionPrintView, sessionId: number): string {
  return `/event-tools/${competitionId}/print/${view}?sessionId=${sessionId}`;
}

/** The draw for one session only. */
export function drawForSession(data: PrintableDraw, sessionId: number): PrintableDraw {
  return { ...data, sessions: data.sessions.filter((session) => session.sessionId === sessionId) };
}

/** The score sheets for one session only. */
export function scoreSheetsForSession(data: PrintableScoreSheets, sessionId: number): PrintableScoreSheets {
  return { ...data, heats: data.heats.filter((heat) => heat.sessionId === sessionId) };
}
