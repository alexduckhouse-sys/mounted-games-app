import type { LiveStream, Session } from '../types';
import { computeTimings } from './time';
import { sessionOrdinals, sessionTitle, timetableRows } from './timetableRows';

export function updateStreams(streams: LiveStream[], next: LiveStream): LiveStream[] {
  const previous = streams.find((stream) => stream.id === next.id);
  if (previous && previous.generation > next.generation) return streams;
  return [...streams.filter((stream) => stream.id !== next.id), ...(next.status === 2 ? [] : [next])]
    .sort((a, b) => a.arenaName.localeCompare(b.arenaName) || a.angleName.localeCompare(b.angleName));
}
/** The heat running in this arena, or null when nothing is racing there. */
export function streamHeatLabel(sessions: Session[], arena: string): string | null {
  const row = timetableRows(sessions, computeTimings(sessions), true)
    .find((row) => row.session.arenaName?.trim() === arena.trim() && row.status === 'live' && row.session.kind === 0);
  if (!row) return null;
  const parts = [sessionTitle(row.session, sessionOrdinals(sessions))];
  if (row.heat) {
    parts.push(row.heat.label || `Heat ${row.heatIndex + 1}`);
    const race = [...row.heat.races].sort((a, b) => a.orderIndex - b.orderIndex).find((race) => !race.isComplete);
    if (race) parts.push(race.name);
  }
  return parts.join(' · ');
}
export function streamLink(raw: string): { href: string; embed: string | null } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|live|shorts)\/([\w-]+)\/?$/)?.[1] || null;
    } else if (host === 'youtu.be') id = url.pathname.slice(1);
    if (host === 'twitch.tv' || host === 'm.twitch.tv') {
      const channel = url.pathname.split('/').filter(Boolean)[0] ?? '';
      const embed = /^\w{3,25}$/.test(channel) ? `https://player.twitch.tv/?channel=${channel}&parent=${window.location.hostname}` : null;
      return { href: url.href, embed };
    }
    const embed = id && /^[\w-]+$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    return { href: url.href, embed };
  } catch { return null; }
}

/** Keep the latest announcement independently of the three operator feed messages. */
export function appendStreamMessage<T extends { message: { id: number; type: number } }>(current: T[], next: T): T[] {
  const items = [...current.filter((item) => item.message.id !== next.message.id), next];
  const recent = items.slice(-3);
  const announcement = items.filter((item) => item.message.type === 2).at(-1);
  return announcement && !recent.includes(announcement) ? [announcement, ...recent] : recent;
}
