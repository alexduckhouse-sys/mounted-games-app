import { whatsAppUrl } from '../../lib/whatsapp';
import type { CompetitionDetail, Heat, Session } from '../../types';

const clock = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const day = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** The timetable as plain text for a group chat: each arena in running order, then the link to the live page. */
export function timetableShareText(competition: Pick<CompetitionDetail, 'name' | 'sessions' | 'startDate'>, link: string): string {
  const byArena = new Map<string, Session[]>();
  for (const session of competition.sessions) {
    const arena = session.arenaName?.trim() || 'All arenas';
    byArena.set(arena, [...(byArena.get(arena) ?? []), session]);
  }
  const lines = [`${competition.name}`, `Timetable, ${day(competition.startDate)}`];
  for (const [arena, sessions] of byArena) {
    lines.push('', arena);
    const ordered = sessions.slice().sort((a, b) => (a.scheduledStart ? Date.parse(a.scheduledStart) : Infinity) - (b.scheduledStart ? Date.parse(b.scheduledStart) : Infinity) || a.orderIndex - b.orderIndex);
    for (const session of ordered) {
      const time = clock(session.scheduledStart);
      lines.push(`${time || 'Time to be confirmed'}  ${session.sectionName && !session.isBreak ? `${session.sectionName}, ` : ''}${session.name}`);
    }
  }
  lines.push('', `Live times and scores: ${link}`);
  return lines.join('\n');
}

/** The lanes for a session as plain text, one block per heat. Team names only, nothing private. */
export function drawShareText(competition: Pick<CompetitionDetail, 'name'>, session: Pick<Session, 'name' | 'sectionName' | 'arenaName' | 'heats'>, link: string): string {
  const heading = [session.sectionName, session.name].filter(Boolean).join(', ');
  const lines = [competition.name, `Draw: ${heading}${session.arenaName ? ` (${session.arenaName})` : ''}`];
  const heats: Heat[] = session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  for (const [index, heat] of heats.entries()) {
    const time = clock(heat.scheduledStart);
    lines.push('', `${heat.label?.trim() || `Heat ${index + 1}`}${time ? `, ${time}` : ''}`);
    for (const entry of heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex)) lines.push(`Lane ${entry.laneIndex}: ${entry.teamName}`);
  }
  lines.push('', `Live times and scores: ${link}`);
  return lines.join('\n');
}

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/** Opens the phone's share sheet when there is one. Returns false when the browser has none, so the caller can offer copy instead. */
export async function shareWithSheet(title: string, text: string): Promise<'shared' | 'cancelled' | 'unavailable'> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return 'unavailable';
  try {
    await navigator.share({ title, text });
    return 'shared';
  } catch (caught) {
    return (caught as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'unavailable';
  }
}

/** Copies the text, falling back to a hidden text box where the clipboard API is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the older route */ }
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  } catch {
    return false;
  }
}

export const whatsAppShareHref = (text: string): string => whatsAppUrl(text);
